using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class HttpDeviceEnrollmentClient(HttpClient httpClient) : IDeviceEnrollmentClient
{
    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));

    public async Task<DeviceCredential> ExchangePairingCodeAsync(
        PairingCodeExchangeRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        using var response = await _httpClient.PostAsJsonAsync(
            "/api/v1/edge/enroll",
            new
            {
                pairingCode = request.PairingCode,
                deviceName = request.DeviceName,
                softwareVersion = request.SoftwareVersion
            },
            cancellationToken);

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<CredentialEnvelope>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("The enrollment response was empty.");

        return ToCredential(body, request.SoftwareVersion);
    }

    public async Task<DeviceCredential> RotateCredentialAsync(
        DeviceCredential current,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(current);

        using var request = CreateBearerRequest(HttpMethod.Post, "/api/v1/edge/credentials/rotate", current.Material);
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<CredentialEnvelope>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("The rotation response was empty.");

        return ToCredential(body, current.Metadata.Identity.SoftwareVersion);
    }

    public async Task<DeviceCredentialMetadata> RevokeCredentialAsync(
        DeviceCredential current,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(current);

        using var request = CreateBearerRequest(HttpMethod.Post, "/api/v1/edge/credentials/revoke", current.Material);
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<RevocationEnvelope>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("The revocation response was empty.");

        return current.Metadata with
        {
            State = DeviceCredentialState.Revoked,
            RevokedAt = body.Metadata.RevokedAt
        };
    }

    private static HttpRequestMessage CreateBearerRequest(
        HttpMethod method,
        string route,
        ReadOnlyMemory<byte> material)
    {
        if (material.IsEmpty)
        {
            throw new InvalidOperationException("Device credential material is empty.");
        }

        var token = Encoding.UTF8.GetString(material.Span);
        var request = new HttpRequestMessage(method, route);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return request;
    }

    private static DeviceCredential ToCredential(CredentialEnvelope envelope, string softwareVersion)
    {
        if (!envelope.Ok || string.IsNullOrWhiteSpace(envelope.Credential))
        {
            throw new InvalidOperationException("The control plane did not return a device credential.");
        }

        var metadata = envelope.Metadata;
        var identity = new AgentIdentity(
            Guid.Parse(metadata.DeviceId),
            Guid.Parse(metadata.OrganizationId),
            string.IsNullOrWhiteSpace(metadata.CampusId) ? null : Guid.Parse(metadata.CampusId),
            metadata.DeviceName,
            softwareVersion);

        var credentialMetadata = new DeviceCredentialMetadata(
            identity,
            Guid.Parse(metadata.CredentialId),
            metadata.IssuedAt,
            metadata.ExpiresAt,
            ParseState(metadata.State),
            string.IsNullOrWhiteSpace(metadata.ReplacesCredentialId)
                ? null
                : Guid.Parse(metadata.ReplacesCredentialId));

        return new DeviceCredential(
            credentialMetadata,
            Encoding.UTF8.GetBytes(envelope.Credential));
    }

    private static DeviceCredentialState ParseState(string state) => state.ToLowerInvariant() switch
    {
        "active" => DeviceCredentialState.Active,
        "rotation_required" => DeviceCredentialState.RotationRequired,
        "revoked" => DeviceCredentialState.Revoked,
        _ => throw new InvalidOperationException($"Unknown device credential state: {state}")
    };

    private sealed record CredentialEnvelope(
        bool Ok,
        string Credential,
        CredentialMetadataDto Metadata);

    private sealed record CredentialMetadataDto(
        string DeviceId,
        string OrganizationId,
        string? CampusId,
        string DeviceName,
        string CredentialId,
        DateTimeOffset IssuedAt,
        DateTimeOffset ExpiresAt,
        string State,
        string? ReplacesCredentialId);

    private sealed record RevocationEnvelope(
        bool Ok,
        RevocationMetadataDto Metadata);

    private sealed record RevocationMetadataDto(
        string DeviceId,
        string OrganizationId,
        string? CampusId,
        string DeviceName,
        string CredentialId,
        string State,
        DateTimeOffset RevokedAt);
}
