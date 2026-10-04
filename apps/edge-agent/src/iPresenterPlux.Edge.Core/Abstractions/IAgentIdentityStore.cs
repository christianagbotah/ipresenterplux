using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IAgentIdentityStore
{
    Task<AgentIdentity?> ReadAsync(CancellationToken cancellationToken);
    Task SaveAsync(AgentIdentity identity, CancellationToken cancellationToken);
    Task ClearAsync(CancellationToken cancellationToken);
}
