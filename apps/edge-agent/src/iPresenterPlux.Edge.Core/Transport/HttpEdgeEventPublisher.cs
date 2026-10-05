using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class HttpEdgeEventPublisher(
    HttpClient httpClient,
    AgentIdentity identity,
    IDeviceCredentialStore credentialStore) : IEdgeEventPublisher
{
    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
    private readonly AgentIdentity _identity = identity ?? throw new ArgumentNullException(nameof(identity));
    private readonly IDeviceCredentialStore _credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));

    public Task PublishHealthAsync(Guid eventId, EdgeDeviceHealth health, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(health);
        return PostAsync(
            "/api/v1/edge/heartbeat",
            new
            {
                eventId,
                deviceId = _identity.DeviceId,
                deviceName = health.DeviceName,
                version = health.Version,
                status = health.Status,
                observedAt = health.ObservedAt,
                cpuPercent = health.CpuPercent,
                memoryPercent = health.MemoryPercent,
                uplinkMbps = health.UplinkMbps,
                capabilities = health.Capabilities
            },
            cancellationToken);
    }

    public Task PublishTranscriptAsync(Guid eventId, TranscriptSegment segment, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(segment);
        if (segment.WireVersion == 2)
        {
            return PostAsync(
                "/api/v1/edge/transcript",
                new
                {
                    eventId,
                    serviceId = segment.ServiceId,
                    startedAt = segment.StartedAt,
                    text = segment.Text,
                    wireVersion = 2,
                    language = segment.Language,
                    speakerId = segment.SpeakerId,
                    confidence = segment.Confidence
                },
                cancellationToken);
        }

        return PostAsync(
            "/api/v1/edge/transcript",
            new
            {
                eventId,
                serviceId = segment.ServiceId,
                startedAt = segment.StartedAt,
                text = segment.Text
            },
            cancellationToken);
    }

    public Task PublishMediaSourceStateAsync(Guid eventId, MediaSourceState state, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(state);
        return PostAsync(
            "/api/v1/edge/media-source",
            new
            {
                eventId,
                sourceId = state.SourceId,
                name = state.Name,
                sourceType = state.SourceType,
                status = state.Status,
                observedAt = state.ObservedAt,
                metadata = state.Metadata
            },
            cancellationToken);
    }

    private async Task PostAsync(string route, object payload, CancellationToken cancellationToken)
    {
        var credential = await _credentialStore.ReadAsync(
            _identity.OrganizationId,
            _identity.DeviceId,
            cancellationToken)
            ?? throw new InvalidOperationException("The Edge device is not enrolled.");

        if (credential.Metadata.State == DeviceCredentialState.Revoked ||
            credential.Metadata.ExpiresAt <= DateTimeOffset.UtcNow ||
            credential.Material.IsEmpty)
        {
            throw new InvalidOperationException("The Edge device credential is not usable.");
        }

        var token = Encoding.UTF8.GetString(credential.Material.Span);
        using var request = new HttpRequestMessage(HttpMethod.Post, route)
        {
            Content = JsonContent.Create(payload)
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }
}
