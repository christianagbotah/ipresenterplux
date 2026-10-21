using System.Text.Json.Serialization;

namespace Lightworld.Update.Client;

public enum UpdatePackageKind
{
    Full = 0,
    Delta = 1
}

public sealed record UpdateIdentity(
    string Product,
    string Version,
    string Channel,
    string Platform,
    string Architecture,
    string InstallationId);

public sealed record UpdateCheckResult(
    bool HasUpdate,
    string? Version,
    Uri? ManifestUrl,
    Uri? SignatureUrl)
{
    public static UpdateCheckResult NoUpdate { get; } = new(false, null, null, null);
}

public sealed record FullPackageManifest(
    string Url,
    long Size,
    string Sha256);

public sealed record DeltaPackageManifest(
    string FromVersion,
    string Url,
    long Size,
    string Sha256);

public sealed record ReleaseManifestV1(
    int SchemaVersion,
    string Product,
    string Version,
    string Channel,
    string Platform,
    string Architecture,
    string? MinimumVersion,
    DateTimeOffset PublishedAt,
    string ReleaseNotes,
    FullPackageManifest FullPackage,
    IReadOnlyList<DeltaPackageManifest> DeltaPackages,
    int Rollout);

public sealed record DetachedManifestSignature(
    int SchemaVersion,
    string KeyId,
    string Algorithm,
    string Signature);

internal sealed record UpdateCheckWire(
    string Status,
    string? Version,
    string? ManifestUrl,
    string? SignatureUrl);
