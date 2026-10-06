using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class HttpStreamContributionClient(
    HttpClient httpClient,
    AgentIdentity identity,
    IDeviceCredentialStore credentialStore,
    TimeProvider? clock = null) : IStreamContributionClient
{
    private static readonly TimeSpan MinimumRemainingValidity = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan MaximumExpectedValidity = TimeSpan.FromMinutes(15);

    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
    private readonly AgentIdentity _identity = identity ?? throw new ArgumentNullException(nameof(identity));
    private readonly IDeviceCredentialStore _credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    public async Task<StreamContributionGrant> GetAsync(Guid expectedServiceId, CancellationToken cancellationToken)
    {
        if (expectedServiceId == Guid.Empty) throw new ArgumentException("Expected service id is required.", nameof(expectedServiceId));

        var credential = await ReadUsableCredentialAsync(cancellationToken).ConfigureAwait(false);
        var token = Encoding.UTF8.GetString(credential.Material.Span);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/edge/stream/contribution");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true, NoStore = true };

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<ContributionResponse>(cancellationToken: cancellationToken)
            .ConfigureAwait(false) ?? throw new InvalidDataException("The stream contribution response was empty.");
        if (!payload.Ok || payload.Contribution is null)
            throw new InvalidDataException("The stream contribution response was invalid.");

        var contribution = payload.Contribution;
        if (!Guid.TryParse(contribution.SessionId, out var sessionId) || sessionId == Guid.Empty ||
            !Guid.TryParse(contribution.ServiceId, out var serviceId) || serviceId == Guid.Empty ||
            serviceId != expectedServiceId)
            throw new InvalidDataException("The stream contribution scope was invalid.");
        if (string.IsNullOrWhiteSpace(contribution.StreamPath) || contribution.StreamPath.Length > 255)
            throw new InvalidDataException("The stream contribution path was invalid.");
        if (!string.Equals(contribution.Protocol, "srt", StringComparison.Ordinal))
            throw new InvalidDataException("The stream contribution protocol was invalid.");
        if (!Uri.TryCreate(contribution.PublishUrl, UriKind.Absolute, out var publishUri) ||
            !string.Equals(publishUri.Scheme, "srt", StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrWhiteSpace(publishUri.Host))
            throw new InvalidDataException("The stream contribution publish target was invalid.");
        if (!DateTimeOffset.TryParse(contribution.ExpiresAt, out var expiresAt))
            throw new InvalidDataException("The stream contribution expiry was invalid.");

        var now = _clock.GetUtcNow();
        if (expiresAt <= now.Add(MinimumRemainingValidity) || expiresAt > now.Add(MaximumExpectedValidity))
            throw new InvalidDataException("The stream contribution lifetime was invalid.");
        if (!HasExpectedMediaMtxStreamId(publishUri, contribution.StreamPath))
            throw new InvalidDataException("The stream contribution publish target did not match its path.");

        return new StreamContributionGrant(sessionId, serviceId, contribution.StreamPath, contribution.Protocol, publishUri, expiresAt);
    }

    private static bool HasExpectedMediaMtxStreamId(Uri publishUri, string streamPath)
    {
        var query = publishUri.Query.TrimStart('?');
        string? streamId = null;
        string? packetSize = null;
        foreach (var part in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            var key = Uri.UnescapeDataString(pair[0]);
            var value = pair.Length == 2 ? Uri.UnescapeDataString(pair[1]) : string.Empty;
            if (key == "streamid") streamId = value;
            else if (key == "pkt_size") packetSize = value;
        }

        if (!string.Equals(packetSize, "1316", StringComparison.Ordinal)) return false;
        if (streamId is null) return false;
        var fields = streamId.Split(':', 4);
        return fields.Length == 4 &&
               fields[0] == "publish" &&
               fields[1] == streamPath &&
               fields[2] == "edge" &&
               !string.IsNullOrWhiteSpace(fields[3]);
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

    private sealed record ContributionResponse(bool Ok, ContributionPayload? Contribution);
    private sealed record ContributionPayload(
        string SessionId,
        string ServiceId,
        string StreamPath,
        string Protocol,
        string PublishUrl,
        string ExpiresAt);
}
