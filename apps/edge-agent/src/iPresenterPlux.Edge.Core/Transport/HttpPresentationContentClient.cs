using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class HttpPresentationContentClient(
    HttpClient httpClient,
    AgentIdentity identity,
    IDeviceCredentialStore credentialStore,
    TimeProvider? clock = null) : IPresentationContentProvider
{
    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
    private readonly AgentIdentity _identity = identity ?? throw new ArgumentNullException(nameof(identity));
    private readonly IDeviceCredentialStore _credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    public async Task<PresentationRenderItem> GetAsync(string itemId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(itemId, out _)) throw new ArgumentException("Presentation item id must be a UUID.", nameof(itemId));
        var credential = await ReadUsableCredentialAsync(cancellationToken).ConfigureAwait(false);
        var token = Encoding.UTF8.GetString(credential.Material.Span);
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/edge/presentation/items/{itemId}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<PresentationResponse>(cancellationToken: cancellationToken)
            .ConfigureAwait(false) ?? throw new InvalidDataException("The presentation response was empty.");
        if (!payload.Ok || payload.Item is null || !Guid.TryParse(payload.Item.ServiceId, out var serviceId))
            throw new InvalidDataException("The presentation response was invalid.");
        if (!string.Equals(payload.Item.ItemId, itemId, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The presentation item identity did not match the request.");

        return new PresentationRenderItem(
            payload.Item.ItemId,
            serviceId,
            payload.Item.ItemType,
            payload.Item.Title,
            payload.Item.Body,
            payload.Item.Footer,
            payload.Item.Metadata ?? new Dictionary<string, string>());
    }

    private async Task<DeviceCredential> ReadUsableCredentialAsync(CancellationToken cancellationToken)
    {
        var credential = await _credentialStore.ReadAsync(_identity.OrganizationId, _identity.DeviceId, cancellationToken)
            .ConfigureAwait(false) ?? throw new InvalidOperationException("The Edge device is not enrolled.");
        if (credential.Metadata.State == DeviceCredentialState.Revoked ||
            credential.Metadata.ExpiresAt <= _clock.GetUtcNow() || credential.Material.IsEmpty)
            throw new InvalidOperationException("The Edge device credential is not usable.");
        return credential;
    }

    private sealed record PresentationResponse(bool Ok, PresentationPayload? Item);
    private sealed record PresentationPayload(
        string ItemId,
        string ServiceId,
        string ItemType,
        string Title,
        string Body,
        string? Footer,
        IReadOnlyDictionary<string, string>? Metadata);
}
