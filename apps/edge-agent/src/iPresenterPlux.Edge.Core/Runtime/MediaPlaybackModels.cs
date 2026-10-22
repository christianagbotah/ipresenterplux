namespace iPresenterPlux.Edge.Core.Runtime;

public sealed record MediaPlaybackSnapshot(
    string ItemId,
    Guid ServiceId,
    string CacheKey,
    string MediaKind,
    string State,
    DateTimeOffset? StartedAtUtc,
    DateTimeOffset? PausedAtUtc,
    double BasePositionSeconds,
    double EffectivePositionSeconds,
    double TrimStartSeconds,
    double? TrimEndSeconds,
    bool Loop,
    double Volume,
    string Fit,
    long Revision,
    string? ErrorCode = null);
