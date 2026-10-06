using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class StereoPcm16FrameAccumulatorTests
{
    [Fact]
    public void CarriesPartialStereoFramesAcrossCaptureCallbacks()
    {
        var accumulator = new StereoPcm16FrameAccumulator(sampleFramesPerPacket: 4);

        Assert.Empty(accumulator.Append(new short[] { 1, 2, 3, 4, 5, 6 }));
        Assert.Equal(3, accumulator.BufferedSampleFrames);

        var packets = accumulator.Append(new short[] { 7, 8, 9, 10 });

        var packet = Assert.Single(packets);
        Assert.Equal(new short[] { 1, 2, 3, 4, 5, 6, 7, 8 }, packet);
        Assert.Equal(1, accumulator.BufferedSampleFrames);
    }

    [Fact]
    public void EmitsMultiplePacketsFromOneLargeCaptureCallback()
    {
        var accumulator = new StereoPcm16FrameAccumulator(sampleFramesPerPacket: 2);

        var packets = accumulator.Append(new short[]
        {
            1, 2, 3, 4,
            5, 6, 7, 8,
            9, 10
        });

        Assert.Equal(2, packets.Count);
        Assert.Equal(new short[] { 1, 2, 3, 4 }, packets[0]);
        Assert.Equal(new short[] { 5, 6, 7, 8 }, packets[1]);
        Assert.Equal(1, accumulator.BufferedSampleFrames);
    }

    [Fact]
    public void ResetDropsStalePartialAudio()
    {
        var accumulator = new StereoPcm16FrameAccumulator(sampleFramesPerPacket: 2);
        Assert.Empty(accumulator.Append(new short[] { 1, 2 }));

        accumulator.Reset();
        var packets = accumulator.Append(new short[] { 3, 4, 5, 6 });

        Assert.Equal(new short[] { 3, 4, 5, 6 }, Assert.Single(packets));
        Assert.Equal(0, accumulator.BufferedSampleFrames);
    }

    [Fact]
    public void RejectsIncompleteStereoPair()
    {
        var accumulator = new StereoPcm16FrameAccumulator();
        Assert.Throws<ArgumentException>(() => accumulator.Append(new short[] { 1, 2, 3 }));
    }
}
