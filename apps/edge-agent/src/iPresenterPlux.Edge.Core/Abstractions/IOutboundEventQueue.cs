using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IOutboundEventQueue
{
    // Event IDs are unique within a tenant/device scope across all services and kinds.
    // Re-enqueue of an identical ID/content is a no-op, even after acknowledgement.
    // Conflicting content for the same ID must throw InvalidOperationException.
    Task EnqueueAsync(OutboundEvent outboundEvent, CancellationToken cancellationToken);
    // Atomic claim in enqueue order; due retries and expired leases are eligible.
    Task<IReadOnlyList<OutboundEventDelivery>> ClaimAsync(
        OutboundEventScope scope, int limit, DateTimeOffset now, TimeSpan leaseDuration, CancellationToken cancellationToken);
    // Only the current, unexpired claim can ack/retry. Unknown/stale claims return false.
    Task<bool> AcknowledgeAsync(OutboundEventScope scope, Guid eventId, Guid claimId, DateTimeOffset now, CancellationToken cancellationToken);
    Task<bool> RetryAsync(OutboundEventScope scope, Guid eventId, Guid claimId, DateTimeOffset now, DateTimeOffset retryAt, CancellationToken cancellationToken);
}
