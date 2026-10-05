using System.Buffers.Binary;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class SpeechAudioPipelineTests
{
    [Fact]
    public void NormalizerDownmixesAndResamplesStereoPcm16()
    {
        var samples = 4_800;
        var bytes = new byte[samples * 2 * 2];
        for (var i = 0; i < samples; i++)
        {
            BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(i * 4, 2), 16_384);
            BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(i * 4 + 2, 2), 16_384);
        }
        var frame = new AudioFrame(bytes, bytes.Length, 48_000, 2, 16, DateTimeOffset.UtcNow);
        var normalizer = new StreamingPcm16Normalizer();
        var output = normalizer.Process(frame);
        Assert.InRange(output.Length, 1_599, 1_601);
        Assert.All(output, sample => Assert.InRange(sample, 16_380, 16_388));
    }

    [Fact]
    public void SpeechGateTreatsDigitalSilenceAsMinus120Db()
    {
        Assert.Equal(-120d, AudioTranscriptionPipeline.CalculatePcm16RmsDb(new short[16_000]));
    }

    [Fact]
    public void SpeechGateMeasuresHalfScaleSignalAboveDefaultSilenceFloor()
    {
        var samples = Enumerable.Repeat((short)16_384, 16_000).ToArray();
        var level = AudioTranscriptionPipeline.CalculatePcm16RmsDb(samples);
        Assert.InRange(level, -6.1, -5.9);
        Assert.True(level > -50d);
    }

    [Fact]
    public void SpeechGateKeepsShortAudiblePhraseInsideMostlySilentChunk()
    {
        var samples = new short[80_000];
        var amplitude = (short)Math.Round(32768d * Math.Pow(10d, -45d / 20d));
        Array.Fill(samples, amplitude, 0, 8_000);

        Assert.True(AudioTranscriptionPipeline.CalculatePcm16RmsDb(samples) < -50d);
        Assert.True(AudioTranscriptionPipeline.HasSpeechActivity(samples));
    }

    [Fact]
    public void SpeechGateRejectsSingleShortEnergyBurst()
    {
        var samples = new short[80_000];
        Array.Fill(samples, (short)8_192, 0, 3_200);

        Assert.False(AudioTranscriptionPipeline.HasSpeechActivity(samples));
    }

    [Fact]
    public void ChunkAccumulatorResetsTimelineAfterCaptureGap()
    {
        var accumulator = new SpeechChunkAccumulator();
        var start = DateTimeOffset.Parse("2026-10-04T12:00:00Z");
        Assert.Empty(accumulator.Append(new short[40_000], start));

        var resumedAt = start.AddSeconds(10);
        var chunks = accumulator.Append(new short[80_000], resumedAt);

        Assert.Single(chunks);
        Assert.Equal(resumedAt, chunks[0].StartedAt);
    }

    [Fact]
    public async Task PublishRetryReusesStableEventId()
    {
        var seenIds = new List<Guid>();
        var delivered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var attempts = 0;
        await using var pipeline = new AudioTranscriptionPipeline(
            new FixedSpeechEngine(),
            (eventId, _, _) =>
            {
                lock (seenIds) seenIds.Add(eventId);
                if (Interlocked.Increment(ref attempts) == 1)
                    throw new IOException("simulated local queue failure");
                delivered.TrySetResult();
                return Task.CompletedTask;
            },
            serviceId: Guid.Parse("00000000-0000-4000-8000-000000000003"));

        var samples = Enumerable.Repeat((short)16_384, 80_000).ToArray();
        var bytes = new byte[samples.Length * 2];
        Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
        Assert.True(pipeline.TrySubmit(new AudioFrame(
            bytes, bytes.Length, 16_000, 1, 16, DateTimeOffset.UtcNow.AddSeconds(5))));

        await delivered.Task.WaitAsync(TimeSpan.FromSeconds(3));
        Guid[] ids;
        lock (seenIds) ids = seenIds.ToArray();
        Assert.Equal(2, ids.Length);
        Assert.NotEqual(Guid.Empty, ids[0]);
        Assert.Equal(ids[0], ids[1]);
    }

    [Fact]
    public async Task ServiceScopeFlowsThroughRecognitionAndPublishedTranscript()
    {
        var serviceId = Guid.Parse("00000000-0000-4000-8000-000000000003");
        var engine = new ScopeCapturingSpeechEngine();
        var published = new TaskCompletionSource<TranscriptSegment>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var pipeline = new AudioTranscriptionPipeline(
            engine,
            (_, segment, _) =>
            {
                published.TrySetResult(segment);
                return Task.CompletedTask;
            },
            serviceId: serviceId);

        var samples = Enumerable.Repeat((short)16_384, 80_000).ToArray();
        var bytes = new byte[samples.Length * 2];
        Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
        Assert.True(pipeline.TrySubmit(new AudioFrame(
            bytes, bytes.Length, 16_000, 1, 16, DateTimeOffset.UtcNow.AddSeconds(5))));

        var seenByEngine = await engine.SeenServiceId.Task.WaitAsync(TimeSpan.FromSeconds(3));
        var segment = await published.Task.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.Equal(serviceId, seenByEngine);
        Assert.Equal(serviceId, segment.ServiceId);
    }

    [Fact]
    public void ChunkAccumulatorEmitsFiveSecondChunksWithContinuousTimestamps()
    {
        var accumulator = new SpeechChunkAccumulator();
        var start = DateTimeOffset.Parse("2026-10-04T12:00:00Z");
        var first = accumulator.Append(new short[40_000], start);
        Assert.Empty(first);
        var second = accumulator.Append(new short[120_000], start.AddSeconds(2.5));
        Assert.Equal(2, second.Count);
        Assert.Equal(start, second[0].StartedAt);
        Assert.Equal(start.AddSeconds(5), second[1].StartedAt);
        Assert.All(second, chunk => Assert.Equal(80_000, chunk.Samples.Length));
    }

    private sealed class ScopeCapturingSpeechEngine : ISpeechRecognitionEngine
    {
        public TaskCompletionSource<Guid?> SeenServiceId { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task<SpeechRecognitionResult> TranscribeAsync(
            SpeechAudioChunk chunk,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            SeenServiceId.TrySetResult(chunk.ServiceId);
            return Task.FromResult(new SpeechRecognitionResult("Welcome church", "en", "speaker-001", 0.9));
        }
    }

    private sealed class FixedSpeechEngine : ISpeechRecognitionEngine
    {
        public Task<SpeechRecognitionResult> TranscribeAsync(
            SpeechAudioChunk chunk,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(new SpeechRecognitionResult("John 3:16", "en", Confidence: 0.99));
        }
    }
}
