using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.State;

public sealed record AgentSnapshot(
    string ConnectionStatus,
    string AudioStatus,
    string? ActiveAudioInput,
    Guid? ActiveServiceId,
    string ServiceMode,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<SourceHealth> Sources)
{
    public static AgentSnapshot Offline { get; } = new(
        "Offline",
        "Stopped",
        null,
        null,
        "Pre-service",
        DateTimeOffset.UtcNow,
        Array.Empty<SourceHealth>());
}

public sealed class AgentRuntimeState
{
    private readonly object _gate = new();
    private readonly TimeProvider _clock;
    private AgentSnapshot _snapshot;

    public AgentRuntimeState(TimeProvider? clock = null)
    {
        _clock = clock ?? TimeProvider.System;
        _snapshot = AgentSnapshot.Offline with { UpdatedAt = _clock.GetUtcNow() };
    }

    public event EventHandler<AgentSnapshot>? Changed;

    public AgentSnapshot Snapshot
    {
        get
        {
            lock (_gate) return _snapshot;
        }
    }

    public void Update(Func<AgentSnapshot, AgentSnapshot> update)
    {
        ArgumentNullException.ThrowIfNull(update);
        AgentSnapshot next;
        lock (_gate)
        {
            var candidate = update(_snapshot);
            ArgumentNullException.ThrowIfNull(candidate);
            ArgumentNullException.ThrowIfNull(candidate.Sources);
            next = candidate with
            {
                UpdatedAt = _clock.GetUtcNow(),
                Sources = Array.AsReadOnly(candidate.Sources.ToArray())
            };
            _snapshot = next;
        }

        Changed?.Invoke(this, next);
    }
}
