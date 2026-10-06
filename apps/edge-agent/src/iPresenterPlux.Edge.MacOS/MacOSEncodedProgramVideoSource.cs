using System.Runtime.InteropServices;
using iPresenterPlux.Edge.Core.Abstractions;

namespace iPresenterPlux.Edge.MacOS;

public sealed class MacOSEncodedProgramVideoSource : IEncodedProgramVideoSource
{
    private const string LibraryName = "iPresenterPluxMediaBridge";
    private const int RequiredBridgeApiVersion = 4;
    private readonly object _gate = new();
    private readonly ProgramVideoFrameCallback _callback;
    private bool _capturing;
    private long _framesEncoded;
    private long _droppedFrames;
    private string? _errorCode;
    private bool _disposed;

    public MacOSEncodedProgramVideoSource()
    {
        _callback = OnNativeFrame;
    }

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
        cancellationToken.ThrowIfCancellationRequested();

        lock (_gate)
        {
            if (_capturing) return Status;
            _errorCode = null;
            Interlocked.Exchange(ref _framesEncoded, 0);
            Interlocked.Exchange(ref _droppedFrames, 0);
        }

        int nativeStatus;
        try
        {
            if (NativeMethods.BridgeApiVersion() < RequiredBridgeApiVersion)
                return SetFailure("native_bridge_outdated");

            nativeStatus = await Task.Run(() => NativeMethods.ProgramVideoStart(
                target.ProcessId,
                target.WindowTitle,
                options.Width,
                options.Height,
                options.FramesPerSecond,
                options.BitrateBps,
                _callback), CancellationToken.None).ConfigureAwait(false);
        }
        catch (DllNotFoundException)
        {
            return SetFailure("native_bridge_unavailable");
        }
        catch (EntryPointNotFoundException)
        {
            return SetFailure("native_bridge_outdated");
        }

        if (cancellationToken.IsCancellationRequested)
        {
            try { NativeMethods.ProgramVideoStop(); } catch { }
            cancellationToken.ThrowIfCancellationRequested();
        }
        if (nativeStatus != 0) return SetFailure(ClassifyNativeStatus(nativeStatus));

        lock (_gate) _capturing = true;
        return Status;
    }

    public Task<ProgramVideoSourceStatus> StopAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(StopCore());
    }

    private ProgramVideoSourceStatus StopCore()
    {
        bool shouldStop;
        lock (_gate) shouldStop = _capturing;
        if (!shouldStop)
        {
            lock (_gate) _errorCode = null;
            return Status;
        }

        try
        {
            var nativeStatus = NativeMethods.ProgramVideoStop();
            if (nativeStatus != 0) return SetFailure("capture_stop_failed");
        }
        catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException)
        {
            return SetFailure("native_bridge_unavailable");
        }

        lock (_gate)
        {
            _capturing = false;
            _errorCode = null;
        }
        return Status;
    }

    private void OnNativeFrame(
        IntPtr data,
        int length,
        int width,
        int height,
        int keyFrame,
        long presentationTimestampMicroseconds)
    {
        if (data == IntPtr.Zero || length <= 0 || width <= 0 || height <= 0)
        {
            Interlocked.Increment(ref _droppedFrames);
            return;
        }

        bool accepting;
        lock (_gate) accepting = _capturing;
        if (!accepting) return;

        try
        {
            var bytes = GC.AllocateUninitializedArray<byte>(length);
            Marshal.Copy(data, bytes, 0, length);
            Interlocked.Increment(ref _framesEncoded);
            FrameEncoded?.Invoke(this, new EncodedProgramVideoFrame(
                bytes,
                width,
                height,
                "h264",
                "annexb",
                keyFrame == 1,
                presentationTimestampMicroseconds));
        }
        catch
        {
            Interlocked.Increment(ref _droppedFrames);
        }
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

    private static string ClassifyNativeStatus(int status) => status switch
    {
        -2012 => "screen_capture_permission",
        -2013 => "program_window_not_found",
        -2014 or -2015 or -2016 => "screen_capture_failed",
        -2020 or -2021 => "encoder_unavailable",
        _ => "screen_capture_failed"
    };

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        try { StopCore(); } catch { }
        _disposed = true;
        await Task.CompletedTask;
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void ProgramVideoFrameCallback(
        IntPtr data,
        int length,
        int width,
        int height,
        int keyFrame,
        long presentationTimestampMicroseconds);

    #pragma warning disable SYSLIB1054 // Swift bridge exposes a stable C ABI.
    private static class NativeMethods
    {
        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_bridge_api_version", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int BridgeApiVersion();

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_program_video_start", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int ProgramVideoStart(
            int processId,
            [MarshalAs(UnmanagedType.LPUTF8Str)] string titleHint,
            int width,
            int height,
            int framesPerSecond,
            int bitrate,
            ProgramVideoFrameCallback callback);

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_program_video_stop", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int ProgramVideoStop();
    }
    #pragma warning restore SYSLIB1054
}
