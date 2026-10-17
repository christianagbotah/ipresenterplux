using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Windows;

public sealed class WindowsVisualSourceCatalog : IVisualSourceCatalog
{
    private readonly IVisualSourceCatalog _cameras;
    private readonly IVisualSourceCatalog _graphics;

    public WindowsVisualSourceCatalog(TimeProvider? clock = null)
        : this(new WindowsCameraSourceCatalog(clock), new WindowsGraphicsSourceCatalog(clock))
    {
    }

    public WindowsVisualSourceCatalog(IVisualSourceCatalog cameras, IVisualSourceCatalog graphics)
    {
        _cameras = cameras ?? throw new ArgumentNullException(nameof(cameras));
        _graphics = graphics ?? throw new ArgumentNullException(nameof(graphics));
    }

    public async Task<IReadOnlyList<VisualSourceDescriptor>> ScanAsync(CancellationToken cancellationToken)
    {
        var cameras = await _cameras.ScanAsync(cancellationToken).ConfigureAwait(false);
        var graphics = await _graphics.ScanAsync(cancellationToken).ConfigureAwait(false);
        return cameras.Concat(graphics)
            .GroupBy(source => source.SourceId, StringComparer.Ordinal)
            .Select(group => group.First())
            .OrderBy(source => source.Kind)
            .ThenBy(source => source.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(source => source.SourceId, StringComparer.Ordinal)
            .ToArray();
    }
}
