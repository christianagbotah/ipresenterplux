namespace iPresenterPlux.Edge.Core.Runtime;

public sealed record MediaAssetCacheOptions(
    long ImageLimitBytes = 26_214_400,
    long AudioLimitBytes = 524_288_000,
    long VideoLimitBytes = 4_294_967_296,
    long TotalQuotaBytes = 21_474_836_480,
    int MaxConcurrentDownloads = 2)
{
    public MediaAssetCacheOptions Validate()
    {
        if (ImageLimitBytes <= 0) throw new ArgumentOutOfRangeException(nameof(ImageLimitBytes));
        if (AudioLimitBytes <= 0) throw new ArgumentOutOfRangeException(nameof(AudioLimitBytes));
        if (VideoLimitBytes <= 0) throw new ArgumentOutOfRangeException(nameof(VideoLimitBytes));
        if (TotalQuotaBytes <= 0) throw new ArgumentOutOfRangeException(nameof(TotalQuotaBytes));
        if (MaxConcurrentDownloads <= 0) throw new ArgumentOutOfRangeException(nameof(MaxConcurrentDownloads));
        return this;
    }

    public long LimitFor(string mediaKind) => mediaKind switch
    {
        "image" => ImageLimitBytes,
        "audio" => AudioLimitBytes,
        "video" => VideoLimitBytes,
        _ => throw new MediaAssetCacheException("media_type_invalid", "Unsupported media family.")
    };
}

public sealed record MediaAssetCacheEntry(
    string CacheKey,
    string Path,
    string ContentType,
    string MediaKind,
    string Sha256,
    long Length,
    DateTimeOffset LastAccessedAt);

public sealed class MediaAssetCacheException(string code, string message, Exception? innerException = null)
    : IOException(message, innerException)
{
    public string Code { get; } = code;
}

internal sealed record MediaAssetCacheManifest(
    string CacheKey,
    Guid OrganizationId,
    Guid SourceId,
    string AssetVersion,
    string ContentType,
    string MediaKind,
    string Sha256,
    long Length,
    DateTimeOffset LastAccessedAt);
