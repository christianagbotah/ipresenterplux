using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IVisualCaptureSession : IAsyncDisposable
{
    VisualSourceDescriptor Source { get; }
    VisualCaptureStatus Status { get; }
    ProgramVideoFrame? LatestFrame { get; }
    Task<VisualCaptureStatus> StartAsync(CancellationToken cancellationToken);
    Task<VisualCaptureStatus> StopAsync(CancellationToken cancellationToken);
}
