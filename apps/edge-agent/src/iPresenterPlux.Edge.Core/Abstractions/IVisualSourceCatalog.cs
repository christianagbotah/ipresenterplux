using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IVisualSourceCatalog
{
    Task<IReadOnlyList<VisualSourceDescriptor>> ScanAsync(CancellationToken cancellationToken);
}
