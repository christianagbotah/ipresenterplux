using Lightworld.Update.Client;

namespace Lightworld.Update.Helper;

public sealed class UpdateCandidatePreparer(HttpClient httpClient)
{
    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));

    public async Task<string> PrepareAsync(UpdatePlan plan, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(plan);
        var normalized = plan.Normalize();
        await PackageVerifier.VerifyAsync(
            normalized.StagedPackagePath,
            normalized.ExpectedPackageSize,
            normalized.ExpectedPackageSha256,
            cancellationToken).ConfigureAwait(false);

        if (normalized.PackageKind == UpdatePackageKind.Full)
        {
            return await new AtomicInstallSwitcher(normalized.InstallRoot).PrepareCandidateAsync(
                normalized.StagedPackagePath,
                normalized.HealthToken,
                cancellationToken).ConfigureAwait(false);
        }

        try
        {
            return await new FileDeltaApplier(normalized.InstallRoot).PrepareCandidateAsync(
                normalized.StagedPackagePath,
                normalized.FromVersion,
                normalized.ToVersion,
                normalized.HealthToken,
                cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return await PrepareFullFallbackAsync(normalized, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task<string> PrepareFullFallbackAsync(UpdatePlan plan, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(plan.FullFallbackUrl, UriKind.Absolute, out var fallbackUri) || fallbackUri.Scheme != Uri.UriSchemeHttps ||
            plan.FullFallbackSize is null or <= 0 ||
            plan.FullFallbackSha256 is not { Length: 64 })
            throw new InvalidDataException("Delta fallback package metadata is unavailable.");

        var staging = Path.Combine(plan.InstallRoot, "staging");
        Directory.CreateDirectory(staging);
        var fallbackPath = Path.Combine(staging, $"fallback-{plan.HealthToken}.zip");
        try
        {
            await new ResumableDownloader(_httpClient).DownloadAsync(
                fallbackUri,
                fallbackPath,
                plan.FullFallbackSize.Value,
                cancellationToken).ConfigureAwait(false);
            await PackageVerifier.VerifyAsync(
                fallbackPath,
                plan.FullFallbackSize.Value,
                plan.FullFallbackSha256,
                cancellationToken).ConfigureAwait(false);
            return await new AtomicInstallSwitcher(plan.InstallRoot).PrepareCandidateAsync(
                fallbackPath,
                plan.HealthToken,
                cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            try { if (File.Exists(fallbackPath)) File.Delete(fallbackPath); } catch { }
            throw;
        }
    }
}
