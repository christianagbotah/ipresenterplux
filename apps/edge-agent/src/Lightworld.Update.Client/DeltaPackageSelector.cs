namespace Lightworld.Update.Client;

public static class DeltaPackageSelector
{
    public static DeltaPackageManifest? Select(string currentVersion, ReleaseManifestV1 manifest)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(currentVersion);
        ArgumentNullException.ThrowIfNull(manifest);
        if (manifest.FullPackage.Size <= 0) return null;

        return manifest.DeltaPackages
            .Where(delta =>
                string.Equals(delta.FromVersion, currentVersion, StringComparison.Ordinal) &&
                delta.Size > 0 &&
                delta.Size < manifest.FullPackage.Size &&
                Uri.TryCreate(delta.Url, UriKind.Absolute, out var uri) &&
                uri.Scheme == Uri.UriSchemeHttps &&
                delta.Sha256 is { Length: 64 } &&
                delta.Sha256.All(Uri.IsHexDigit))
            .OrderBy(delta => delta.Size)
            .FirstOrDefault();
    }
}
