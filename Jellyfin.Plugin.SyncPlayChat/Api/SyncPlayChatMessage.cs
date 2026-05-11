using System;

namespace Jellyfin.Plugin.SyncPlayChat.Api;

/// <summary>
/// A SyncPlay chat message.
/// </summary>
public class SyncPlayChatMessage
{
    /// <summary>
    /// Gets or sets the message identifier.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the SyncPlay group identifier.
    /// </summary>
    public string GroupId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the sender username.
    /// </summary>
    public string UserName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the sender user identifier.
    /// </summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the message text.
    /// </summary>
    public string Text { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the UTC timestamp when the message was sent.
    /// </summary>
    public DateTimeOffset TimestampUtc { get; set; }
}
