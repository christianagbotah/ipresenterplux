namespace iPresenterPlux.Edge.Core.Contracts;

public enum OutboundEventKind
{
    Transcript,
    Health,
    Media
}

public sealed record OutboundEventScope(Guid OrganizationId, Guid DeviceId);

// Payload is serialized JSON, allowing future SQLite storage without CLR type coupling.
public sealed record OutboundEvent(
    Guid EventId,
    OutboundEventScope Scope,
    Guid? ServiceId,
    OutboundEventKind Kind,
    int SchemaVersion,
    DateTimeOffset OccurredAt,
    string PayloadJson);

public sealed record OutboundEventDelivery(
    OutboundEvent Event,
    Guid ClaimId,
    int Attempt,
    DateTimeOffset LeaseExpiresAt);
