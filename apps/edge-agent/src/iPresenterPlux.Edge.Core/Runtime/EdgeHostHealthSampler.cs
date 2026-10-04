using System.Diagnostics;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class EdgeHostHealthSampler : IDisposable
{
    private readonly Process _process = Process.GetCurrentProcess();
    private readonly TimeProvider _clock;
    private DateTimeOffset? _lastObservedAt;
    private TimeSpan _lastCpuTime;
    private bool _disposed;

    public EdgeHostHealthSampler(TimeProvider? clock = null)
    {
        _clock = clock ?? TimeProvider.System;
        _process.Refresh();
        _lastCpuTime = _process.TotalProcessorTime;
    }

    public EdgeDeviceHealth Sample(
        AgentIdentity identity,
        string status,
        IReadOnlyDictionary<string, string> capabilities)
    {
        ArgumentNullException.ThrowIfNull(identity);
        ArgumentException.ThrowIfNullOrWhiteSpace(status);
        ArgumentNullException.ThrowIfNull(capabilities);
        ObjectDisposedException.ThrowIf(_disposed, this);

        _process.Refresh();
        var observedAt = _clock.GetUtcNow();
        var cpuTime = _process.TotalProcessorTime;
        double cpuPercent = 0;
        if (_lastObservedAt is { } previousAt)
        {
            var elapsedMs = Math.Max(1, (observedAt - previousAt).TotalMilliseconds);
            var cpuMs = Math.Max(0, (cpuTime - _lastCpuTime).TotalMilliseconds);
            cpuPercent = Math.Clamp(cpuMs / (elapsedMs * Math.Max(1, Environment.ProcessorCount)) * 100d, 0d, 100d);
        }
        _lastObservedAt = observedAt;
        _lastCpuTime = cpuTime;

        var availableBytes = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;
        var memoryPercent = availableBytes > 0
            ? Math.Clamp((double)_process.WorkingSet64 / availableBytes * 100d, 0d, 100d)
            : 0d;

        return new EdgeDeviceHealth(
            identity.DeviceId.ToString(),
            identity.DeviceName,
            identity.SoftwareVersion,
            status,
            observedAt,
            cpuPercent,
            memoryPercent,
            null,
            capabilities);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _process.Dispose();
    }
}
