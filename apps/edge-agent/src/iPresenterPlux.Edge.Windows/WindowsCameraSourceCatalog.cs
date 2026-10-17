using SharpMediaFoundationInterop.Input;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Windows;

public sealed class WindowsCameraSourceCatalog : IVisualSourceCatalog
{
    private readonly Func<IReadOnlyList<WindowsNativeCamera>> _enumerate;
    private readonly TimeProvider _clock;

    public WindowsCameraSourceCatalog(TimeProvider? clock = null)
        : this(EnumerateNative, clock)
    {
    }

    public WindowsCameraSourceCatalog(
        Func<IReadOnlyList<WindowsNativeCamera>> enumerate,
        TimeProvider? clock = null)
    {
        _enumerate = enumerate ?? throw new ArgumentNullException(nameof(enumerate));
        _clock = clock ?? TimeProvider.System;
    }

    public Task<IReadOnlyList<VisualSourceDescriptor>> ScanAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var observedAt = _clock.GetUtcNow();
        var unique = new Dictionary<string, VisualSourceDescriptor>(StringComparer.Ordinal);
        foreach (var record in _enumerate())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(record.NativeId)) continue;
            var descriptor = WindowsVisualSourceMetadata.Camera(record, observedAt);
            unique.TryAdd(descriptor.SourceId, descriptor);
        }

        return Task.FromResult<IReadOnlyList<VisualSourceDescriptor>>(
            unique.Values.OrderBy(source => source.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(source => source.SourceId, StringComparer.Ordinal)
                .ToArray());
    }

    private static IReadOnlyList<WindowsNativeCamera> EnumerateNative()
    {
        EnsureWindows();
        return DeviceCapture.Enumerate()
            .Where(device => !string.IsNullOrWhiteSpace(device.ID))
            .Select(device => new WindowsNativeCamera(device.ID, device.Name))
            .ToArray();
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Media Foundation camera discovery requires Windows.");
    }
}
