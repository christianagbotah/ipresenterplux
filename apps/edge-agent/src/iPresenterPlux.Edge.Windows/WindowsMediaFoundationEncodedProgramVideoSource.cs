using SharpMediaFoundationInterop.Transforms.Colors;
using Windows.Win32;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Windows;

public sealed class WindowsMediaFoundationEncodedProgramVideoSource(
    IProgramVideoSource programVideoSource) : IEncodedProgramVideoSource
{
    private readonly IProgramVideoSource _programVideoSource = programVideoSource ?? throw new ArgumentNullException(nameof(programVideoSource));
    private readonly object _gate = new();
    private CancellationTokenSource? _runCts;
    private Task? _worker;
    private bool _capturing;
    private long _framesEncoded;
    private long _droppedFrames;
    private string? _errorCode;
    private bool _disposed;

    public event EventHandler<EncodedProgramVideoFrame>? FrameEncoded;

    public ProgramVideoSourceStatus Status
    {
        get
        {
            lock (_gate)
            {
                return new ProgramVideoSourceStatus(
                    _capturing,
                    _capturing ? "capturing" : _errorCode is null ? "idle" : "error",
                    Interlocked.Read(ref _framesEncoded),
                    Interlocked.Read(ref _droppedFrames),
                    _errorCode);
            }
        }
    }

    public async Task<ProgramVideoSourceStatus> StartAsync(
        ProgramVideoCaptureTarget target,
        ProgramVideoCaptureOptions options,
        CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        target.Validate();
        options.Validate();
        if ((options.Width & 1) != 0 || (options.Height & 1) != 0)
            throw new ArgumentException("NV12 encoding requires even frame dimensions.", nameof(options));
        cancellationToken.ThrowIfCancellationRequested();

        TaskCompletionSource<ProgramVideoSourceStatus> started;
        CancellationTokenSource runCts;
        lock (_gate)
        {
            if (_capturing) return Status;
            if (_worker is { IsCompleted: false })
                throw new InvalidOperationException("The Program video encoder is still stopping.");

            _errorCode = null;
            Interlocked.Exchange(ref _framesEncoded, 0);
            Interlocked.Exchange(ref _droppedFrames, 0);
            runCts = new CancellationTokenSource();
            _runCts = runCts;
            started = new TaskCompletionSource<ProgramVideoSourceStatus>(TaskCreationOptions.RunContinuationsAsynchronously);
            _worker = Task.Run(() => RunAsync(options, started, runCts.Token), CancellationToken.None);
        }

        try
        {
            return await started.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            runCts.Cancel();
            throw;
        }
    }

    public async Task<ProgramVideoSourceStatus> StopAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();

        CancellationTokenSource? runCts;
        Task? worker;
        lock (_gate)
        {
            runCts = _runCts;
            worker = _worker;
        }

        if (runCts is not null) runCts.Cancel();
        if (worker is not null)
        {
            try { await worker.WaitAsync(cancellationToken).ConfigureAwait(false); }
            catch (OperationCanceledException) when (runCts?.IsCancellationRequested == true && !cancellationToken.IsCancellationRequested) { }
        }

        lock (_gate)
        {
            _capturing = false;
            _errorCode = null;
            if (ReferenceEquals(_runCts, runCts))
            {
                _runCts?.Dispose();
                _runCts = null;
                _worker = null;
            }
        }
        return Status;
    }

    private async Task RunAsync(
        ProgramVideoCaptureOptions options,
        TaskCompletionSource<ProgramVideoSourceStatus> started,
        CancellationToken cancellationToken)
    {
        try
        {
            using var encoder = new ExactH264Encoder(
                (uint)options.Width,
                (uint)options.Height,
                (uint)options.FramesPerSecond,
                (uint)options.BitrateBps);
            encoder.Initialize();

            using var converter = new ColorConverter(
                PInvoke.MFVideoFormat_ARGB32,
                encoder.InputFormat,
                (uint)options.Width,
                (uint)options.Height);
            converter.Initialize();

            var packedArgb = new byte[checked(options.Width * options.Height * 4)];
            var nv12 = new byte[Math.Max(checked(options.Width * options.Height * 3 / 2), checked((int)converter.OutputSize))];
            var h264 = new byte[Math.Max(1_048_576, checked((int)encoder.OutputSize))];

            lock (_gate) _capturing = true;
            started.TrySetResult(Status);

            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1d / options.FramesPerSecond));
            long frameNumber = 0;
            while (!cancellationToken.IsCancellationRequested)
            {
                EncodeCurrentFrame(options, converter, encoder, packedArgb, ref nv12, ref h264, frameNumber);
                frameNumber++;
                if (!await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false)) break;
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            started.TrySetResult(Status);
        }
        catch (NotSupportedException)
        {
            var failed = SetFailure("encoder_unavailable");
            started.TrySetResult(failed);
        }
        catch
        {
            var failed = SetFailure("encoder_failed");
            started.TrySetResult(failed);
        }
        finally
        {
            lock (_gate) _capturing = false;
        }
    }

    private void EncodeCurrentFrame(
        ProgramVideoCaptureOptions options,
        ColorConverter converter,
        ExactH264Encoder encoder,
        byte[] packedArgb,
        ref byte[] nv12,
        ref byte[] h264,
        long frameNumber)
    {
        var frame = _programVideoSource.GetCurrentFrame();
        if (frame.Width != options.Width || frame.Height != options.Height ||
            !string.Equals(frame.PixelFormat, "bgra32", StringComparison.OrdinalIgnoreCase) ||
            frame.Stride < options.Width * 4 ||
            frame.Buffer.Length < frame.Stride * frame.Height)
        {
            Interlocked.Increment(ref _droppedFrames);
            return;
        }

        ReadOnlySpan<byte> argb;
        if (frame.Stride == options.Width * 4)
        {
            argb = frame.Buffer.Span[..packedArgb.Length];
        }
        else
        {
            var source = frame.Buffer.Span;
            var rowBytes = options.Width * 4;
            for (var row = 0; row < options.Height; row++)
                source.Slice(row * frame.Stride, rowBytes).CopyTo(packedArgb.AsSpan(row * rowBytes, rowBytes));
            argb = packedArgb;
        }

        var timestampTicks = (long)((Int128)frameNumber * 10_000_000 / options.FramesPerSecond);
        if (!converter.ProcessInput(argb, timestampTicks))
        {
            Interlocked.Increment(ref _droppedFrames);
            return;
        }

        var producedVideo = false;
        while (converter.ProcessOutput(ref nv12, out var nv12Length, out var convertedTimestamp))
        {
            if (nv12Length == 0 || !encoder.ProcessInput(nv12.AsSpan(0, checked((int)nv12Length)), convertedTimestamp))
            {
                Interlocked.Increment(ref _droppedFrames);
                continue;
            }

            while (encoder.ProcessOutput(ref h264, out var encodedLength, out var encodedTimestamp))
            {
                if (encodedLength == 0) continue;
                producedVideo = true;
                var bytes = GC.AllocateUninitializedArray<byte>(checked((int)encodedLength));
                h264.AsSpan(0, bytes.Length).CopyTo(bytes);
                try
                {
                    FrameEncoded?.Invoke(this, new EncodedProgramVideoFrame(
                        bytes,
                        options.Width,
                        options.Height,
                        "h264",
                        "annexb",
                        AnnexBVideo.IsH264KeyFrame(bytes),
                        encodedTimestamp / 10));
                    Interlocked.Increment(ref _framesEncoded);
                }
                catch
                {
                    Interlocked.Increment(ref _droppedFrames);
                }
            }
        }

        if (!producedVideo && frameNumber > 2)
            Interlocked.Increment(ref _droppedFrames);
    }

    private ProgramVideoSourceStatus SetFailure(string errorCode)
    {
        lock (_gate)
        {
            _capturing = false;
            _errorCode = errorCode;
        }
        return Status;
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await StopAsync(cts.Token).ConfigureAwait(false);
        }
        catch { }
        _disposed = true;
    }
}
