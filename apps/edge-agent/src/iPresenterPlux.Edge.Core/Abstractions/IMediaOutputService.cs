using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IMediaOutputService
{
    Task StartProgramOutputAsync(CancellationToken cancellationToken);
    Task StopProgramOutputAsync(CancellationToken cancellationToken);
    Task SetPreviewAsync(PresentationRenderItem item, CancellationToken cancellationToken);
    Task TakePreviewToProgramAsync(CancellationToken cancellationToken);
    Task ClearProgramAsync(CancellationToken cancellationToken);
}
