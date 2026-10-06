using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class RenderedProgramVideoSourceTests
{
    [Fact]
    public async Task RendersOnlyWhenProgramItemChanges()
    {
        await using var output = new LocalWebProgramOutputService();
        var renderer = new CountingRenderer();
        var source = new RenderedProgramVideoSource(output, renderer, 320, 180);

        var empty1 = source.GetCurrentFrame();
        var empty2 = source.GetCurrentFrame();
        Assert.Same(empty1, empty2);
        Assert.Equal(1, renderer.RenderCount);

        var item = new PresentationRenderItem(
            Guid.NewGuid().ToString("D"),
            Guid.NewGuid(),
            "scripture",
            "Psalm 23:1",
            "The Lord is my shepherd; I shall lack nothing.",
            "WEBP",
            new Dictionary<string, string>());
        await output.SetPreviewAsync(item, CancellationToken.None);
        await output.TakePreviewToProgramAsync(CancellationToken.None);

        var live1 = source.GetCurrentFrame();
        var live2 = source.GetCurrentFrame();
        Assert.Same(live1, live2);
        Assert.Equal(item.ItemId, live1.ItemId);
        Assert.Equal(2, renderer.RenderCount);

        await output.ClearProgramAsync(CancellationToken.None);
        var cleared = source.GetCurrentFrame();
        Assert.Null(cleared.ItemId);
        Assert.Equal(3, renderer.RenderCount);
    }

    private sealed class CountingRenderer : IProgramFrameRenderer
    {
        public int RenderCount { get; private set; }

        public ProgramVideoFrame Render(
            PresentationRenderItem? item,
            int width = 1920,
            int height = 1080,
            DateTimeOffset? renderedAt = null)
        {
            RenderCount++;
            return new ProgramVideoFrame(
                width,
                height,
                width * 4,
                "bgra32",
                new byte[width * height * 4],
                item?.ItemId,
                renderedAt ?? DateTimeOffset.UtcNow);
        }
    }
}
