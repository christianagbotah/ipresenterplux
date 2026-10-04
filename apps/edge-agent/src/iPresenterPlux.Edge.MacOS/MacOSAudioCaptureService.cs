using System.Runtime.InteropServices;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.MacOS;

public sealed class MacOSAudioCaptureService : IAudioCaptureService
{
    private readonly MacOSNativeMediaBridge _bridge;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly MacOSNativeMediaBridge.AudioFrameCallback _callback;
    private bool _capturing;
    private bool _disposed;
    private string? _activeDeviceId;

    public MacOSAudioCaptureService(MacOSNativeMediaBridge? bridge = null)
    {
        _bridge = bridge ?? new MacOSNativeMediaBridge();
        _callback = OnNativeAudioFrame;
    }

    public event EventHandler<AudioFrame>? AudioFrameCaptured;
    public bool IsCapturing => _capturing;
    public string? ActiveDeviceId => _activeDeviceId;

    public Task<IReadOnlyList<AudioInputDevice>> ListInputsAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ThrowIfDisposed();
        var inputs = _bridge.ListAudioInputs()
            .Select(item => new AudioInputDevice(item.Id, item.Name, item.Channels, item.SampleRate, item.IsDefault))
            .ToArray();
        return Task.FromResult<IReadOnlyList<AudioInputDevice>>(Array.AsReadOnly(inputs));
    }

    public async Task StartAsync(string deviceId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            if (_capturing && string.Equals(_activeDeviceId, deviceId, StringComparison.Ordinal)) return;
            StopCore();
            _bridge.StartAudioCapture(deviceId, _callback);
            _activeDeviceId = deviceId;
            _capturing = true;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_disposed) return;
            StopCore();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed) return;
            StopCore();
            _disposed = true;
        }
        finally
        {
            _gate.Release();
            _gate.Dispose();
        }
    }

    private void OnNativeAudioFrame(
        IntPtr data,
        int length,
        int sampleRate,
        int channels,
        int bitsPerSample,
        int encoding,
        long capturedAtUnixMs)
    {
        if (!_capturing || data == IntPtr.Zero || length <= 0) return;
        var copy = new byte[length];
        Marshal.Copy(data, copy, 0, length);
        var capturedAt = DateTimeOffset.FromUnixTimeMilliseconds(capturedAtUnixMs);
        AudioFrameCaptured?.Invoke(this, new AudioFrame(
            copy,
            copy.Length,
            sampleRate,
            channels,
            bitsPerSample,
            capturedAt,
            encoding == 1 ? AudioSampleEncoding.IeeeFloat : AudioSampleEncoding.PcmInteger));
    }

    private void StopCore()
    {
        if (_capturing) _bridge.StopAudioCapture();
        _capturing = false;
        _activeDeviceId = null;
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}
