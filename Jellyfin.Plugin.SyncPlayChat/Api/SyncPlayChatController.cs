using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Security.Claims;
using MediaBrowser.Controller.Session;
using MediaBrowser.Controller.SyncPlay;
using MediaBrowser.Controller.SyncPlay.Requests;
using MediaBrowser.Model.Session;
using MediaBrowser.Model.SyncPlay;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.SyncPlayChat.Api;

/// <summary>
/// SyncPlay chat API endpoints.
/// </summary>
[ApiController]
[Route("SyncPlayChat")]
[Authorize]
public class SyncPlayChatController : ControllerBase
{
    private const int MaxMessagesPerGroup = 200;
    private static readonly ConcurrentDictionary<string, List<SyncPlayChatMessage>> _messagesByGroup = new(StringComparer.Ordinal);

    private readonly ISessionManager _sessionManager;
    private readonly ISyncPlayManager _syncPlayManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="SyncPlayChatController"/> class.
    /// </summary>
    /// <param name="sessionManager">The Jellyfin session manager.</param>
    /// <param name="syncPlayManager">The Jellyfin SyncPlay manager.</param>
    public SyncPlayChatController(ISessionManager sessionManager, ISyncPlayManager syncPlayManager)
    {
        _sessionManager = sessionManager;
        _syncPlayManager = syncPlayManager;
    }

    /// <summary>
    /// Stores a chat message for the caller's SyncPlay group.
    /// </summary>
    /// <param name="request">The send request payload.</param>
    /// <returns>The send result.</returns>
    [HttpPost("Send")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public ActionResult<SyncPlayChatSendResponse> Send([FromBody, Required] SyncPlayChatSendRequest request)
    {
        if (request is null)
        {
            return BadRequest("Request body is required.");
        }

        string text = (request.Text ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(text))
        {
            return BadRequest("Text is required.");
        }

        Guid userId = ResolveCurrentUserId();
        if (userId == Guid.Empty)
        {
            return BadRequest("Could not resolve current user id.");
        }

        var allSessions = _sessionManager.Sessions.ToList();
        var controllingSession = ResolveControllingSession(allSessions, userId, request.SenderSessionId);
        if (controllingSession is null)
        {
            return BadRequest("Current session not found.");
        }

        var visibleGroups = _syncPlayManager.ListGroups(controllingSession, new ListGroupsRequest());
        var participantHints = ParseParticipantHints(request.ParticipantsCsv);
        var targetGroup = ResolveTargetGroup(visibleGroups, request.GroupId, participantHints);
        if (targetGroup is null)
        {
            return Ok(new SyncPlayChatSendResponse
            {
                Attempted = 0,
                Sent = 0,
                Failed = 0
            });
        }

        var message = new SyncPlayChatMessage
        {
            Id = Guid.NewGuid().ToString("N"),
            GroupId = targetGroup.GroupId.ToString("D"),
            UserName = ResolveSenderName(controllingSession),
            Text = text,
            TimestampUtc = DateTimeOffset.UtcNow
        };
        AddMessage(message);

        return Ok(new SyncPlayChatSendResponse
        {
            Attempted = 1,
            Sent = 1,
            Failed = 0,
            Message = message
        });
    }

    /// <summary>
    /// Gets chat messages for the caller's SyncPlay group.
    /// </summary>
    /// <param name="groupId">The preferred SyncPlay group identifier.</param>
    /// <param name="senderSessionId">The sender session identifier from the web client.</param>
    /// <param name="participantsCsv">Comma-separated participant hints from group payloads.</param>
    /// <returns>The chat messages for the resolved SyncPlay group.</returns>
    [HttpGet("Messages")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public ActionResult<SyncPlayChatMessagesResponse> Messages(
        [FromQuery] string? groupId,
        [FromQuery] string? senderSessionId,
        [FromQuery] string? participantsCsv)
    {
        Guid userId = ResolveCurrentUserId();
        if (userId == Guid.Empty)
        {
            return BadRequest("Could not resolve current user id.");
        }

        var allSessions = _sessionManager.Sessions.ToList();
        var controllingSession = ResolveControllingSession(allSessions, userId, senderSessionId);
        if (controllingSession is null)
        {
            return BadRequest("Current session not found.");
        }

        var visibleGroups = _syncPlayManager.ListGroups(controllingSession, new ListGroupsRequest());
        var participantHints = ParseParticipantHints(participantsCsv);
        var targetGroup = ResolveTargetGroup(visibleGroups, groupId, participantHints);
        if (targetGroup is null)
        {
            return Ok(new SyncPlayChatMessagesResponse
            {
                GroupId = groupId ?? string.Empty,
                Messages = []
            });
        }

        string resolvedGroupId = targetGroup.GroupId.ToString("D");
        return Ok(new SyncPlayChatMessagesResponse
        {
            GroupId = resolvedGroupId,
            Messages = GetMessages(resolvedGroupId)
        });
    }

    private static GroupInfoDto? ResolveTargetGroup(List<GroupInfoDto> groups, string? requestedGroupId, List<string> participants)
    {
        if (groups.Count == 0)
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(requestedGroupId)
            && Guid.TryParse(requestedGroupId, out var parsedGroupId))
        {
            var direct = groups.FirstOrDefault(group => group.GroupId == parsedGroupId);
            if (direct is not null)
            {
                return direct;
            }
        }

        if (participants.Count > 0)
        {
            var participantSet = new HashSet<string>(participants.Where(static p => !string.IsNullOrWhiteSpace(p)), StringComparer.OrdinalIgnoreCase);
            var best = groups
                .OrderByDescending(group => group.Participants.Count(p => participantSet.Contains(p)))
                .FirstOrDefault();

            if (best is not null)
            {
                return best;
            }
        }

        return groups[0];
    }

    private static void AddMessage(SyncPlayChatMessage message)
    {
        var messages = _messagesByGroup.GetOrAdd(message.GroupId, static _ => []);
        lock (messages)
        {
            messages.Add(message);
            while (messages.Count > MaxMessagesPerGroup)
            {
                messages.RemoveAt(0);
            }
        }
    }

    private static List<SyncPlayChatMessage> GetMessages(string groupId)
    {
        if (!_messagesByGroup.TryGetValue(groupId, out var messages))
        {
            return [];
        }

        lock (messages)
        {
            return messages.ToList();
        }
    }

    private static List<string> ParseParticipantHints(string? participantsCsv)
    {
        if (string.IsNullOrWhiteSpace(participantsCsv))
        {
            return [];
        }

        return participantsCsv
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(static part => !string.IsNullOrWhiteSpace(part))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string ResolveSenderName(SessionInfo session)
    {
        if (!string.IsNullOrWhiteSpace(session.UserName))
        {
            return session.UserName;
        }

        if (!string.IsNullOrWhiteSpace(session.DeviceName))
        {
            return session.DeviceName;
        }

        return "Someone";
    }

    private Guid ResolveCurrentUserId()
    {
        var userIdClaim = User.Claims.FirstOrDefault(claim => string.Equals(claim.Type, "Jellyfin-UserId", StringComparison.OrdinalIgnoreCase))?.Value;
        if (string.IsNullOrWhiteSpace(userIdClaim))
        {
            return Guid.Empty;
        }

        if (Guid.TryParse(userIdClaim, out var userId))
        {
            return userId;
        }

        return Guid.Empty;
    }

    private static SessionInfo? ResolveControllingSession(List<SessionInfo> sessions, Guid userId, string? preferredSessionId)
    {
        if (!string.IsNullOrWhiteSpace(preferredSessionId))
        {
            var preferred = sessions.FirstOrDefault(session =>
                string.Equals(session.Id, preferredSessionId, StringComparison.Ordinal)
                && session.UserId == userId);
            if (preferred is not null)
            {
                return preferred;
            }
        }

        var fromUser = sessions
            .Where(session => session.UserId == userId)
            .OrderByDescending(session => session.LastActivityDate)
            .FirstOrDefault();
        if (fromUser is not null)
        {
            return fromUser;
        }

        return null;
    }
}
