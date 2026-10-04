namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IMediaOutputService
{
    Task StartProgramOutputAsync(CancellationToken cancellationToken);
    Task StopProgramOutputAsync(CancellationToken cancellationToken);
    Task SetPreviewAsync(string itemId, CancellationToken cancellationToken);
    Task TakePreviewToProgramAsync(CancellationToken cancellationToken);
    Task ClearProgramAsync(CancellationToken cancellationToken);
}
