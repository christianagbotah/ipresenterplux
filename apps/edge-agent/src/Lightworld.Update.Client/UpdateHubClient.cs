using System.Net.Http.Json;
using System.Text.Json;

namespace Lightworld.Update.Client;

public sealed class UpdateHubClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _httpClient;
    private readonly Uri _baseUri;

    public UpdateHubClient(HttpClient httpClient, Uri baseUri)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _baseUri = baseUri ?? throw new ArgumentNullException(nameof(baseUri));
        if (!_baseUri.IsAbsoluteUri) throw new ArgumentException("Update Hub URL must be absolute.", nameof(baseUri));
        if (_baseUri.Scheme != Uri.UriSchemeHttps && !_baseUri.IsLoopback)
            throw new InvalidOperationException("Remote Update Hub URLs must use HTTPS.");
    }

    public async Task<UpdateCheckResult> CheckAsync(UpdateIdentity identity, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(identity);
        var relative = $"api/v1/products/{Uri.EscapeDataString(identity.Product)}/updates/check" +
            $"?version={Uri.EscapeDataString(identity.Version)}" +
            $"&channel={Uri.EscapeDataString(identity.Channel)}" +
            $"&platform={Uri.EscapeDataString(identity.Platform)}" +
            $"&architecture={Uri.EscapeDataString(identity.Architecture)}" +
            $"&installationId={Uri.EscapeDataString(identity.InstallationId)}";
        using var response = await _httpClient.GetAsync(new Uri(_baseUri, relative), cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var wire = await response.Content.ReadFromJsonAsync<UpdateCheckWire>(JsonOptions, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidDataException("The Update Hub returned an empty update-check response.");
        if (string.Equals(wire.Status, "no-update", StringComparison.Ordinal)) return UpdateCheckResult.NoUpdate;
        if (!string.Equals(wire.Status, "update", StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(wire.Version) ||
            !Uri.TryCreate(wire.ManifestUrl, UriKind.Absolute, out var manifestUrl) ||
            !Uri.TryCreate(wire.SignatureUrl, UriKind.Absolute, out var signatureUrl))
            throw new InvalidDataException("The Update Hub returned an invalid update-check response.");
        RequireSecure(manifestUrl);
        RequireSecure(signatureUrl);
        return new UpdateCheckResult(true, wire.Version, manifestUrl, signatureUrl);
    }

    public async Task<ReleaseManifestV1> FetchVerifiedManifestAsync(
        UpdateCheckResult update,
        UpdateManifestVerifier verifier,
        CancellationToken cancellationToken)
    {
        if (!update.HasUpdate || update.ManifestUrl is null || update.SignatureUrl is null)
            throw new InvalidOperationException("No update manifest is available for this result.");
        var manifestBytes = await _httpClient.GetByteArrayAsync(update.ManifestUrl, cancellationToken).ConfigureAwait(false);
        var detachedBytes = await _httpClient.GetByteArrayAsync(update.SignatureUrl, cancellationToken).ConfigureAwait(false);
        var detached = JsonSerializer.Deserialize<DetachedManifestSignature>(detachedBytes, JsonOptions)
            ?? throw new InvalidDataException("The update signature file is invalid.");
        if (detached.SchemaVersion != 1 || !string.Equals(detached.Algorithm, "Ed25519", StringComparison.Ordinal))
            throw new InvalidDataException("The update signature format is unsupported.");
        byte[] signature;
        try { signature = Convert.FromBase64String(detached.Signature); }
        catch (FormatException error) { throw new InvalidDataException("The update signature encoding is invalid.", error); }
        verifier.Verify(manifestBytes, signature, detached.KeyId);
        var manifest = JsonSerializer.Deserialize<ReleaseManifestV1>(manifestBytes, JsonOptions)
            ?? throw new InvalidDataException("The verified update manifest is invalid JSON.");
        if (manifest.SchemaVersion != 1) throw new InvalidDataException("The update manifest schema is unsupported.");
        return manifest;
    }

    private static void RequireSecure(Uri uri)
    {
        if (uri.Scheme != Uri.UriSchemeHttps && !uri.IsLoopback)
            throw new InvalidDataException("Update manifest URLs must use HTTPS.");
    }
}
