using System.Buffers.Binary;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class AudioLevelMeterTests
{
    [Fact]
    public void SilenceFloorsAtMinus120Db()
    {
        var frame = new AudioFrame(new byte[320], 320, 16_000, 1, 16, DateTimeOffset.UtcNow);
        Assert.Equal(-120d, AudioLevelMeter.CalculateRmsDb(frame));
    }

    [Fact]
    public void FullScalePcm16SineIsAboutMinus3Db()
    {
        var samples = 4_800;
        var bytes = new byte[samples * 2];
        for (var i = 0; i < samples; i++)
        {
            var value = (short)Math.Round(Math.Sin(2 * Math.PI * 440 * i / 48_000d) * short.MaxValue);
            BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(i * 2, 2), value);
        }
        var frame = new AudioFrame(bytes, bytes.Length, 48_000, 1, 16, DateTimeOffset.UtcNow);
        Assert.InRange(AudioLevelMeter.CalculateRmsDb(frame), -3.2, -2.8);
    }

    [Fact]
    public void Float32HalfScaleSineIsAboutMinus9Db()
    {
        var samples = 4_800;
        var bytes = new byte[samples * 4];
        for (var i = 0; i < samples; i++)
        {
            var sample = (float)(Math.Sin(2 * Math.PI * 440 * i / 48_000d) * 0.5);
            BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(i * 4, 4), BitConverter.SingleToInt32Bits(sample));
        }
        var frame = new AudioFrame(bytes, bytes.Length, 48_000, 1, 32, DateTimeOffset.UtcNow, AudioSampleEncoding.IeeeFloat);
        Assert.InRange(AudioLevelMeter.CalculateRmsDb(frame), -9.2, -8.8);
    }

    [Fact]
    public void Pcm24SignExtensionHandlesNegativeSamples()
    {
        var bytes = new byte[] { 0x00, 0x00, 0x40, 0x00, 0x00, 0xC0 };
        var frame = new AudioFrame(bytes, bytes.Length, 48_000, 1, 24, DateTimeOffset.UtcNow);
        Assert.InRange(AudioLevelMeter.CalculateRmsDb(frame), -6.1, -5.9);
    }
}
