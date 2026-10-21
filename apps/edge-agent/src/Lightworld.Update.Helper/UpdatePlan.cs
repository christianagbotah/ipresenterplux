using Lightworld.Update.Client;

namespace Lightworld.Update.Helper;

public sealed record UpdatePlan(
    string Product,
    string FromVersion,
    string ToVersion,
    string StagedPackagePath,
    string InstallRoot,
    string DesktopExeRelativePath,
    string HealthToken,
    int HealthTimeoutSeconds,
    long ExpectedPackageSize,
    string ExpectedPackageSha256,
    int ParentProcessId = 0,
    int ParentExitTimeoutSeconds = 30,
    UpdatePackageKind PackageKind = UpdatePackageKind.Full,
    string? FullFallbackUrl = null,
    long? FullFallbackSize = null,
    string? FullFallbackSha256 = null)
{
    public UpdatePlan Normalize()
    {
        var normalizedProduct = Product?.Trim();
        if (!string.Equals(normalizedProduct, "ipresenterplux", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Unsupported update product.");
        if (string.IsNullOrWhiteSpace(FromVersion) || string.IsNullOrWhiteSpace(ToVersion))
            throw new InvalidDataException("Update versions are required.");
        if (string.IsNullOrWhiteSpace(StagedPackagePath) || string.IsNullOrWhiteSpace(InstallRoot))
            throw new InvalidDataException("Update paths are required.");
        if (string.IsNullOrWhiteSpace(DesktopExeRelativePath) || Path.IsPathRooted(DesktopExeRelativePath))
            throw new InvalidDataException("Desktop executable must be relative to the current install directory.");
        if (DesktopExeRelativePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Any(segment => segment == ".."))
            throw new InvalidDataException("Desktop executable path traversal is not allowed.");
        if (string.IsNullOrWhiteSpace(HealthToken) || HealthToken.Length > 200)
            throw new InvalidDataException("A bounded health token is required.");
        if (HealthTimeoutSeconds is < 1 or > 300)
            throw new InvalidDataException("Health timeout must be between 1 and 300 seconds.");
        if (ExpectedPackageSize < 0)
            throw new InvalidDataException("Expected package size is invalid.");
        if (ExpectedPackageSha256 is null || ExpectedPackageSha256.Length != 64 || !ExpectedPackageSha256.All(Uri.IsHexDigit))
            throw new InvalidDataException("Expected package SHA-256 is invalid.");
        if (ParentProcessId < 0)
            throw new InvalidDataException("Parent process id cannot be negative.");
        if (ParentExitTimeoutSeconds is < 1 or > 120)
            throw new InvalidDataException("Parent exit timeout must be between 1 and 120 seconds.");
        if (!Enum.IsDefined(PackageKind))
            throw new InvalidDataException("Update package kind is invalid.");

        string? fallbackUrl = null;
        string? fallbackSha = null;
        long? fallbackSize = null;
        if (PackageKind == UpdatePackageKind.Delta)
        {
            if (!Uri.TryCreate(FullFallbackUrl, UriKind.Absolute, out var fallback) || fallback.Scheme != Uri.UriSchemeHttps ||
                FullFallbackSize is null or <= 0 ||
                FullFallbackSha256 is not { Length: 64 } ||
                !FullFallbackSha256.All(Uri.IsHexDigit))
                throw new InvalidDataException("Delta update requires a valid HTTPS full-package fallback.");
            fallbackUrl = fallback.AbsoluteUri;
            fallbackSize = FullFallbackSize;
            fallbackSha = FullFallbackSha256.ToLowerInvariant();
        }

        return this with
        {
            Product = normalizedProduct!.ToLowerInvariant(),
            FromVersion = FromVersion.Trim(),
            ToVersion = ToVersion.Trim(),
            StagedPackagePath = Path.GetFullPath(StagedPackagePath),
            InstallRoot = Path.GetFullPath(InstallRoot),
            DesktopExeRelativePath = DesktopExeRelativePath.Trim(),
            HealthToken = HealthToken.Trim(),
            ExpectedPackageSha256 = ExpectedPackageSha256.ToLowerInvariant(),
            FullFallbackUrl = fallbackUrl,
            FullFallbackSize = fallbackSize,
            FullFallbackSha256 = fallbackSha
        };
    }
}
