namespace iPresenterPlux.Edge.Core.Contracts;

public sealed record PresentationMediaDescriptor(
    Guid SourceId,
    string MediaKind,
    Uri DownloadUrl,
    string AssetVersion,
    string? ContentTypeHint,
    string Title,
    double TrimStartSeconds,
    double? TrimEndSeconds,
    bool Loop,
    double Volume,
    string Fit)
{
    public PresentationMediaDescriptor Validate()
    {
        if (SourceId == Guid.Empty) throw new ArgumentException("Media source id must be nonempty.", nameof(SourceId));
        if (MediaKind is not ("image" or "video" or "audio")) throw new ArgumentOutOfRangeException(nameof(MediaKind));
        if (!DownloadUrl.IsAbsoluteUri || DownloadUrl.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(DownloadUrl.UserInfo))
            throw new ArgumentException("Media download URL must be credential-free HTTPS.", nameof(DownloadUrl));
        if (string.IsNullOrWhiteSpace(AssetVersion) || AssetVersion.Length > 128)
            throw new ArgumentException("Media asset version is invalid.", nameof(AssetVersion));
        if (ContentTypeHint is { Length: > 120 }) throw new ArgumentOutOfRangeException(nameof(ContentTypeHint));
        if (string.IsNullOrWhiteSpace(Title) || Title.Length > 200) throw new ArgumentOutOfRangeException(nameof(Title));
        if (!double.IsFinite(TrimStartSeconds) || TrimStartSeconds < 0) throw new ArgumentOutOfRangeException(nameof(TrimStartSeconds));
        if (TrimEndSeconds is { } end && (!double.IsFinite(end) || end <= TrimStartSeconds))
            throw new ArgumentOutOfRangeException(nameof(TrimEndSeconds));
        if (!double.IsFinite(Volume) || Volume < 0 || Volume > 1) throw new ArgumentOutOfRangeException(nameof(Volume));
        if (Fit is not ("contain" or "cover")) throw new ArgumentOutOfRangeException(nameof(Fit));
        return this;
    }
}
