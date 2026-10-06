using System.Runtime.InteropServices;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.MacOS;

public sealed class MacOSEncodedProgramAudioSource(
    IContributionAudioBuffer audioBuffer) : IEncodedProgramAudioSource
{
    private const string LibraryName = "iPresenterPluxMediaBridge";
    private const int SamplesPerPacketPerChannel = 1024;
    private readonly IContributionAudioBuffer _audioBuffer = audioBuffer ?? throw new ArgumentNullException(nameof(audioBuffer));
    private readonly object _gate = new();
    private readonly ProgramAudioFrameCallback _callback;
    private CancellationTokenSource? _runCts;
    private Task? _worker;
    private bool _capturing;
    private Guid? _serviceId;
    private long _framesEncoded;
    private long _droppedFrames;
    private string? _errorCode;
    private bool _disposed;

    public MacOSEncodedProgramAudioSource()
        : this(new BoundedContributionAudioBuffer())
    {
    }

    public MacOSEncodedProgramAudioSource(IContributionAudioBuffer audioBuffer, bool _ = false)
        : this(audioBuffer)
    {
    }

    // Primary-constructor initialization cannot assign delegates, so this field initializer
    // keeps the callback rooted for the entire native encoder lifetime.
    private ProgramAudioFrameCallback Callback => _callback;

    public event EventHandler<EncodedProgramAudioFrame>? FrameEncoded;

    public ProgramAudioSourceStatus Status
    {
        get
        {
            lock (_gate)
            {
                return new ProgramAudioSourceStatus(
                    _capturing,
                    _capturing ? "capturing" : _errorCode is null ? "idle" : "error",
                    _serviceId,
                    Interlocked.Read(ref _framesEncoded),
                    Interlocked.Read(ref _droppedFrames),
                    _errorCode);
            }
        }
    }

    public async Task<ProgramAudioSourceStatus> StartAsync(
        Guid serviceId,
        ProgramAudioCaptureOptions options,
        CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (serviceId == Guid.Empty) throw new ArgumentOutOfRangeException(nameof(serviceId));
        ArgumentNullException.ThrowIfNull(options);
        options.Validate();
        cancellationToken.ThrowIfCancellationRequested();

        lock (_gate)
        {
            if (_capturing)
            {
                if (_serviceId == serviceId) return Status;
                throw new InvalidOperationException("Encoded Program audio is already assigned to another service.");
            }
            if (_worker is { IsCompleted: false })
                throw new InvalidOperationException("The Program audio encoder is still stopping.");
            _serviceId = serviceId;
            _errorCode = null;
            Interlocked.Exchange(ref _framesEncoded, 0);
            Interlocked.Exchange(ref _droppedFrames, 0);
        }

        int nativeStatus;
        try
        {
            nativeStatus = NativeMethods.ProgramAudioStart(
                options.SampleRate,
                options.Channels,
                options.BitrateBps,
                Callback);
        }
        catch (DllNotFoundException)
        {
            return SetFailure("native_bridge_unavailable");
        }
        catch (EntryPointNotFoundException)
        {
            return SetFailure("native_bridge_outdated");
        }

        if (nativeStatus != 0)
            return SetFailure(ClassifyNativeStatus(nativeStatus));
        if (cancellationToken.IsCancellationRequested)
        {
            try { NativeMethods.ProgramAudioStop(); } catch { }
            cancellationToken.ThrowIfCancellationRequested();
        }

        var runCts = new CancellationTokenSource();
        lock (_gate)
        {
            _runCts = runCts;
            _capturing = true;
        }
        _audioBuffer.Enable(serviceId);
        _worker = Task.Run(() => RunAsync(options, runCts.Token), CancellationToken.None);
        return Status;
    }

    public async Task<ProgramAudioSourceStatus> StopAsync(CancellationToken cancellationToken)
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

        _audioBuffer.Disable();
        runCts?.Cancel();
        if (worker is not null)
        {
            try { await worker.WaitAsync(cancellationToken).ConfigureAwait(false); }
            catch (OperationCanceledException) when (runCts?.IsCancellationRequested == true && !cancellationToken.IsCancellationRequested) { }
        }

        try
        {
            var nativeStatus = NativeMethods.ProgramAudioStop();
            if (nativeStatus != 0) return SetFailure("encoder_stop_failed");
        }
        catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException)
        {
            return SetFailure("native_bridge_unavailable");
        }

        lock (_gate)
        {
            _capturing = false;
            _serviceId = null;
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

    private async Task RunAsync(ProgramAudioCaptureOptions options, CancellationToken cancellationToken)
    {
        var normalizer = new StreamingStereoPcm16Normalizer(options.SampleRate);
        var accumulator = new StereoPcm16FrameAccumulator(SamplesPerPacketPerChannel);
        var pcm = new byte[SamplesPerPacketPerChannel * options.Channels * sizeof(short)];
        var packetDurationUs = checked((long)(SamplesPerPacketPerChannel * 1_000_000L / options.SampleRate));
        long packetNumber = 0;

        try
        {
            await foreach (var frame in _audioBuffer.ReadAllAsync(cancellationToken).ConfigureAwait(false))
            {
                var normalized = normalizer.Process(frame);
                if (normalized.Length == 0) continue;

                foreach (var packet in accumulator.Append(normalized))
                {
                    Buffer.BlockCopy(packet, 0, pcm, 0, pcm.Length);
                    var timestampUs = checked((long)((Int128)packetNumber * SamplesPerPacketPerChannel * 1_000_000 / options.SampleRate));
                    packetNumber++;

                    int nativeStatus;
                    try
                    {
                        nativeStatus = NativeMethods.ProgramAudioEncode(
                            pcm,
                            pcm.Length,
                            timestampUs,
                            packetDurationUs);
                    }
                    catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException)
                    {
                        SetFailure("native_bridge_unavailable");
                        return;
                    }

                    if (nativeStatus == 0) continue;
                    Interlocked.Increment(ref _droppedFrames);
                    if (nativeStatus <= -3010)
                    {
                        SetFailure("encoder_failed");
                        return;
                    }
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch
        {
            SetFailure("encoder_failed");
        }
    }

    private void OnNativeFrame(
        IntPtr data,
        int length,
        int sampleRate,
        int channels,
        long presentationTimestampMicroseconds,
        long durationMicroseconds)
    {
        if (data == IntPtr.Zero || length <= 0 || sampleRate <= 0 || channels <= 0)
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
            FrameEncoded?.Invoke(this, new EncodedProgramAudioFrame(
                bytes,
                sampleRate,
                channels,
                "aac",
                "adts",
                presentationTimestampMicroseconds,
                durationMicroseconds));
            Interlocked.Increment(ref _framesEncoded);
        }
        catch
        {
            Interlocked.Increment(ref _droppedFrames);
        }
    }

    private ProgramAudioSourceStatus SetFailure(string errorCode)
    {
        _audioBuffer.Disable();
        lock (_gate)
        {
            _capturing = false;
            _serviceId = null;
            _errorCode = errorCode;
        }
        return Status;
    }

    private static string ClassifyNativeStatus(int status) => status switch
    {
        -3010 or -3011 => "encoder_unavailable",
        -3012 or -3014 or -3015 or -3016 => "invalid_audio_frame",
        -3013 or -3017 or -3018 or -3020 => "encoder_failed",
        _ => "encoder_failed"
    };

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

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void ProgramAudioFrameCallback(
        IntPtr data,
        int length,
        int sampleRate,
        int channels,
        long presentationTimestampMicroseconds,
        long durationMicroseconds);

    #pragma warning disable SYSLIB1054 // Swift bridge exposes a stable C ABI.
    private static class NativeMethods
    {
        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_program_audio_start", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int ProgramAudioStart(
            int sampleRate,
            int channels,
            int bitrate,
            ProgramAudioFrameCallback callback);

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_program_audio_encode", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int ProgramAudioEncode(
            [In] byte[] bytes,
            int length,
            long presentationTimestampMicroseconds,
            long durationMicroseconds);

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_program_audio_stop", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int ProgramAudioStop();
    }
    #pragma warning restore SYSLIB1054
}
