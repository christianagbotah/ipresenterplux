using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IVisualCaptureFactory
{
    ValueTask<IVisualCaptureSession> CreateAsync(
        VisualSourceDescriptor source,
        VisualCaptureOptions options,
        CancellationToken cancellationToken);
}
