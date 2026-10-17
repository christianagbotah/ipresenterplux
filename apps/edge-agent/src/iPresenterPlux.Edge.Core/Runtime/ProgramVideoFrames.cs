using System.Collections.Concurrent;
using iPresenterPlux.Edge.Core.Abstractions;

namespace iPresenterPlux.Edge.Core.Runtime;

public static class ProgramVideoFrames
{
    private static readonly ConcurrentDictionary<(int Width, int Height), ProgramVideoFrame> BlackFrames = new();

    public static ProgramVideoFrame Black(int width, int height)
    {
        if (width <= 0) throw new ArgumentOutOfRangeException(nameof(width));
        if (height <= 0) throw new ArgumentOutOfRangeException(nameof(height));
        return BlackFrames.GetOrAdd((width, height), static dimensions =>
        {
            var stride = checked(dimensions.Width * 4);
            return new ProgramVideoFrame(
                dimensions.Width,
                dimensions.Height,
                stride,
                "bgra32",
                new byte[checked(stride * dimensions.Height)],
                null,
                DateTimeOffset.UnixEpoch);
        });
    }
}
