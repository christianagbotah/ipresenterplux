using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class HttpEdgeAssignmentClient(
    HttpClient httpClient,
    AgentIdentity identity,
    IDeviceCredentialStore credentialStore)
{
    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
    private readonly AgentIdentity _identity = identity ?? throw new ArgumentNullException(nameof(identity));
    private readonly IDeviceCredentialStore _credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));

    public async Task<EdgeServiceAssignment?> GetAsync(CancellationToken cancellationToken = default)
    {
        var credential = await _credentialStore.ReadAsync(
            _identity.OrganizationId,
            _identity.DeviceId,
            cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException("The Edge device is not enrolled.");

        if (credential.Metadata.State == DeviceCredentialState.Revoked ||
            credential.Metadata.ExpiresAt <= DateTimeOffset.UtcNow ||
            credential.Material.IsEmpty)
        {
            throw new InvalidOperationException("The Edge device credential is not usable.");
        }

        var token = Encoding.UTF8.GetString(credential.Material.Span);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/edge/assignment");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<AssignmentResponse>(cancellationToken: cancellationToken)
            .ConfigureAwait(false)
            ?? throw new InvalidDataException("The Edge assignment response was empty.");
        if (!payload.Ok) throw new InvalidDataException("The Edge assignment response was invalid.");
        if (payload.Assignment is null) return null;
        if (!Guid.TryParse(payload.Assignment.ServiceId, out var serviceId))
            throw new InvalidDataException("The Edge assignment service id was invalid.");
        if (payload.Assignment.Status is not ("ready" or "live"))
            throw new InvalidDataException("The Edge assignment service state was invalid.");

        return new EdgeServiceAssignment(serviceId, payload.Assignment.Title, payload.Assignment.Status);
    }

    private sealed record AssignmentResponse(bool Ok, AssignmentPayload? Assignment);
    private sealed record AssignmentPayload(string ServiceId, string Title, string Status, string? CampusId);
}
