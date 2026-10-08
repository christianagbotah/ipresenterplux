using System.Net.Http.Json;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Security;

namespace iPresenterPlux.Edge.Desktop;

public sealed class EntitlementClient
{
    private readonly HttpClient _httpClient;
    private readonly IEntitlementStore _store;
    private readonly IReadOnlyDictionary<string, byte[]> _publicKeys;

    public EntitlementClient(
        HttpClient httpClient,
        IEntitlementStore store,
        IReadOnlyDictionary<string, byte[]> publicKeys)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _publicKeys = publicKeys ?? throw new ArgumentNullException(nameof(publicKeys));
    }

    public async Task<EntitlementValidation> ActivateAsync(
        Uri controlPlane,
        string productKey,
        string installationId,
        string platform,
        string appVersion,
        string deviceName,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(controlPlane);
        ArgumentException.ThrowIfNullOrWhiteSpace(productKey);
        ArgumentException.ThrowIfNullOrWhiteSpace(installationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(platform);
        ArgumentException.ThrowIfNullOrWhiteSpace(appVersion);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceName);

        using var response = await _httpClient.PostAsJsonAsync(
            Endpoint(controlPlane, "/api/v1/licensing/activate"),
            new
            {
                productKey,
                installationId,
                platform,
                appVersion,
                deviceName
            },
            cancellationToken).ConfigureAwait(false);

        var payload = await ReadResponseAsync<ActivationResponse>(response, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode || payload is null || string.IsNullOrWhiteSpace(payload.ActivationId) ||
            string.IsNullOrWhiteSpace(payload.ActivationToken) || string.IsNullOrWhiteSpace(payload.Entitlement))
        {
            throw new InvalidOperationException("Product activation was rejected by the Control Plane.");
        }

        var validation = EntitlementVerifier.Verify(payload.Entitlement, _publicKeys, DateTimeOffset.UtcNow, null);
        if (!validation.IsUsable || validation.Payload is null)
            throw new InvalidDataException($"Control Plane returned an unusable entitlement ({validation.ErrorCode ?? "invalid"}).");
        if (!string.Equals(validation.Payload.ActivationId, payload.ActivationId, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(validation.Payload.InstallationId, installationId, StringComparison.Ordinal))
        {
            throw new InvalidDataException("Activation entitlement does not match this installation.");
        }

        await _store.SaveAsync(new DesktopEntitlementCache(
            payload.ActivationId,
            installationId,
            payload.ActivationToken,
            payload.Entitlement,
            validation.TrustedNow), cancellationToken).ConfigureAwait(false);

        return validation;
    }

    public async Task<EntitlementValidation> RenewAsync(Uri controlPlane, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(controlPlane);
        var cache = await _store.ReadAsync(cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException("This installation is not activated.");

        var current = EntitlementVerifier.Verify(cache.Envelope, _publicKeys, DateTimeOffset.UtcNow, cache.LastTrustedNow);
        if (current.Payload is null)
            throw new InvalidDataException("Cached entitlement cannot be renewed because its signature is invalid.");

        using var response = await _httpClient.PostAsJsonAsync(
            Endpoint(controlPlane, "/api/v1/licensing/renew"),
            new
            {
                activationId = cache.ActivationId,
                installationId = cache.InstallationId,
                activationToken = cache.ActivationToken,
                currentEntitlementId = current.Payload.EntitlementId
            },
            cancellationToken).ConfigureAwait(false);

        var payload = await ReadResponseAsync<RenewalResponse>(response, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode || payload is null || string.IsNullOrWhiteSpace(payload.Entitlement))
            throw new InvalidOperationException("Entitlement renewal was rejected by the Control Plane.");

        var validation = EntitlementVerifier.Verify(payload.Entitlement, _publicKeys, DateTimeOffset.UtcNow, current.TrustedNow);
        if (!validation.IsUsable || validation.Payload is null)
            throw new InvalidDataException($"Control Plane returned an unusable renewed entitlement ({validation.ErrorCode ?? "invalid"}).");
        if (!string.Equals(validation.Payload.ActivationId, cache.ActivationId, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(validation.Payload.InstallationId, cache.InstallationId, StringComparison.Ordinal))
        {
            throw new InvalidDataException("Renewed entitlement does not match this installation.");
        }

        await _store.SaveAsync(cache with
        {
            Envelope = payload.Entitlement,
            LastTrustedNow = validation.TrustedNow
        }, cancellationToken).ConfigureAwait(false);

        return validation;
    }

    private static Uri Endpoint(Uri controlPlane, string path)
    {
        if (!controlPlane.IsAbsoluteUri || (controlPlane.Scheme != Uri.UriSchemeHttps && controlPlane.Scheme != Uri.UriSchemeHttp))
            throw new ArgumentException("Control Plane URL must be an absolute HTTP(S) URL.", nameof(controlPlane));
        return new Uri(controlPlane, path);
    }

    private static async Task<T?> ReadResponseAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            return await response.Content.ReadFromJsonAsync<T>(new JsonSerializerOptions(JsonSerializerDefaults.Web), cancellationToken).ConfigureAwait(false);
        }
        catch (JsonException)
        {
            return default;
        }
    }

    private sealed record ActivationResponse(bool Ok, string ActivationId, string ActivationToken, string Entitlement);
    private sealed record RenewalResponse(bool Ok, string ActivationId, string Entitlement);
}
