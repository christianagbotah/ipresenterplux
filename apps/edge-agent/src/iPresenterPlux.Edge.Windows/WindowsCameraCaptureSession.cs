using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Windows;

internal enum WindowsCameraReaderFailureKind
{
    Busy,
    Permission,
    Unsupported,
    Disconnected,
    Capture
}

internal sealed class WindowsCameraReaderException : Exception
{
    public WindowsCameraReaderException(
        WindowsCameraReaderFailureKind kind,
        string message,
        Exception? innerException = null)
        : base(message, innerException)
    {
        Kind = kind;
    }

    public WindowsCameraReaderFailureKind Kind { get; }
}

internal sealed record WindowsCameraModeCandidate(
    int Width,
    int Height,
    uint FrameRateNumerator,
    uint FrameRateDenominator,
    Guid Subtype)
{
    public double FramesPerSecond => FrameRateDenominator == 0
        ? 0d
        : (double)FrameRateNumerator / FrameRateDenominator;
}

internal sealed record WindowsCameraFrame(
    int Width,
    int Height,
    int Stride,
    ReadOnlyMemory<byte> Buffer,
    DateTimeOffset CapturedAt);

internal interface IWindowsCameraReader : IAsyncDisposable
{
    event EventHandler<WindowsCameraFrame>? FrameReceived;
    event EventHandler<WindowsCameraReaderException>? Faulted;

    Task<WindowsCameraModeCandidate> StartAsync(
        string nativeId,
        VisualCaptureOptions options,
        CancellationToken cancellationToken);

    Task StopAsync(CancellationToken cancellationToken);
}

public sealed class WindowsCameraCaptureSession : IVisualCaptureSession
{
    private readonly VisualCaptureOptions _options;
    private readonly IWindowsCameraReader _reader;
    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private readonly object _statusGate = new();
    private VisualCaptureStatus _status;
    private ProgramVideoFrame? _latestFrame;
    private long _framesCaptured;
    private long _droppedFrames;
    private int _acceptFrames;
    private bool _disposed;

    public WindowsCameraCaptureSession(
        VisualSourceDescriptor source,
        VisualCaptureOptions options,
        TimeProvider? clock = null)
        : this(source, options, new WindowsMediaFoundationCameraReader(clock), clock)
    {
    }

    internal WindowsCameraCaptureSession(
        VisualSourceDescriptor source,
        VisualCaptureOptions options,
        IWindowsCameraReader reader,
        TimeProvider? clock = null)
    {
        Source = source ?? throw new ArgumentNullException(nameof(source));
        if (source.Kind != VisualSourceKind.Camera)
            throw new ArgumentException("Windows camera capture requires a camera source.", nameof(source));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _reader = reader ?? throw new ArgumentNullException(nameof(reader));
        _clock = clock ?? TimeProvider.System;
        _status = new VisualCaptureStatus(false, source.Availability, 0, 0, null, source.ErrorCode);
        _reader.FrameReceived += OnFrameReceived;
        _reader.Faulted += OnReaderFaulted;
    }

    public event EventHandler? StatusChanged;

    public VisualSourceDescriptor Source { get; }

    public VisualCaptureStatus Status
    {
        get
        {
            lock (_statusGate) return _status;
        }
    }

    public ProgramVideoFrame? LatestFrame => Volatile.Read(ref _latestFrame);

    public async Task<VisualCaptureStatus> StartAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (Status.IsRunning) return Status;

            Interlocked.Exchange(ref _acceptFrames, 0);
            Interlocked.Exchange(ref _latestFrame, null);
            Interlocked.Exchange(ref _framesCaptured, 0);
            Interlocked.Exchange(ref _droppedFrames, 0);

            try
            {
                var mode = await _reader.StartAsync(Source.NativeKey, _options, cancellationToken).ConfigureAwait(false);
                if (mode.Width <= 0 || mode.Height <= 0 || mode.FramesPerSecond <= 0 || mode.FramesPerSecond > 60d)
                    throw new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Unsupported, "Camera returned an unsupported capture mode.");

                Interlocked.Exchange(ref _acceptFrames, 1);
                SetStatus(new VisualCaptureStatus(true, VisualSourceAvailability.Available, 0, 0, null, null));
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                await StopReaderBestEffortAsync().ConfigureAwait(false);
                throw;
            }
            catch (WindowsCameraReaderException error)
            {
                Interlocked.Exchange(ref _acceptFrames, 0);
                await StopReaderBestEffortAsync().ConfigureAwait(false);
                SetStatus(ToFailureStatus(error, framesCaptured: 0, droppedFrames: 0, lastFrameAt: null));
            }
            catch (Exception error)
            {
                Interlocked.Exchange(ref _acceptFrames, 0);
                await StopReaderBestEffortAsync().ConfigureAwait(false);
                SetStatus(ToFailureStatus(
                    new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Capture, "Camera start failed.", error),
                    framesCaptured: 0,
                    droppedFrames: 0,
                    lastFrameAt: null));
            }

            return Status;
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task<VisualCaptureStatus> StopAsync(CancellationToken cancellationToken)
    {
        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_disposed) return Status;
            Interlocked.Exchange(ref _acceptFrames, 0);
            try
            {
                await _reader.StopAsync(cancellationToken).ConfigureAwait(false);
                var current = Status;
                SetStatus(new VisualCaptureStatus(
                    false,
                    VisualSourceAvailability.Available,
                    Interlocked.Read(ref _framesCaptured),
                    Interlocked.Read(ref _droppedFrames),
                    current.LastFrameAt,
                    null));
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (WindowsCameraReaderException error)
            {
                var current = Status;
                SetStatus(ToFailureStatus(
                    error,
                    Interlocked.Read(ref _framesCaptured),
                    Interlocked.Read(ref _droppedFrames),
                    current.LastFrameAt));
            }
            catch (Exception error)
            {
                var current = Status;
                SetStatus(ToFailureStatus(
                    new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Capture, "Camera stop failed.", error),
                    Interlocked.Read(ref _framesCaptured),
                    Interlocked.Read(ref _droppedFrames),
                    current.LastFrameAt));
            }

            return Status;
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        await _lifecycleGate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed) return;
            Interlocked.Exchange(ref _acceptFrames, 0);
            await StopReaderBestEffortAsync().ConfigureAwait(false);
            _reader.FrameReceived -= OnFrameReceived;
            _reader.Faulted -= OnReaderFaulted;
            await _reader.DisposeAsync().ConfigureAwait(false);
            _disposed = true;
        }
        finally
        {
            _lifecycleGate.Release();
            _lifecycleGate.Dispose();
        }
    }

    private void OnFrameReceived(object? sender, WindowsCameraFrame frame)
    {
        if (Volatile.Read(ref _acceptFrames) != 1 || _disposed) return;
        if (frame.Width <= 0 || frame.Height <= 0 || frame.Stride < frame.Width * 4) return;
        var expected = checked(frame.Stride * frame.Height);
        if (frame.Buffer.Length < expected) return;

        lock (_statusGate)
        {
            if (!_status.IsRunning || Volatile.Read(ref _acceptFrames) != 1 || _disposed) return;
            var videoFrame = new ProgramVideoFrame(
                frame.Width,
                frame.Height,
                frame.Stride,
                "bgra32",
                frame.Buffer[..expected],
                null,
                frame.CapturedAt);
            var previous = Interlocked.Exchange(ref _latestFrame, videoFrame);
            var captured = Interlocked.Increment(ref _framesCaptured);
            if (previous is not null) Interlocked.Increment(ref _droppedFrames);
            _status = _status with
            {
                FramesCaptured = captured,
                DroppedFrames = Interlocked.Read(ref _droppedFrames),
                LastFrameAt = frame.CapturedAt,
                ErrorCode = null,
                Availability = VisualSourceAvailability.Available
            };
        }
    }

    private void OnReaderFaulted(object? sender, WindowsCameraReaderException error)
    {
        VisualCaptureStatus failure;
        lock (_statusGate)
        {
            if (_disposed || Volatile.Read(ref _acceptFrames) != 1 || !_status.IsRunning) return;
            Interlocked.Exchange(ref _acceptFrames, 0);
            failure = ToFailureStatus(
                error,
                Interlocked.Read(ref _framesCaptured),
                Interlocked.Read(ref _droppedFrames),
                _status.LastFrameAt);
            _status = failure;
        }
        StatusChanged?.Invoke(this, EventArgs.Empty);
    }

    private void SetStatus(VisualCaptureStatus status)
    {
        lock (_statusGate) _status = status;
        StatusChanged?.Invoke(this, EventArgs.Empty);
    }

    private async Task StopReaderBestEffortAsync()
    {
        try
        {
            await _reader.StopAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch
        {
            // A disappearing device must not prevent the session from reaching a stable stopped state.
        }
    }

    private static VisualCaptureStatus ToFailureStatus(
        WindowsCameraReaderException error,
        long framesCaptured,
        long droppedFrames,
        DateTimeOffset? lastFrameAt)
    {
        var (availability, code) = error.Kind switch
        {
            WindowsCameraReaderFailureKind.Busy => (VisualSourceAvailability.Busy, "camera_busy"),
            WindowsCameraReaderFailureKind.Permission => (VisualSourceAvailability.PermissionRequired, "camera_permission"),
            WindowsCameraReaderFailureKind.Unsupported => (VisualSourceAvailability.Unsupported, "camera_unsupported"),
            WindowsCameraReaderFailureKind.Disconnected => (VisualSourceAvailability.Disconnected, "camera_disconnected"),
            _ => (VisualSourceAvailability.Error, "camera_capture_failed")
        };
        return new VisualCaptureStatus(false, availability, framesCaptured, droppedFrames, lastFrameAt, code);
    }
}
