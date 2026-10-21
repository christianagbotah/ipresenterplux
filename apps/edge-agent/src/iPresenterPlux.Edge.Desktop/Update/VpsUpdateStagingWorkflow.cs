using System.Runtime.InteropServices;
using Lightworld.Update.Client;

namespace iPresenterPlux.Edge.Desktop.Update;

public interface IUpdateStagingWorkflow
{
    Task<StagedDesktopUpdate?> CheckAndStageAsync(
        DesktopSettings settings,
        string currentVersion,
        CancellationToken cancellationToken);
}

public sealed class VpsUpdateStagingWorkflow(
    HttpClient httpClient,
    IReadOnlyDictionary<string, byte[]> publicKeys,
    string stagingDirectory) : IUpdateStagingWorkflow
{
    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
    private readonly IReadOnlyDictionary<string, byte[]> _publicKeys = publicKeys ?? throw new ArgumentNullException(nameof(publicKeys));
    private readonly string _stagingDirectory = Path.GetFullPath(stagingDirectory);

    public async Task<StagedDesktopUpdate?> CheckAndStageAsync(
        DesktopSettings settings,
        string currentVersion,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentException.ThrowIfNullOrWhiteSpace(currentVersion);
        var normalized = settings.NormalizeUpdateSettings();
        if (!OperatingSystem.IsWindows()) return null;

        var architecture = RuntimeInformation.ProcessArchitecture switch
        {
            Architecture.X64 => "x64",
            Architecture.Arm64 => "arm64",
            _ => RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant()
        };
        if (!string.Equals(architecture, "x64", StringComparison.Ordinal)) return null;

        var client = new UpdateHubClient(_httpClient, EnsureTrailingSlash(normalized.ValidateUpdateHubUri()));
        var identity = new UpdateIdentity(
            "ipresenterplux",
            currentVersion,
            normalized.UpdateChannel,
            "windows",
            architecture,
            normalized.InstallationId);
        var check = await client.CheckAsync(identity, cancellationToken).ConfigureAwait(false);
        if (!check.HasUpdate) return null;
        if (_publicKeys.Count == 0)
            throw new InvalidDataException("This desktop release does not contain a Lightworld update verification key.");

        var manifest = await client.FetchVerifiedManifestAsync(
            check,
            new UpdateManifestVerifier(_publicKeys),
            cancellationToken).ConfigureAwait(false);
        ValidateManifest(manifest, normalized.UpdateChannel, architecture, check.Version);

        var fullUri = RequireHttpsPackageUri(manifest.FullPackage.Url, "full");
        var safeVersion = string.Concat(manifest.Version.Select(character =>
            char.IsLetterOrDigit(character) || character is '.' or '-' or '_' ? character : '_'));
        Directory.CreateDirectory(_stagingDirectory);

        var selectedDelta = DeltaPackageSelector.Select(currentVersion, manifest);
        if (selectedDelta is not null)
        {
            try
            {
                var deltaUri = RequireHttpsPackageUri(selectedDelta.Url, "delta");
                var deltaDestination = Path.Combine(_stagingDirectory, $"ipresenterplux-{safeVersion}-windows-x64.delta.zip");
                await DownloadAndVerifyAsync(
                    deltaUri,
                    deltaDestination,
                    selectedDelta.Size,
                    selectedDelta.Sha256,
                    cancellationToken).ConfigureAwait(false);
                return new StagedDesktopUpdate(
                    manifest.Version,
                    deltaDestination,
                    selectedDelta.Size,
                    selectedDelta.Sha256.ToLowerInvariant(),
                    manifest.ReleaseNotes,
                    DateTimeOffset.UtcNow,
                    UpdatePackageKind.Delta,
                    fullUri.AbsoluteUri,
                    manifest.FullPackage.Size,
                    manifest.FullPackage.Sha256.ToLowerInvariant());
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch
            {
                // A bad or interrupted delta must not block a valid signed full package.
            }
        }

        var fullDestination = Path.Combine(_stagingDirectory, $"ipresenterplux-{safeVersion}-windows-x64.zip");
        await DownloadAndVerifyAsync(
            fullUri,
            fullDestination,
            manifest.FullPackage.Size,
            manifest.FullPackage.Sha256,
            cancellationToken).ConfigureAwait(false);
        return new StagedDesktopUpdate(
            manifest.Version,
            fullDestination,
            manifest.FullPackage.Size,
            manifest.FullPackage.Sha256.ToLowerInvariant(),
            manifest.ReleaseNotes,
            DateTimeOffset.UtcNow);
    }

    private async Task DownloadAndVerifyAsync(
        Uri source,
        string destination,
        long expectedSize,
        string expectedSha256,
        CancellationToken cancellationToken)
    {
        await new ResumableDownloader(_httpClient).DownloadAsync(
            source,
            destination,
            expectedSize,
            cancellationToken).ConfigureAwait(false);
        try
        {
            await PackageVerifier.VerifyAsync(
                destination,
                expectedSize,
                expectedSha256,
                cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            try { if (File.Exists(destination)) File.Delete(destination); } catch { }
            throw;
        }
    }

    private static void ValidateManifest(
        ReleaseManifestV1 manifest,
        string channel,
        string architecture,
        string? expectedVersion)
    {
        if (manifest.SchemaVersion != 1 ||
            !string.Equals(manifest.Product, "ipresenterplux", StringComparison.Ordinal) ||
            !string.Equals(manifest.Platform, "windows", StringComparison.Ordinal) ||
            !string.Equals(manifest.Architecture, architecture, StringComparison.Ordinal) ||
            !string.Equals(manifest.Channel, channel, StringComparison.Ordinal) ||
            !string.Equals(manifest.Version, expectedVersion, StringComparison.Ordinal) ||
            manifest.FullPackage.Size <= 0 ||
            manifest.FullPackage.Sha256 is not { Length: 64 } ||
            !manifest.FullPackage.Sha256.All(Uri.IsHexDigit) ||
            manifest.Rollout is < 0 or > 100)
            throw new InvalidDataException("The signed update manifest is not compatible with this installation.");
    }

    private static Uri RequireHttpsPackageUri(string value, string label)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidDataException($"The signed update manifest contains an invalid {label} package URL.");
        return uri;
    }

    private static Uri EnsureTrailingSlash(Uri uri) =>
        uri.AbsoluteUri.EndsWith("/", StringComparison.Ordinal) ? uri : new Uri(uri.AbsoluteUri + "/");
}
