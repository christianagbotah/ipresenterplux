using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed record VisualRouteSlot(
    string SourceId,
    VisualSourceKind Kind,
    VisualSourceAvailability Availability,
    bool Confirmed,
    string? ErrorCode);

public sealed record VisualRouteSnapshot(
    VisualRouteSlot? Preview,
    VisualRouteSlot? Program,
    bool UsingRenderedProgram);

public interface IVisualProgramRouter : IProgramVideoSource, IAsyncDisposable
{
    VisualRouteSnapshot Snapshot { get; }
    Task SelectPreviewAsync(string sourceId, CancellationToken cancellationToken);
    Task ClearPreviewAsync(CancellationToken cancellationToken);
    Task TakePreviewAsync(CancellationToken cancellationToken);
    Task UseRenderedProgramAsync(CancellationToken cancellationToken);
}
