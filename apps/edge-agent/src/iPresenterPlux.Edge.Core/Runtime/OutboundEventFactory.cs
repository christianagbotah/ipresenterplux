using System.Text.Json;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Runtime;

public static class OutboundEventFactory
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static OutboundEvent Transcript(
        AgentIdentity identity,
        TranscriptSegment segment,
        Guid? eventId = null)
    {
        ArgumentNullException.ThrowIfNull(identity);
        ArgumentNullException.ThrowIfNull(segment);
        return Create(
            identity,
            eventId,
            segment.ServiceId,
            OutboundEventKind.Transcript,
            segment.StartedAt,
            segment);
    }

    public static OutboundEvent Health(
        AgentIdentity identity,
        EdgeDeviceHealth health,
        Guid? eventId = null)
    {
        ArgumentNullException.ThrowIfNull(identity);
        ArgumentNullException.ThrowIfNull(health);
        return Create(
            identity,
            eventId,
            null,
            OutboundEventKind.Health,
            health.ObservedAt,
            health);
    }

    public static OutboundEvent Media(
        AgentIdentity identity,
        MediaSourceState state,
        Guid? eventId = null)
    {
        ArgumentNullException.ThrowIfNull(identity);
        ArgumentNullException.ThrowIfNull(state);
        return Create(
            identity,
            eventId,
            null,
            OutboundEventKind.Media,
            state.ObservedAt,
            state);
    }

    private static OutboundEvent Create<T>(
        AgentIdentity identity,
        Guid? eventId,
        Guid? serviceId,
        OutboundEventKind kind,
        DateTimeOffset occurredAt,
        T payload)
    {
        if (identity.OrganizationId == Guid.Empty || identity.DeviceId == Guid.Empty)
        {
            throw new ArgumentException("Edge identity must contain organization and device IDs.", nameof(identity));
        }

        return new OutboundEvent(
            eventId ?? Guid.NewGuid(),
            new OutboundEventScope(identity.OrganizationId, identity.DeviceId),
            serviceId,
            kind,
            1,
            occurredAt,
            JsonSerializer.Serialize(payload, JsonOptions));
    }
}
