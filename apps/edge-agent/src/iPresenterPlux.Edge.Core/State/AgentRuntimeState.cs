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
    private AgentSnapshot _snapshot = AgentSnapshot.Offline;

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
        AgentSnapshot next;
        lock (_gate)
        {
            next = update(_snapshot) with { UpdatedAt = DateTimeOffset.UtcNow };
            _snapshot = next;
        }

        Changed?.Invoke(this, next);
    }
}
