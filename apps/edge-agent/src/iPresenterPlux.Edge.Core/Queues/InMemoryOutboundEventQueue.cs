using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Queues;

// Reference implementation, not durable storage. A SQLite adapter must preserve these semantics.
public sealed class InMemoryOutboundEventQueue : IOutboundEventQueue
{
    private sealed class Entry(OutboundEvent value)
    {
        public OutboundEvent Value { get; } = value;
        public bool Delivered { get; set; }
        public Guid? ClaimId { get; set; }
        public DateTimeOffset DueAt { get; set; } = DateTimeOffset.MinValue;
        public int Attempts { get; set; }
    }

    private readonly object _gate = new();
    private readonly Dictionary<(OutboundEventScope Scope, Guid Id), Entry> _entries = new();
    private readonly List<Entry> _ordered = new();

    public Task EnqueueAsync(OutboundEvent outboundEvent, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(outboundEvent);
        ArgumentNullException.ThrowIfNull(outboundEvent.Scope);
        if (outboundEvent.EventId == Guid.Empty || outboundEvent.Scope.OrganizationId == Guid.Empty || outboundEvent.Scope.DeviceId == Guid.Empty)
            throw new ArgumentException("Event, organization and device IDs must be nonempty.", nameof(outboundEvent));
        if (outboundEvent.SchemaVersion <= 0 || !Enum.IsDefined(outboundEvent.Kind))
            throw new ArgumentException("Event kind and schema version must be valid.", nameof(outboundEvent));
        ArgumentException.ThrowIfNullOrWhiteSpace(outboundEvent.PayloadJson);
        lock (_gate)
        {
            var key = (outboundEvent.Scope, outboundEvent.EventId);
            if (_entries.TryGetValue(key, out var existing))
            {
                if (existing.Value != outboundEvent)
                    throw new InvalidOperationException("Event ID already exists with different content.");
            }
            else
            {
                var entry = new Entry(outboundEvent);
                _entries.Add(key, entry);
                _ordered.Add(entry);
            }
        }
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<OutboundEventDelivery>> ClaimAsync(
        OutboundEventScope scope, int limit, DateTimeOffset now, TimeSpan leaseDuration, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(scope);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(limit);
        if (leaseDuration <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(leaseDuration));
        var expiresAt = now.Add(leaseDuration);
        var deliveries = new List<OutboundEventDelivery>();
        lock (_gate)
        {
            foreach (var entry in _ordered)
            {
                if (entry.Value.Scope != scope || entry.Delivered || entry.DueAt > now) continue;
                var claimId = Guid.NewGuid();
                entry.ClaimId = claimId;
                entry.DueAt = expiresAt;
                entry.Attempts++;
                deliveries.Add(new(entry.Value, claimId, entry.Attempts, expiresAt));
                if (deliveries.Count == limit) break;
            }
        }
        return Task.FromResult<IReadOnlyList<OutboundEventDelivery>>(deliveries.AsReadOnly());
    }

    public Task<bool> AcknowledgeAsync(OutboundEventScope scope, Guid eventId, Guid claimId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            if (!TryGetClaim(scope, eventId, claimId, now, out var entry)) return Task.FromResult(false);
            entry.Delivered = true;
            entry.ClaimId = null;
            return Task.FromResult(true);
        }
    }

    public Task<bool> RetryAsync(OutboundEventScope scope, Guid eventId, Guid claimId, DateTimeOffset now, DateTimeOffset retryAt, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (retryAt < now) throw new ArgumentOutOfRangeException(nameof(retryAt));
        lock (_gate)
        {
            if (!TryGetClaim(scope, eventId, claimId, now, out var entry)) return Task.FromResult(false);
            entry.ClaimId = null;
            entry.DueAt = retryAt;
            return Task.FromResult(true);
        }
    }

    private bool TryGetClaim(OutboundEventScope scope, Guid eventId, Guid claimId, DateTimeOffset now, out Entry entry)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (_entries.TryGetValue((scope, eventId), out var found) && !found.Delivered &&
            found.ClaimId == claimId && found.DueAt > now)
        {
            entry = found;
            return true;
        }
        entry = null!;
        return false;
    }
}
