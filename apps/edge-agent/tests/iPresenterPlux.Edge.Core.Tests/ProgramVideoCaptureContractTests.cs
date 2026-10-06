using iPresenterPlux.Edge.Core.Abstractions;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class ProgramVideoCaptureContractTests
{
    [Fact]
    public void DefaultCaptureOptionsAreProductionSafe()
    {
        var options = new ProgramVideoCaptureOptions().Validate();

        Assert.Equal(1920, options.Width);
        Assert.Equal(1080, options.Height);
        Assert.Equal(30, options.FramesPerSecond);
        Assert.Equal(6_000_000, options.BitrateBps);
    }

    [Theory]
    [InlineData(319, 1080, 30, 6_000_000)]
    [InlineData(7681, 1080, 30, 6_000_000)]
    [InlineData(1920, 179, 30, 6_000_000)]
    [InlineData(1920, 4321, 30, 6_000_000)]
    [InlineData(1920, 1080, 0, 6_000_000)]
    [InlineData(1920, 1080, 121, 6_000_000)]
    [InlineData(1920, 1080, 30, 249_999)]
    [InlineData(1920, 1080, 30, 100_000_001)]
    public void RejectsUnsafeCaptureOptions(int width, int height, int fps, int bitrate)
    {
        Assert.ThrowsAny<ArgumentOutOfRangeException>(() =>
            new ProgramVideoCaptureOptions(width, height, fps, bitrate).Validate());
    }

    [Fact]
    public void CaptureTargetRequiresPositiveProcessAndTitle()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            new ProgramVideoCaptureTarget(0, "iPresenterPlux program").Validate());
        Assert.Throws<ArgumentException>(() =>
            new ProgramVideoCaptureTarget(1234, "   ").Validate());

        var valid = new ProgramVideoCaptureTarget(1234, "iPresenterPlux program").Validate();
        Assert.Equal(1234, valid.ProcessId);
    }
}
