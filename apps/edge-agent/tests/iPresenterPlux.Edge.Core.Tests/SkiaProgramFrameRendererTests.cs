using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class SkiaProgramFrameRendererTests
{
    [Fact]
    public void RendersScriptureIntoBoundedBgraFrame()
    {
        var renderer = new SkiaProgramFrameRenderer();
        var serviceId = Guid.NewGuid();
        var item = new PresentationRenderItem(
            Guid.NewGuid().ToString("D"),
            serviceId,
            "scripture",
            "John 3:16",
            "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.",
            "WEBP",
            new Dictionary<string, string>());
        var renderedAt = DateTimeOffset.Parse("2026-10-06T02:30:00Z");

        var frame = renderer.Render(item, 640, 360, renderedAt);

        Assert.Equal(640, frame.Width);
        Assert.Equal(360, frame.Height);
        Assert.Equal("bgra32", frame.PixelFormat);
        Assert.True(frame.Stride >= frame.Width * 4);
        Assert.Equal(frame.Stride * frame.Height, frame.Buffer.Length);
        Assert.Equal(item.ItemId, frame.ItemId);
        Assert.Equal(renderedAt, frame.RenderedAt);
        Assert.True(ContainsPixelVariation(frame.Buffer.Span), "Expected text/gradient rendering to produce more than one pixel value.");
    }

    [Fact]
    public void RendersEmptyProgramAsValidBackgroundFrame()
    {
        var renderer = new SkiaProgramFrameRenderer();

        var frame = renderer.Render(null, 320, 180);

        Assert.Equal(320, frame.Width);
        Assert.Equal(180, frame.Height);
        Assert.Null(frame.ItemId);
        Assert.Equal(frame.Stride * frame.Height, frame.Buffer.Length);
        Assert.True(ContainsPixelVariation(frame.Buffer.Span));
    }

    [Theory]
    [InlineData(319, 1080)]
    [InlineData(1920, 179)]
    [InlineData(7681, 1080)]
    [InlineData(1920, 4321)]
    public void RejectsUnsafeFrameDimensions(int width, int height)
    {
        var renderer = new SkiaProgramFrameRenderer();
        Assert.Throws<ArgumentOutOfRangeException>(() => renderer.Render(null, width, height));
    }

    private static bool ContainsPixelVariation(ReadOnlySpan<byte> buffer)
    {
        if (buffer.Length < 8) return false;
        var firstB = buffer[0];
        var firstG = buffer[1];
        var firstR = buffer[2];
        var firstA = buffer[3];
        for (var offset = 4; offset <= buffer.Length - 4; offset += 4)
        {
            if (buffer[offset] != firstB ||
                buffer[offset + 1] != firstG ||
                buffer[offset + 2] != firstR ||
                buffer[offset + 3] != firstA)
                return true;
        }
        return false;
    }
}
