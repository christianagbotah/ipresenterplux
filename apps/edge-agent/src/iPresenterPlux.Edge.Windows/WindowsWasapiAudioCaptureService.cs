using NAudio.CoreAudioApi;
using NAudio.Wave;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Windows;

public sealed class WindowsWasapiAudioCaptureService : IAudioCaptureService
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private WasapiRecorder? _recorder;
    private MMDevice? _activeDevice;
    private bool _disposed;

    public event EventHandler<AudioFrame>? AudioFrameCaptured;

    public bool IsCapturing => _recorder?.CaptureState == CaptureState.Capturing;
    public string? ActiveDeviceId => _activeDevice?.ID;

    public Task<IReadOnlyList<AudioInputDevice>> ListInputsAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureWindows();
        ThrowIfDisposed();

        using var enumerator = new MMDeviceEnumerator();
        string? defaultId = null;
        try
        {
            using var defaultDevice = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia);
            defaultId = defaultDevice.ID;
        }
        catch
        {
            // A machine can legitimately have no default capture endpoint.
        }

        var result = new List<AudioInputDevice>();
        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
        {
            using (device)
            {
                using var audioClient = device.CreateAudioClient();
                var format = audioClient.MixFormat.AsStandardWaveFormat();
                result.Add(new AudioInputDevice(
                    device.ID,
                    device.FriendlyName,
                    format.Channels,
                    format.SampleRate,
                    string.Equals(device.ID, defaultId, StringComparison.OrdinalIgnoreCase)));
            }
        }

        return Task.FromResult<IReadOnlyList<AudioInputDevice>>(result.AsReadOnly());
    }

    public async Task StartAsync(string deviceId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);
        EnsureWindows();
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            await StopCoreAsync().ConfigureAwait(false);

            using var enumerator = new MMDeviceEnumerator();
            var device = enumerator.GetDevice(deviceId);
            WasapiRecorder? recorder = null;
            try
            {
                recorder = new WasapiRecorderBuilder()
                    .WithDevice(device)
                    .WithSharedMode()
                    .WithEventSync()
                    .WithBufferLength(50)
                    .WithMmcssThreadPriority("Pro Audio")
                    .Build();
                recorder.DataAvailable += OnDataAvailable;
                recorder.RecordingStopped += OnRecordingStopped;
                _activeDevice = device;
                _recorder = recorder;
                recorder.StartRecording();
                recorder = null;
                device = null!;
            }
            finally
            {
                if (recorder is not null) await recorder.DisposeAsync().ConfigureAwait(false);
                device?.Dispose();
            }
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
            await StopCoreAsync().ConfigureAwait(false);
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
            await StopCoreAsync().ConfigureAwait(false);
            _disposed = true;
        }
        finally
        {
            _gate.Release();
            _gate.Dispose();
        }
    }

    private void OnDataAvailable(
        ReadOnlySpan<byte> buffer,
        AudioClientBufferFlags flags,
        long devicePosition,
        long qpcPosition)
    {
        var recorder = _recorder;
        if (recorder is null || buffer.IsEmpty) return;

        // NAudio owns this zero-copy WASAPI span; it is invalid after the callback returns.
        var copy = buffer.ToArray();
        var format = recorder.WaveFormat.AsStandardWaveFormat();
        var encoding = format.Encoding == WaveFormatEncoding.IeeeFloat
            ? AudioSampleEncoding.IeeeFloat
            : AudioSampleEncoding.PcmInteger;

        AudioFrameCaptured?.Invoke(this, new AudioFrame(
            copy,
            copy.Length,
            format.SampleRate,
            format.Channels,
            format.BitsPerSample,
            DateTimeOffset.UtcNow,
            encoding));
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs args)
    {
        // The shared host observes capture state and will expose device health on its next heartbeat.
    }

    private async Task StopCoreAsync()
    {
        var recorder = _recorder;
        var device = _activeDevice;
        _recorder = null;
        _activeDevice = null;
        if (recorder is not null)
        {
            recorder.DataAvailable -= OnDataAvailable;
            recorder.RecordingStopped -= OnRecordingStopped;
            if (recorder.CaptureState != CaptureState.Stopped) recorder.StopRecording();
            await recorder.DisposeAsync().ConfigureAwait(false);
        }
        device?.Dispose();
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("WASAPI capture requires Windows.");
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}
