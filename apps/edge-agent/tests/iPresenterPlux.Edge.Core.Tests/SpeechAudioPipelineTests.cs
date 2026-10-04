using System.Buffers.Binary;
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
}
