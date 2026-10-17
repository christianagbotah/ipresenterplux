using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Windows;

public sealed class WindowsVisualCaptureFactory : IVisualCaptureFactory
{
    public ValueTask<IVisualCaptureSession> CreateAsync(
        VisualSourceDescriptor source,
        VisualCaptureOptions options,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(options);

        IVisualCaptureSession session = source.Kind switch
        {
            VisualSourceKind.Camera => new WindowsCameraCaptureSession(source, options),
            VisualSourceKind.Display or VisualSourceKind.Window => new WindowsGraphicsCaptureSession(source, options),
            _ => throw new NotSupportedException($"Unsupported Windows visual source kind: {source.Kind}.")
        };
        return ValueTask.FromResult(session);
    }
}
