using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public enum MediaPreparationState
{
    NotRequired,
    Queued,
    Downloading,
    Validating,
    Ready,
    Unsupported,
    Failed
}

public sealed record PreparedMediaAsset(
    string ItemId,
    Guid ServiceId,
    string CacheKey,
    string LocalPath,
    string ContentType,
    string MediaKind,
    TimeSpan? Duration,
    PresentationMediaDescriptor Descriptor);

public sealed record MediaPreparationSnapshot(
    string ItemId,
    Guid ServiceId,
    MediaPreparationState State,
    PreparedMediaAsset? Asset,
    string? ErrorCode);
