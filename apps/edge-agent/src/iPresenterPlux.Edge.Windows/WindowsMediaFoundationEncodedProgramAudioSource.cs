using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Windows;

public sealed class WindowsMediaFoundationEncodedProgramAudioSource(
    IContributionAudioBuffer audioBuffer) : IEncodedProgramAudioSource
{
    private const int SamplesPerPacketPerChannel = 1024;
    private readonly IContributionAudioBuffer _audioBuffer = audioBuffer ?? throw new ArgumentNullException(nameof(audioBuffer));
    private readonly object _gate = new();
    private CancellationTokenSource? _runCts;
    private Task? _worker;
    private bool _capturing;
    private Guid? _serviceId;
    private long _framesEncoded;
    private long _droppedFrames;
    private string? _errorCode;
    private bool _disposed;

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

        TaskCompletionSource<ProgramAudioSourceStatus> started;
        CancellationTokenSource runCts;
        lock (_gate)
        {
            if (_capturing)
            {
                if (_serviceId == serviceId) return Status;
                throw new InvalidOperationException("Encoded Program audio is already assigned to another service.");
            }
            if (_worker is { IsCompleted: false })
                throw new InvalidOperationException("The Program audio encoder is still stopping.");

            _errorCode = null;
            _serviceId = serviceId;
            Interlocked.Exchange(ref _framesEncoded, 0);
            Interlocked.Exchange(ref _droppedFrames, 0);
            runCts = new CancellationTokenSource();
            _runCts = runCts;
            started = new TaskCompletionSource<ProgramAudioSourceStatus>(TaskCreationOptions.RunContinuationsAsynchronously);
            _audioBuffer.Enable(serviceId);
            _worker = Task.Run(() => RunAsync(options, started, runCts.Token), CancellationToken.None);
        }

        try
        {
            return await started.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            _audioBuffer.Disable();
            runCts.Cancel();
            throw;
        }
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

    private async Task RunAsync(
        ProgramAudioCaptureOptions options,
        TaskCompletionSource<ProgramAudioSourceStatus> started,
        CancellationToken cancellationToken)
    {
        try
        {
            var normalizer = new StreamingStereoPcm16Normalizer(options.SampleRate);
            var accumulator = new StereoPcm16FrameAccumulator(SamplesPerPacketPerChannel);
            using var encoder = new AdtsAacEncoder(
                (uint)options.Channels,
                (uint)options.SampleRate,
                (uint)options.BitrateBps);
            encoder.Initialize();

            var pcm = new byte[SamplesPerPacketPerChannel * options.Channels * sizeof(short)];
            var encoded = new byte[Math.Max(64 * 1024, checked((int)encoder.OutputSize))];
            var pendingTimestamps = new Queue<long>();
            var packetDurationUs = checked((long)(SamplesPerPacketPerChannel * 1_000_000L / options.SampleRate));
            long packetNumber = 0;

            lock (_gate) _capturing = true;
            started.TrySetResult(Status);

            await foreach (var frame in _audioBuffer.ReadAllAsync(cancellationToken).ConfigureAwait(false))
            {
                var normalized = normalizer.Process(frame);
                if (normalized.Length == 0) continue;

                foreach (var packet in accumulator.Append(normalized))
                {
                    Buffer.BlockCopy(packet, 0, pcm, 0, pcm.Length);
                    var timestampUs = checked((long)((Int128)packetNumber * SamplesPerPacketPerChannel * 1_000_000 / options.SampleRate));
                    var timestampTicks = checked(timestampUs * 10);
                    packetNumber++;

                    if (!encoder.ProcessInput(pcm, timestampTicks))
                    {
                        Interlocked.Increment(ref _droppedFrames);
                        continue;
                    }
                    pendingTimestamps.Enqueue(timestampUs);

                    while (encoder.ProcessOutput(ref encoded, out var encodedLength))
                    {
                        if (encodedLength == 0) continue;
                        var bytes = GC.AllocateUninitializedArray<byte>(checked((int)encodedLength));
                        encoded.AsSpan(0, bytes.Length).CopyTo(bytes);
                        var outputTimestampUs = pendingTimestamps.Count > 0
                            ? pendingTimestamps.Dequeue()
                            : timestampUs;

                        try
                        {
                            FrameEncoded?.Invoke(this, new EncodedProgramAudioFrame(
                                bytes,
                                options.SampleRate,
                                options.Channels,
                                "aac",
                                "adts",
                                outputTimestampUs,
                                packetDurationUs));
                            Interlocked.Increment(ref _framesEncoded);
                        }
                        catch
                        {
                            Interlocked.Increment(ref _droppedFrames);
                        }
                    }
                }
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
