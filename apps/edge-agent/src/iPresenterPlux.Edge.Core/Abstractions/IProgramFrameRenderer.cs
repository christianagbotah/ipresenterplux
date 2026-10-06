using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed record ProgramVideoFrame(
    int Width,
    int Height,
    int Stride,
    string PixelFormat,
    ReadOnlyMemory<byte> Buffer,
    string? ItemId,
    DateTimeOffset RenderedAt);

public interface IProgramFrameRenderer
{
    ProgramVideoFrame Render(
        PresentationRenderItem? item,
        int width = 1920,
        int height = 1080,
        DateTimeOffset? renderedAt = null);
}
