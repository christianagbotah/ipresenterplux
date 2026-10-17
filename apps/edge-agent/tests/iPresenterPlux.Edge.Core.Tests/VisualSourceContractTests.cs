using iPresenterPlux.Edge.Core.Models;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class VisualSourceContractTests
{
    [Fact]
    public void DescriptorRejectsBlankIdentityFields()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.ThrowsAny<ArgumentException>(() => new VisualSourceDescriptor("", VisualSourceKind.Camera, "Camera", "native", VisualSourceAvailability.Available, [], now, null, EmptyMetadata()));
        Assert.ThrowsAny<ArgumentException>(() => new VisualSourceDescriptor("visual:camera:abc", VisualSourceKind.Camera, " ", "native", VisualSourceAvailability.Available, [], now, null, EmptyMetadata()));
        Assert.ThrowsAny<ArgumentException>(() => new VisualSourceDescriptor("visual:camera:abc", VisualSourceKind.Camera, "Camera", " ", VisualSourceAvailability.Available, [], now, null, EmptyMetadata()));
    }

    [Theory]
    [InlineData(0, 1080, 30)]
    [InlineData(1920, 0, 30)]
    [InlineData(1920, 1080, 0)]
    [InlineData(-1, 1080, 30)]
    public void CaptureModeRejectsInvalidDimensionsOrFps(int width, int height, int fps)
    {
        Assert.ThrowsAny<ArgumentOutOfRangeException>(() => new VisualCaptureMode(width, height, fps, "bgra32"));
        Assert.ThrowsAny<ArgumentOutOfRangeException>(() => new VisualCaptureOptions(width, height, fps));
    }

    [Fact]
    public void CaptureModeRejectsBlankPixelFormat()
    {
        Assert.ThrowsAny<ArgumentException>(() => new VisualCaptureMode(1920, 1080, 30, " "));
        Assert.ThrowsAny<ArgumentException>(() => new VisualCaptureOptions(1920, 1080, 30, " "));
    }

    private static IReadOnlyDictionary<string, string> EmptyMetadata() => new Dictionary<string, string>();
}
