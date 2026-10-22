using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IMediaPreparationCoordinator
{
    event EventHandler<MediaPreparationSnapshot>? StatusChanged;

    Task<MediaPreparationSnapshot> PrepareAsync(
        PresentationRenderItem item,
        CancellationToken cancellationToken);

    MediaPreparationSnapshot? TryGet(string itemId);

    Task PrefetchAsync(
        Guid serviceId,
        IReadOnlyList<OperatorCatalogItem> items,
        CancellationToken cancellationToken);

    IDisposable AcquireReadyLease(string itemId);

    Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken);
}
