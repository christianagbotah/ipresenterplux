using System.Buffers.Binary;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class StreamingStereoPcm16NormalizerTests
{
    [Fact]
    public void PreservesStereoPcm16At48Khz()
    {
        var normalizer = new StreamingStereoPcm16Normalizer();
        var bytes = new byte[8];
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(0, 2), 1000);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(2, 2), -2000);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(4, 2), 3000);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(6, 2), -4000);

        var output = normalizer.Process(Frame(bytes, 48_000, 2, 16, AudioSampleEncoding.PcmInteger));

        Assert.Equal(new short[] { 1000, -2000, 3000, -4000 }, output);
    }

    [Fact]
    public void DuplicatesMonoToStereo()
    {
        var normalizer = new StreamingStereoPcm16Normalizer();
        var bytes = new byte[4];
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(0, 2), 1200);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(2, 2), -800);

        var output = normalizer.Process(Frame(bytes, 48_000, 1, 16, AudioSampleEncoding.PcmInteger));

        Assert.Equal(new short[] { 1200, 1200, -800, -800 }, output);
    }

    [Fact]
    public void DownmixesUnknownMultichannelCaptureDeterministically()
    {
        var normalizer = new StreamingStereoPcm16Normalizer();
        var bytes = new byte[8];
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(0, 2), 1000);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(2, 2), 3000);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(4, 2), -1000);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(6, 2), 5000);

        var output = normalizer.Process(Frame(bytes, 48_000, 4, 16, AudioSampleEncoding.PcmInteger));

        Assert.Equal(2, output.Length);
        Assert.InRange(output[0], 1999, 2001);
        Assert.Equal(output[0], output[1]);
    }

    [Fact]
    public void ConvertsFloat32AndResamples96KhzTo48Khz()
    {
        var normalizer = new StreamingStereoPcm16Normalizer();
        var values = new[] { 0.25f, -0.25f, 0.5f, -0.5f, 0.75f, -0.75f, 1f, -1f };
        var bytes = new byte[values.Length * 4];
        for (var index = 0; index < values.Length; index++)
            BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(index * 4, 4), BitConverter.SingleToInt32Bits(values[index]));

        var output = normalizer.Process(Frame(bytes, 96_000, 2, 32, AudioSampleEncoding.IeeeFloat));

        Assert.Equal(4, output.Length); // 4 stereo input frames -> 2 stereo output frames.
        Assert.InRange(output[0], 8190, 8193);
        Assert.InRange(output[1], -8193, -8190);
        Assert.InRange(output[2], 24574, 24577);
        Assert.InRange(output[3], -24577, -24574);
    }

    [Fact]
    public void InvalidFrameProducesNoBroadcastSamples()
    {
        var normalizer = new StreamingStereoPcm16Normalizer();
        var invalid = new AudioFrame(
            new byte[2],
            4,
            48_000,
            2,
            16,
            DateTimeOffset.UtcNow,
            AudioSampleEncoding.PcmInteger);

        Assert.Empty(normalizer.Process(invalid));
    }

    [Theory]
    [InlineData(16_000)]
    [InlineData(96_000)]
    public void RejectsUnsupportedBroadcastTargetRates(int rate)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new StreamingStereoPcm16Normalizer(rate));
    }

    private static AudioFrame Frame(
        byte[] bytes,
        int sampleRate,
        int channels,
        int bitsPerSample,
        AudioSampleEncoding encoding) => new(
            bytes,
            bytes.Length,
            sampleRate,
            channels,
            bitsPerSample,
            DateTimeOffset.UtcNow,
            encoding);
}
