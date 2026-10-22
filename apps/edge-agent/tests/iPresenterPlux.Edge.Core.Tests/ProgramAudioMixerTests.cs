using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class ProgramAudioMixerTests
{
    [Fact]
    public void MediaOnlyProducesBroadcastStereoPcm16()
    {
        var mixer = new ProgramAudioMixer();
        var media = Frame(new short[] { 1000, -1000, 2000, -2000 });

        var mixed = mixer.Mix(null, media, 1f);

        Assert.Equal(48_000, mixed.SampleRate);
        Assert.Equal(2, mixed.Channels);
        Assert.Equal(16, mixed.BitsPerSample);
        Assert.Equal(AudioSampleEncoding.PcmInteger, mixed.Encoding);
        Assert.Equal(new short[] { 1000, -1000, 2000, -2000 }, Samples(mixed));
    }

    [Fact]
    public void LiveMonoPassesThroughAsStereoWhenMediaIsAbsent()
    {
        var mixer = new ProgramAudioMixer();
        var live = Frame(new short[] { 1200, -800 }, channels: 1);

        var mixed = mixer.Mix(live, null, 1f);

        Assert.Equal(new short[] { 1200, 1200, -800, -800 }, Samples(mixed));
    }

    [Theory]
    [InlineData(0f, 0)]
    [InlineData(.5f, 1000)]
    [InlineData(1f, 2000)]
    public void MediaVolumeScalesBeforeMix(float volume, int expected)
    {
        var mixer = new ProgramAudioMixer();
        var media = Frame(new short[] { 2000, 2000 });

        var mixed = mixer.Mix(null, media, volume);

        var samples = Samples(mixed);
        Assert.Equal((short)expected, samples[0]);
        Assert.Equal((short)expected, samples[1]);
    }

    [Fact]
    public void PositiveAndNegativeSumsSaturateInsteadOfWrapping()
    {
        var mixer = new ProgramAudioMixer();
        var live = Frame(new short[] { 30_000, -30_000 });
        var media = Frame(new short[] { 10_000, -10_000 });

        var mixed = mixer.Mix(live, media, 1f);

        Assert.Equal(new short[] { short.MaxValue, short.MinValue }, Samples(mixed));
    }

    [Fact]
    public void DifferentInputSampleRatesAreNormalizedToBroadcastFormat()
    {
        var mixer = new ProgramAudioMixer();
        var live = Frame(new short[] { 1000, -1000, 500, -500 }, sampleRate: 44_100, channels: 1);

        var mixed = mixer.Mix(live, null, 1f);

        Assert.Equal(48_000, mixed.SampleRate);
        Assert.Equal(2, mixed.Channels);
        Assert.Equal(16, mixed.BitsPerSample);
        Assert.True(mixed.BytesRecorded > 0);
        Assert.Equal(0, mixed.BytesRecorded % 4);
    }

    [Fact]
    public void InvalidFrameIsRejectedInsteadOfEnteringContributionMix()
    {
        var mixer = new ProgramAudioMixer();
        var invalid = new AudioFrame(new byte[4], 5, 48_000, 2, 16, DateTimeOffset.UtcNow);

        Assert.Throws<ArgumentException>(() => mixer.Mix(invalid, null, 1f));
        Assert.Throws<ArgumentOutOfRangeException>(() => mixer.Mix(null, Frame(new short[] { 1, 1 }), 1.1f));
    }

    private static AudioFrame Frame(short[] samples, int sampleRate = 48_000, int channels = 2)
    {
        var bytes = new byte[samples.Length * sizeof(short)];
        Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
        return new AudioFrame(bytes, bytes.Length, sampleRate, channels, 16, DateTimeOffset.Parse("2026-10-22T16:00:00Z"));
    }

    private static short[] Samples(AudioFrame frame)
    {
        var result = new short[frame.BytesRecorded / sizeof(short)];
        Buffer.BlockCopy(frame.Buffer[..frame.BytesRecorded].ToArray(), 0, result, 0, frame.BytesRecorded);
        return result;
    }
}
