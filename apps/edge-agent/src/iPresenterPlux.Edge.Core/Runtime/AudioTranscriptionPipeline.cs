using System.Threading.Channels;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class AudioTranscriptionPipeline : IAsyncDisposable
{
    private readonly ISpeechRecognitionEngine _engine;
    private readonly Func<TranscriptSegment, CancellationToken, Task> _publish;
    private readonly StreamingPcm16Normalizer _normalizer = new();
    private readonly SpeechChunkAccumulator _chunks = new();
    private readonly Channel<AudioFrame> _frames;
    private readonly CancellationTokenSource _stop = new();
    private readonly Task _worker;
    private long _sequence;
    private long _droppedFrames;

    public AudioTranscriptionPipeline(
        ISpeechRecognitionEngine engine,
        Func<TranscriptSegment, CancellationToken, Task> publish,
        int frameCapacity = 256)
    {
        _engine = engine ?? throw new ArgumentNullException(nameof(engine));
        _publish = publish ?? throw new ArgumentNullException(nameof(publish));
        if (frameCapacity <= 0) throw new ArgumentOutOfRangeException(nameof(frameCapacity));
        _frames = Channel.CreateBounded<AudioFrame>(new BoundedChannelOptions(frameCapacity)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.Wait
        });
        _worker = Task.Run(ProcessAsync);
    }

    public long DroppedFrames => Interlocked.Read(ref _droppedFrames);

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
                var inputFrames = frame.BytesRecorded / Math.Max(1, frame.Channels * Math.Max(1, frame.BitsPerSample / 8));
                var frameDuration = TimeSpan.FromSeconds(inputFrames / (double)Math.Max(1, frame.SampleRate));
                var frameStart = frame.CapturedAt - frameDuration;
                foreach (var chunk in _chunks.Append(normalized, frameStart))
                {
                    var result = await _engine.TranscribeAsync(chunk, _stop.Token).ConfigureAwait(false);
                    if (string.IsNullOrWhiteSpace(result.Text)) continue;
                    var segment = new TranscriptSegment(
                        null,
                        Interlocked.Increment(ref _sequence),
                        chunk.StartedAt,
                        result.Text.Trim(),
                        true,
                        result.SpeakerId,
                        result.Language);
                    await _publish(segment, _stop.Token).ConfigureAwait(false);
                }
            }
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested)
        {
        }
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
