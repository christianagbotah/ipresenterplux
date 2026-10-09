using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IEntitlementStore
{
    Task<DesktopEntitlementCache?> ReadAsync(CancellationToken cancellationToken);
    Task SaveAsync(DesktopEntitlementCache cache, CancellationToken cancellationToken);
    Task ClearAsync(CancellationToken cancellationToken);
}
