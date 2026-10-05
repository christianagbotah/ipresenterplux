using System.Threading.Channels;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class AudioTranscriptionPipeline : IAsyncDisposable
{
    private const double DefaultSilenceThresholdDb = -50d;
    private const int SpeechWindowMilliseconds = 200;
    private const int MinimumActiveWindows = 2;

    private readonly ISpeechRecognitionEngine _engine;
    private readonly Func<Guid, TranscriptSegment, CancellationToken, Task> _publish;
    private readonly StreamingPcm16Normalizer _normalizer = new();
    private readonly SpeechChunkAccumulator _chunks = new();
    private readonly Channel<AudioFrame> _frames;
    private readonly CancellationTokenSource _stop = new();
    private readonly Task _worker;
    private readonly double _silenceThresholdDb;
    private readonly Guid? _serviceId;
    private long _sequence;
    private long _droppedFrames;
    private long _recognizedChunks;
    private long _silentChunks;
    private long _failedChunks;
    private int _consecutiveFailures;
    private string? _lastError;
    private long _lastSuccessUnixMs;
    private long _publishedChunks;
    private long _publishFailedChunks;
    private int _consecutivePublishFailures;
    private string? _lastPublishError;

    public AudioTranscriptionPipeline(
        ISpeechRecognitionEngine engine,
        Func<Guid, TranscriptSegment, CancellationToken, Task> publish,
        int frameCapacity = 256,
        double silenceThresholdDb = DefaultSilenceThresholdDb,
        Guid? serviceId = null)
    {
        _engine = engine ?? throw new ArgumentNullException(nameof(engine));
        _publish = publish ?? throw new ArgumentNullException(nameof(publish));
        if (frameCapacity <= 0) throw new ArgumentOutOfRangeException(nameof(frameCapacity));
        if (!double.IsFinite(silenceThresholdDb) || silenceThresholdDb is < -120d or > 0d)
            throw new ArgumentOutOfRangeException(nameof(silenceThresholdDb));
        _silenceThresholdDb = silenceThresholdDb;
        _serviceId = serviceId;
        _frames = Channel.CreateBounded<AudioFrame>(new BoundedChannelOptions(frameCapacity)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.Wait
        });
        _worker = Task.Run(ProcessAsync);
    }

    public long DroppedFrames => Interlocked.Read(ref _droppedFrames);
    public long RecognizedChunks => Interlocked.Read(ref _recognizedChunks);
    public long SilentChunks => Interlocked.Read(ref _silentChunks);
    public long FailedChunks => Interlocked.Read(ref _failedChunks);
    public int ConsecutiveFailures => Volatile.Read(ref _consecutiveFailures);
    public string? LastError => Volatile.Read(ref _lastError);
    public long PublishedChunks => Interlocked.Read(ref _publishedChunks);
    public long PublishFailedChunks => Interlocked.Read(ref _publishFailedChunks);
    public int ConsecutivePublishFailures => Volatile.Read(ref _consecutivePublishFailures);
    public string? LastPublishError => Volatile.Read(ref _lastPublishError);

    public DateTimeOffset? LastSuccessAt
    {
        get
        {
            var value = Interlocked.Read(ref _lastSuccessUnixMs);
            return value <= 0 ? null : DateTimeOffset.FromUnixTimeMilliseconds(value);
        }
    }

    public string HealthStatus =>
        ConsecutiveFailures > 0 ? "degraded" :
        LastSuccessAt is not null ? "ready" :
        SilentChunks > 0 ? "idle" :
        "starting";

    public string PublishStatus =>
        ConsecutivePublishFailures > 0 ? "degraded" :
        PublishedChunks > 0 ? "ready" :
        "starting";

    public bool TrySubmit(AudioFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (_frames.Writer.TryWrite(frame)) return true;
        Interlocked.Increment(ref _droppedFrames);
        return false;
    }

    private async Task ProcessAsync()
    {
        try
        {
            await foreach (var frame in _frames.Reader.ReadAllAsync(_stop.Token).ConfigureAwait(false))
            {
                var normalized = _normalizer.Process(frame);
                if (normalized.Length == 0) continue;

                var inputFrames = frame.BytesRecorded /
                    Math.Max(1, frame.Channels * Math.Max(1, frame.BitsPerSample / 8));
                var frameDuration = TimeSpan.FromSeconds(
                    inputFrames / (double)Math.Max(1, frame.SampleRate));
                var frameStart = frame.CapturedAt - frameDuration;

                foreach (var chunk in _chunks.Append(normalized, frameStart))
                {
                    if (!HasSpeechActivity(
                            chunk.Samples.Span,
                            chunk.SampleRate,
                            _silenceThresholdDb,
                            SpeechWindowMilliseconds,
                            MinimumActiveWindows))
                    {
                        Interlocked.Increment(ref _silentChunks);
                        continue;
                    }

                    SpeechRecognitionResult result;
                    try
                    {
                        result = await _engine.TranscribeAsync(chunk with { ServiceId = _serviceId }, _stop.Token).ConfigureAwait(false);
                        Interlocked.Exchange(ref _consecutiveFailures, 0);
                        Volatile.Write(ref _lastError, null);
                        Interlocked.Exchange(
                            ref _lastSuccessUnixMs,
                            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                    }
                    catch (OperationCanceledException) when (_stop.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception error)
                    {
                        Interlocked.Increment(ref _failedChunks);
                        var failures = Interlocked.Increment(ref _consecutiveFailures);
                        Volatile.Write(ref _lastError, ClassifyRecognitionError(error));
                        var backoffMs = Math.Min(10_000, 500 * (1 << Math.Min(4, failures - 1)));
                        await Task.Delay(TimeSpan.FromMilliseconds(backoffMs), _stop.Token)
                            .ConfigureAwait(false);
                        continue;
                    }

                    if (string.IsNullOrWhiteSpace(result.Text)) continue;

                    Interlocked.Increment(ref _recognizedChunks);
                    var segment = new TranscriptSegment(
                        _serviceId,
                        Interlocked.Increment(ref _sequence),
                        chunk.StartedAt,
                        result.Text.Trim(),
                        true,
                        result.SpeakerId,
                        result.Language,
                        result.Confidence,
                        2);

                    var outboundEventId = Guid.NewGuid();
                    if (await TryPublishAsync(outboundEventId, segment).ConfigureAwait(false))
                        Interlocked.Increment(ref _publishedChunks);
                }
            }
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested)
        {
        }
    }

    private async Task<bool> TryPublishAsync(Guid eventId, TranscriptSegment segment)
    {
        Exception? lastError = null;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                await _publish(eventId, segment, _stop.Token).ConfigureAwait(false);
                Interlocked.Exchange(ref _consecutivePublishFailures, 0);
                Volatile.Write(ref _lastPublishError, null);
                return true;
            }
            catch (OperationCanceledException) when (_stop.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception error)
            {
                lastError = error;
                if (attempt < 2)
                {
                    var delay = TimeSpan.FromMilliseconds(100 * (1 << attempt));
                    await Task.Delay(delay, _stop.Token).ConfigureAwait(false);
                }
            }
        }

        Interlocked.Increment(ref _publishFailedChunks);
        Interlocked.Increment(ref _consecutivePublishFailures);
        Volatile.Write(ref _lastPublishError, ClassifyPublishError(lastError));
        return false;
    }

    private static string ClassifyRecognitionError(Exception error) => error switch
    {
        HttpRequestException => "network",
        TaskCanceledException => "timeout",
        InvalidDataException => "invalid_response",
        _ => "recognition_error"
    };

    private static string ClassifyPublishError(Exception? error) => error switch
    {
        IOException => "storage",
        UnauthorizedAccessException => "storage_access",
        _ => "publish_error"
    };

    public static bool HasSpeechActivity(
        ReadOnlySpan<short> samples,
        int sampleRate = 16_000,
        double thresholdDb = DefaultSilenceThresholdDb,
        int windowMilliseconds = SpeechWindowMilliseconds,
        int minimumActiveWindows = MinimumActiveWindows)
    {
        if (samples.IsEmpty || sampleRate <= 0 || windowMilliseconds <= 0 || minimumActiveWindows <= 0)
            return false;
        if (!double.IsFinite(thresholdDb) || thresholdDb is < -120d or > 0d)
            throw new ArgumentOutOfRangeException(nameof(thresholdDb));

        var windowSamples = Math.Max(1, (int)Math.Round(sampleRate * windowMilliseconds / 1000d));
        var activeWindows = 0;
        for (var offset = 0; offset < samples.Length; offset += windowSamples)
        {
            var length = Math.Min(windowSamples, samples.Length - offset);
            if (CalculatePcm16RmsDb(samples.Slice(offset, length)) < thresholdDb) continue;
            activeWindows++;
            if (activeWindows >= minimumActiveWindows) return true;
        }
        return false;
    }

    public static double CalculatePcm16RmsDb(ReadOnlySpan<short> samples)
    {
        if (samples.IsEmpty) return -120d;

        double sumSquares = 0;
        foreach (var value in samples)
        {
            var normalized = value / 32768d;
            sumSquares += normalized * normalized;
        }

        if (sumSquares <= 0) return -120d;
        var rms = Math.Sqrt(sumSquares / samples.Length);
        if (!double.IsFinite(rms) || rms <= 0) return -120d;
        return Math.Clamp(20d * Math.Log10(rms), -120d, 0d);
    }

    public async ValueTask DisposeAsync()
    {
        _frames.Writer.TryComplete();
        _stop.CancelAfter(TimeSpan.FromSeconds(10));
        try { await _worker.ConfigureAwait(false); }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
        _stop.Dispose();
    }
}
