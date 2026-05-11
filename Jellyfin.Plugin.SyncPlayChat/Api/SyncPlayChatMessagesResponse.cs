using System.Collections.Generic;

namespace Jellyfin.Plugin.SyncPlayChat.Api;

/// <summary>
/// Response payload containing SyncPlay chat messages.
/// </summary>
public class SyncPlayChatMessagesResponse
{
    /// <summary>
    /// Gets or sets the SyncPlay group identifier.
    /// </summary>
    public string GroupId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the group chat messages.
    /// </summary>
    public IReadOnlyList<SyncPlayChatMessage> Messages { get; set; } = [];
}
