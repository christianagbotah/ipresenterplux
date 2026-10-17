using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Windows;

internal enum WindowsGraphicsCaptureFailureKind
{
    Permission,
    Unsupported,
    Disconnected,
    Capture
}

internal sealed class WindowsGraphicsCaptureException : Exception
{
    public WindowsGraphicsCaptureException(
        WindowsGraphicsCaptureFailureKind kind,
        string message,
        Exception? innerException = null)
        : base(message, innerException)
    {
        Kind = kind;
    }

    public WindowsGraphicsCaptureFailureKind Kind { get; }
}

internal sealed record WindowsGraphicsFrame(
    int Width,
    int Height,
    int Stride,
    ReadOnlyMemory<byte> Buffer,
    DateTimeOffset CapturedAt);

internal interface IWindowsGraphicsNativeFrame : IDisposable
{
    int Width { get; }
    int Height { get; }
    WindowsGraphicsFrame ReadBgra32();
}

internal interface IWindowsGraphicsNativeFramePool : IAsyncDisposable
{
    event EventHandler? FrameArrived;
    event EventHandler? Closed;
    event EventHandler<WindowsGraphicsCaptureException>? Faulted;
    Task StartAsync(VisualSourceDescriptor source, CancellationToken cancellationToken);
    Task StopAsync(CancellationToken cancellationToken);
    IWindowsGraphicsNativeFrame? TryGetNextFrame();
    void Recreate(int width, int height);
}

internal sealed class WindowsGraphicsFramePump : IAsyncDisposable
{
    private readonly IWindowsGraphicsNativeFramePool _pool;
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private readonly SemaphoreSlim _frameSignal = new(0, 1);
    private IWindowsGraphicsNativeFrame? _pendingFrame;
    private CancellationTokenSource? _runCts;
    private Task? _worker;
    private int _acceptFrames;
    private int _poolWidth;
    private int _poolHeight;
    private bool _poolStarted;
    private bool _disposed;
    private long _droppedFrames;

    public WindowsGraphicsFramePump(IWindowsGraphicsNativeFramePool pool)
    {
        _pool = pool ?? throw new ArgumentNullException(nameof(pool));
        _pool.FrameArrived += OnFrameArrived;
        _pool.Closed += OnClosed;
        _pool.Faulted += OnFaulted;
    }

    public event EventHandler<WindowsGraphicsFrame>? FrameReady;
    public event EventHandler<WindowsGraphicsCaptureException>? Faulted;

    public long DroppedFrames => Interlocked.Read(ref _droppedFrames);

    public async Task StartAsync(VisualSourceDescriptor source, CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        ArgumentNullException.ThrowIfNull(source);
        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_poolStarted) return;

            var mode = source.Modes.FirstOrDefault();
            _poolWidth = mode?.Width ?? 1920;
            _poolHeight = mode?.Height ?? 1080;
            Interlocked.Exchange(ref _droppedFrames, 0);
            DisposePendingFrame();

            var cts = new CancellationTokenSource();
            _runCts = cts;
            Interlocked.Exchange(ref _acceptFrames, 1);
            try
            {
                await _pool.StartAsync(source, cancellationToken).ConfigureAwait(false);
                _poolStarted = true;
                _worker = Task.Run(() => RunReadbackLoopAsync(cts.Token), CancellationToken.None);
            }
            catch
            {
                Interlocked.Exchange(ref _acceptFrames, 0);
                _runCts = null;
                cts.Dispose();
                throw;
            }
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_disposed || !_poolStarted) return;
            await StopCoreAsync(cancellationToken).ConfigureAwait(false);
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
            await StopCoreAsync(CancellationToken.None).ConfigureAwait(false);
            _pool.FrameArrived -= OnFrameArrived;
            _pool.Closed -= OnClosed;
            _pool.Faulted -= OnFaulted;
            await _pool.DisposeAsync().ConfigureAwait(false);
            _disposed = true;
        }
        finally
        {
            _lifecycleGate.Release();
            _lifecycleGate.Dispose();
            _frameSignal.Dispose();
        }
    }

    private void OnFrameArrived(object? sender, EventArgs args)
    {
        if (_disposed || Volatile.Read(ref _acceptFrames) != 1) return;

        IWindowsGraphicsNativeFrame? frame;
        try
        {
            frame = _pool.TryGetNextFrame();
        }
        catch (WindowsGraphicsCaptureException error)
        {
            RaiseFault(error);
            return;
        }
        catch (Exception error)
        {
            RaiseFault(new WindowsGraphicsCaptureException(
                WindowsGraphicsCaptureFailureKind.Capture,
                "Could not acquire the next graphics capture frame.",
                error));
            return;
        }

        if (frame is null) return;
        if (_disposed || Volatile.Read(ref _acceptFrames) != 1)
        {
            frame.Dispose();
            return;
        }

        var stale = Interlocked.Exchange(ref _pendingFrame, frame);
        if (stale is not null)
        {
            stale.Dispose();
            Interlocked.Increment(ref _droppedFrames);
        }

        try
        {
            if (_frameSignal.CurrentCount == 0) _frameSignal.Release();
        }
        catch (ObjectDisposedException) when (_disposed)
        {
            var pending = Interlocked.Exchange(ref _pendingFrame, null);
            pending?.Dispose();
        }
    }

    private void OnClosed(object? sender, EventArgs args) =>
        RaiseFault(new WindowsGraphicsCaptureException(
            WindowsGraphicsCaptureFailureKind.Disconnected,
            "The captured display or window is no longer available."));

    private void OnFaulted(object? sender, WindowsGraphicsCaptureException error) => RaiseFault(error);

    private void RaiseFault(WindowsGraphicsCaptureException error)
    {
        if (_disposed || Interlocked.Exchange(ref _acceptFrames, 0) != 1) return;
        try { Faulted?.Invoke(this, error); } catch { }
    }

    private async Task RunReadbackLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                await _frameSignal.WaitAsync(cancellationToken).ConfigureAwait(false);
                var frame = Interlocked.Exchange(ref _pendingFrame, null);
                if (frame is null) continue;
                try
                {
                    var result = frame.ReadBgra32();
                    if (result.Width <= 0 || result.Height <= 0 ||
                        result.Stride < result.Width * 4 ||
                        result.Buffer.Length < checked(result.Stride * result.Height))
                    {
                        throw new WindowsGraphicsCaptureException(
                            WindowsGraphicsCaptureFailureKind.Capture,
                            "Graphics capture returned an invalid BGRA32 frame.");
                    }

                    if (frame.Width != _poolWidth || frame.Height != _poolHeight)
                    {
                        _pool.Recreate(frame.Width, frame.Height);
                        _poolWidth = frame.Width;
                        _poolHeight = frame.Height;
                    }

                    if (Volatile.Read(ref _acceptFrames) != 1 || _disposed) continue;
                    try { FrameReady?.Invoke(this, result); } catch { }
                }
                catch (WindowsGraphicsCaptureException error)
                {
                    RaiseFault(error);
                }
                catch (Exception error)
                {
                    RaiseFault(new WindowsGraphicsCaptureException(
                        WindowsGraphicsCaptureFailureKind.Capture,
                        "Graphics frame readback failed.",
                        error));
                }
                finally
                {
                    frame.Dispose();
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }

    private async Task StopCoreAsync(CancellationToken cancellationToken)
    {
        Interlocked.Exchange(ref _acceptFrames, 0);
        var cts = _runCts;
        var worker = _worker;

        cts?.Cancel();
        try
        {
            if (_frameSignal.CurrentCount == 0) _frameSignal.Release();
        }
        catch (ObjectDisposedException) when (_disposed)
        {
        }

        Exception? workerFailure = null;
        if (worker is not null)
        {
            try { await worker.ConfigureAwait(false); }
            catch (OperationCanceledException) when (cts?.IsCancellationRequested == true) { }
            catch (Exception error) { workerFailure = error; }
        }

        DisposePendingFrame();

        if (_poolStarted)
        {
            await _pool.StopAsync(cancellationToken).ConfigureAwait(false);
            _poolStarted = false;
        }

        if (ReferenceEquals(_runCts, cts))
        {
            _runCts = null;
            _worker = null;
        }
        cts?.Dispose();

        if (workerFailure is not null) throw workerFailure;
    }

    private void DisposePendingFrame()
    {
        var pending = Interlocked.Exchange(ref _pendingFrame, null);
        pending?.Dispose();
    }
}

public sealed class WindowsGraphicsCaptureSession : IVisualCaptureSession
{
    private readonly VisualCaptureOptions _options;
    private readonly WindowsGraphicsFramePump _pump;
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private readonly object _statusGate = new();
    private VisualCaptureStatus _status;
    private ProgramVideoFrame? _latestFrame;
    private int _acceptFrames;
    private long _framesCaptured;
    private long _droppedFrames;
    private bool _disposed;

    public WindowsGraphicsCaptureSession(
        VisualSourceDescriptor source,
        VisualCaptureOptions options,
        TimeProvider? clock = null)
        : this(source, options, new WindowsGraphicsFramePump(new WindowsGraphicsNativeFramePool(clock)), clock)
    {
    }

    internal WindowsGraphicsCaptureSession(
        VisualSourceDescriptor source,
        VisualCaptureOptions options,
        WindowsGraphicsFramePump pump,
        TimeProvider? clock = null)
    {
        Source = source ?? throw new ArgumentNullException(nameof(source));
        if (source.Kind is not (VisualSourceKind.Display or VisualSourceKind.Window))
            throw new ArgumentException("Windows Graphics Capture requires a display or window source.", nameof(source));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _ = clock ?? TimeProvider.System;
        _pump = pump ?? throw new ArgumentNullException(nameof(pump));
        _status = new VisualCaptureStatus(false, source.Availability, 0, 0, null, source.ErrorCode);
        _pump.FrameReady += OnFrameReady;
        _pump.Faulted += OnPumpFaulted;
    }

    public event EventHandler? StatusChanged;
    public VisualSourceDescriptor Source { get; }

    public VisualCaptureStatus Status
    {
        get { lock (_statusGate) return _status; }
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
            if (!string.Equals(_options.PixelFormat, "bgra32", StringComparison.OrdinalIgnoreCase))
            {
                SetStatus(ToFailureStatus(
                    new WindowsGraphicsCaptureException(
                        WindowsGraphicsCaptureFailureKind.Unsupported,
                        "Only BGRA32 graphics capture is supported."),
                    0, 0, null));
                return Status;
            }

            Interlocked.Exchange(ref _latestFrame, null);
            Interlocked.Exchange(ref _framesCaptured, 0);
            Interlocked.Exchange(ref _droppedFrames, 0);
            Interlocked.Exchange(ref _acceptFrames, 1);
            try
            {
                await _pump.StartAsync(Source, cancellationToken).ConfigureAwait(false);
                SetStatus(new VisualCaptureStatus(true, VisualSourceAvailability.Available, 0, 0, null, null));
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                Interlocked.Exchange(ref _acceptFrames, 0);
                throw;
            }
            catch (WindowsGraphicsCaptureException error)
            {
                Interlocked.Exchange(ref _acceptFrames, 0);
                SetStatus(ToFailureStatus(error, 0, 0, null));
            }
            catch (Exception error)
            {
                Interlocked.Exchange(ref _acceptFrames, 0);
                SetStatus(ToFailureStatus(
                    new WindowsGraphicsCaptureException(
                        WindowsGraphicsCaptureFailureKind.Capture,
                        "Graphics capture could not start.",
                        error),
                    0, 0, null));
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
            await _pump.StopAsync(cancellationToken).ConfigureAwait(false);
            var current = Status;
            if (current.IsRunning)
            {
                SetStatus(new VisualCaptureStatus(
                    false,
                    VisualSourceAvailability.Available,
                    Interlocked.Read(ref _framesCaptured),
                    Interlocked.Read(ref _droppedFrames),
                    current.LastFrameAt,
                    null));
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
            await _pump.StopAsync(CancellationToken.None).ConfigureAwait(false);
            _pump.FrameReady -= OnFrameReady;
            _pump.Faulted -= OnPumpFaulted;
            await _pump.DisposeAsync().ConfigureAwait(false);
            _disposed = true;
        }
        finally
        {
            _lifecycleGate.Release();
            _lifecycleGate.Dispose();
        }
    }

    private void OnFrameReady(object? sender, WindowsGraphicsFrame frame)
    {
        if (_disposed || Volatile.Read(ref _acceptFrames) != 1) return;
        lock (_statusGate)
        {
            if (_disposed || Volatile.Read(ref _acceptFrames) != 1 || !_status.IsRunning) return;
            var programFrame = new ProgramVideoFrame(
                frame.Width, frame.Height, frame.Stride, "bgra32",
                frame.Buffer, null, frame.CapturedAt);
            var previous = Interlocked.Exchange(ref _latestFrame, programFrame);
            var captured = Interlocked.Increment(ref _framesCaptured);
            if (previous is not null) Interlocked.Increment(ref _droppedFrames);
            _status = _status with
            {
                Availability = VisualSourceAvailability.Available,
                ErrorCode = null,
                FramesCaptured = captured,
                DroppedFrames = Interlocked.Read(ref _droppedFrames),
                LastFrameAt = frame.CapturedAt
            };
        }
    }

    private void OnPumpFaulted(object? sender, WindowsGraphicsCaptureException error)
    {
        lock (_statusGate)
        {
            if (_disposed || Volatile.Read(ref _acceptFrames) != 1 || !_status.IsRunning) return;
            Interlocked.Exchange(ref _acceptFrames, 0);
            _status = ToFailureStatus(
                error,
                Interlocked.Read(ref _framesCaptured),
                Interlocked.Read(ref _droppedFrames),
                _status.LastFrameAt);
        }
        StatusChanged?.Invoke(this, EventArgs.Empty);
    }

    private void SetStatus(VisualCaptureStatus status)
    {
        lock (_statusGate) _status = status;
        StatusChanged?.Invoke(this, EventArgs.Empty);
    }

    private static VisualCaptureStatus ToFailureStatus(
        WindowsGraphicsCaptureException error,
        long framesCaptured,
        long droppedFrames,
        DateTimeOffset? lastFrameAt)
    {
        var (availability, code) = error.Kind switch
        {
            WindowsGraphicsCaptureFailureKind.Permission =>
                (VisualSourceAvailability.PermissionRequired, "screen_permission"),
            WindowsGraphicsCaptureFailureKind.Unsupported =>
                (VisualSourceAvailability.Unsupported, "screen_unsupported"),
            WindowsGraphicsCaptureFailureKind.Disconnected =>
                (VisualSourceAvailability.Disconnected, "screen_disconnected"),
            _ => (VisualSourceAvailability.Error, "screen_capture_failed")
        };
        return new VisualCaptureStatus(false, availability, framesCaptured, droppedFrames, lastFrameAt, code);
    }
}
