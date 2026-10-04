using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Queues;

/// <summary>
/// Durable single-process queue that persists the reference queue semantics to one JSON state file.
/// Writes use a same-directory flush-and-rename so a process crash preserves either the previous
/// complete state or the newly flushed state. Platform hosts should place the directory in their
/// per-user application-data location, not beside the executable.
/// </summary>
public sealed class FileOutboundEventQueue : IOutboundEventQueue, IAsyncDisposable
{
    private sealed class StoredEntry
    {
        public required OutboundEvent Value { get; init; }
        public bool Delivered { get; set; }
        public Guid? ClaimId { get; set; }
        public DateTimeOffset DueAt { get; set; } = DateTimeOffset.MinValue;
        public int Attempts { get; set; }
        public DateTimeOffset? DeliveredAt { get; set; }
    }

    private sealed class QueueState
    {
        public QueueState() { }
        public int SchemaVersion { get; init; } = 1;
        public List<StoredEntry> Entries { get; init; } = [];
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _statePath;
    private readonly string _tempPath;
    private QueueState? _state;
    private bool _disposed;

    public FileOutboundEventQueue(string directoryPath, string fileName = "outbound-events.json")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directoryPath);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        if (Path.GetFileName(fileName) != fileName)
            throw new ArgumentException("Queue file name must not contain a directory path.", nameof(fileName));

        Directory.CreateDirectory(directoryPath);
        _statePath = Path.Combine(directoryPath, fileName);
        _tempPath = _statePath + ".tmp";

        RecoverInterruptedFirstWrite();
    }

    public async Task EnqueueAsync(OutboundEvent outboundEvent, CancellationToken cancellationToken)
    {
        ValidateEvent(outboundEvent);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var current = await LoadAsync(cancellationToken).ConfigureAwait(false);
            var existing = current.Entries.FirstOrDefault(entry =>
                entry.Value.Scope == outboundEvent.Scope && entry.Value.EventId == outboundEvent.EventId);

            if (existing is not null)
            {
                if (existing.Value != outboundEvent)
                    throw new InvalidOperationException("Event ID already exists with different content.");
                return;
            }

            var state = CloneState(current);
            state.Entries.Add(new StoredEntry { Value = outboundEvent });
            await SaveAsync(state, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IReadOnlyList<OutboundEventDelivery>> ClaimAsync(
        OutboundEventScope scope,
        int limit,
        DateTimeOffset now,
        TimeSpan leaseDuration,
        CancellationToken cancellationToken)
    {
        ValidateScope(scope);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(limit);
        if (leaseDuration <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(leaseDuration));

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var current = await LoadAsync(cancellationToken).ConfigureAwait(false);
            var state = CloneState(current);
            var leaseExpiresAt = now.Add(leaseDuration);
            var deliveries = new List<OutboundEventDelivery>(Math.Min(limit, state.Entries.Count));

            foreach (var entry in state.Entries)
            {
                if (entry.Value.Scope != scope || entry.Delivered || entry.DueAt > now) continue;

                var claimId = Guid.NewGuid();
                entry.ClaimId = claimId;
                entry.DueAt = leaseExpiresAt;
                entry.Attempts++;
                deliveries.Add(new OutboundEventDelivery(
                    entry.Value,
                    claimId,
                    entry.Attempts,
                    leaseExpiresAt));

                if (deliveries.Count == limit) break;
            }

            if (deliveries.Count > 0)
                await SaveAsync(state, cancellationToken).ConfigureAwait(false);

            return deliveries.AsReadOnly();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> AcknowledgeAsync(
        OutboundEventScope scope,
        Guid eventId,
        Guid claimId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ValidateScope(scope);
        ValidateIds(eventId, claimId);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var current = await LoadAsync(cancellationToken).ConfigureAwait(false);
            var state = CloneState(current);
            var entry = FindCurrentClaim(state, scope, eventId, claimId, now);
            if (entry is null) return false;

            entry.Delivered = true;
            entry.DeliveredAt = now;
            entry.ClaimId = null;
            entry.DueAt = DateTimeOffset.MaxValue;
            await SaveAsync(state, cancellationToken).ConfigureAwait(false);
            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> RetryAsync(
        OutboundEventScope scope,
        Guid eventId,
        Guid claimId,
        DateTimeOffset now,
        DateTimeOffset retryAt,
        CancellationToken cancellationToken)
    {
        ValidateScope(scope);
        ValidateIds(eventId, claimId);
        if (retryAt < now) throw new ArgumentOutOfRangeException(nameof(retryAt));

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var current = await LoadAsync(cancellationToken).ConfigureAwait(false);
            var state = CloneState(current);
            var entry = FindCurrentClaim(state, scope, eventId, claimId, now);
            if (entry is null) return false;

            entry.ClaimId = null;
            entry.DueAt = retryAt;
            await SaveAsync(state, cancellationToken).ConfigureAwait(false);
            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Removes old delivered tombstones while retaining recent IDs for durable deduplication.
    /// Call only during low-activity maintenance windows.
    /// </summary>
    public async Task<int> CompactAsync(DateTimeOffset deliveredBefore, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var current = await LoadAsync(cancellationToken).ConfigureAwait(false);
            var state = CloneState(current);
            var before = state.Entries.Count;
            state.Entries.RemoveAll(entry =>
                entry.Delivered && entry.DeliveredAt is not null && entry.DeliveredAt < deliveredBefore);
            var removed = before - state.Entries.Count;
            if (removed > 0) await SaveAsync(state, cancellationToken).ConfigureAwait(false);
            return removed;
        }
        finally
        {
            _gate.Release();
        }
    }

    public ValueTask DisposeAsync()
    {
        if (!_disposed)
        {
            _disposed = true;
            _gate.Dispose();
        }
        return ValueTask.CompletedTask;
    }

    private async Task<QueueState> LoadAsync(CancellationToken cancellationToken)
    {
        if (_state is not null) return _state;
        if (!File.Exists(_statePath)) return _state = new QueueState();

        try
        {
            await using var stream = new FileStream(
                _statePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                64 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            var loaded = await JsonSerializer.DeserializeAsync<QueueState>(stream, JsonOptions, cancellationToken)
                .ConfigureAwait(false);
            if (loaded is null || loaded.SchemaVersion != 1)
                throw new InvalidDataException("Outbound queue state has an unsupported schema version.");
            return _state = loaded;
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Outbound queue state is corrupted; it was not overwritten.", error);
        }
    }

    private static QueueState CloneState(QueueState source) => new()
    {
        Entries = source.Entries.Select(entry => new StoredEntry
        {
            Value = entry.Value,
            Delivered = entry.Delivered,
            ClaimId = entry.ClaimId,
            DueAt = entry.DueAt,
            Attempts = entry.Attempts,
            DeliveredAt = entry.DeliveredAt
        }).ToList()
    };

    private async Task SaveAsync(QueueState state, CancellationToken cancellationToken)
    {
        await using (var stream = new FileStream(
            _tempPath,
            FileMode.Create,
            FileAccess.Write,
            FileShare.None,
            64 * 1024,
            FileOptions.Asynchronous | FileOptions.WriteThrough))
        {
            await JsonSerializer.SerializeAsync(stream, state, JsonOptions, cancellationToken).ConfigureAwait(false);
            await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            stream.Flush(flushToDisk: true);
        }

        File.Move(_tempPath, _statePath, overwrite: true);
        _state = state;
    }

    private void RecoverInterruptedFirstWrite()
    {
        if (!File.Exists(_statePath) && File.Exists(_tempPath))
            File.Move(_tempPath, _statePath);
        else if (File.Exists(_statePath) && File.Exists(_tempPath))
            File.Delete(_tempPath);
    }

    private static StoredEntry? FindCurrentClaim(
        QueueState state,
        OutboundEventScope scope,
        Guid eventId,
        Guid claimId,
        DateTimeOffset now) =>
        state.Entries.FirstOrDefault(entry =>
            !entry.Delivered &&
            entry.Value.Scope == scope &&
            entry.Value.EventId == eventId &&
            entry.ClaimId == claimId &&
            entry.DueAt > now);

    private static void ValidateEvent(OutboundEvent outboundEvent)
    {
        ArgumentNullException.ThrowIfNull(outboundEvent);
        ValidateScope(outboundEvent.Scope);
        if (outboundEvent.EventId == Guid.Empty)
            throw new ArgumentException("Event ID must be nonempty.", nameof(outboundEvent));
        if (outboundEvent.SchemaVersion <= 0 || !Enum.IsDefined(outboundEvent.Kind))
            throw new ArgumentException("Event kind and schema version must be valid.", nameof(outboundEvent));
        ArgumentException.ThrowIfNullOrWhiteSpace(outboundEvent.PayloadJson);
    }

    private static void ValidateScope(OutboundEventScope scope)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (scope.OrganizationId == Guid.Empty || scope.DeviceId == Guid.Empty)
            throw new ArgumentException("Organization and device IDs must be nonempty.", nameof(scope));
    }

    private static void ValidateIds(Guid eventId, Guid claimId)
    {
        if (eventId == Guid.Empty) throw new ArgumentException("Event ID must be nonempty.", nameof(eventId));
        if (claimId == Guid.Empty) throw new ArgumentException("Claim ID must be nonempty.", nameof(claimId));
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}
