using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IPresentationContentProvider
{
    Task<PresentationRenderItem> GetAsync(string itemId, CancellationToken cancellationToken);
}
