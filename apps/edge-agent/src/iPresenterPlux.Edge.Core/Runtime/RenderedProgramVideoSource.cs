using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class RenderedProgramVideoSource : IProgramVideoSource
{
    private readonly LocalWebProgramOutputService _programOutput;
    private readonly IProgramFrameRenderer _renderer;
    private readonly int _width;
    private readonly int _height;
    private readonly object _gate = new();
    private PresentationRenderItem? _cachedItem;
    private ProgramVideoFrame? _cachedFrame;

    public RenderedProgramVideoSource(
        LocalWebProgramOutputService programOutput,
        IProgramFrameRenderer renderer,
        int width = 1920,
        int height = 1080)
    {
        _programOutput = programOutput ?? throw new ArgumentNullException(nameof(programOutput));
        _renderer = renderer ?? throw new ArgumentNullException(nameof(renderer));
        if (width < 320 || width > 7680) throw new ArgumentOutOfRangeException(nameof(width));
        if (height < 180 || height > 4320) throw new ArgumentOutOfRangeException(nameof(height));
        _width = width;
        _height = height;
    }

    public ProgramVideoFrame GetCurrentFrame()
    {
        var item = _programOutput.Snapshot.Program;
        lock (_gate)
        {
            if (_cachedFrame is null || !Equals(_cachedItem, item))
            {
                _cachedItem = item;
                _cachedFrame = _renderer.Render(item, _width, _height);
            }
            return _cachedFrame;
        }
    }
}
