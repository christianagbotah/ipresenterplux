using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class VisualProgramRouter : IVisualProgramRouter
{
    private readonly IVisualSourceCatalog _catalog;
    private readonly IVisualCaptureFactory _captureFactory;
    private readonly IProgramVideoSource _renderedProgram;
    private readonly SemaphoreSlim _mutationGate = new(1, 1);
    private IVisualCaptureSession? _previewSession;
    private IVisualCaptureSession? _programSession;
    private bool _previewSharesProgram;
    private VisualRouteSnapshot _snapshot = new(null, null, true);
    private bool _disposed;

    public VisualProgramRouter(
        IVisualSourceCatalog catalog,
        IVisualCaptureFactory captureFactory,
        IProgramVideoSource renderedProgram)
    {
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
        _captureFactory = captureFactory ?? throw new ArgumentNullException(nameof(captureFactory));
        _renderedProgram = renderedProgram ?? throw new ArgumentNullException(nameof(renderedProgram));
    }

    public VisualRouteSnapshot Snapshot => Volatile.Read(ref _snapshot);

    public ProgramVideoFrame GetCurrentFrame()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var program = Volatile.Read(ref _programSession);
        if (!Snapshot.UsingRenderedProgram && program?.LatestFrame is { } frame)
            return frame;
        return _renderedProgram.GetCurrentFrame();
    }

    public async Task SelectPreviewAsync(string sourceId, CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (string.IsNullOrWhiteSpace(sourceId)) throw new ArgumentException("Source ID is required.", nameof(sourceId));

        await _mutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_programSession is { } program && string.Equals(program.Source.SourceId, sourceId, StringComparison.Ordinal))
            {
                await ReleasePreviewOnlyAsync(cancellationToken).ConfigureAwait(false);
                _previewSession = program;
                _previewSharesProgram = true;
                _snapshot = _snapshot with { Preview = Slot(program.Source, program.Status, confirmed: true) };
                return;
            }

            if (_previewSession is { } currentPreview &&
                string.Equals(currentPreview.Source.SourceId, sourceId, StringComparison.Ordinal))
                return;

            await ReleasePreviewOnlyAsync(cancellationToken).ConfigureAwait(false);

            var sources = await _catalog.ScanAsync(cancellationToken).ConfigureAwait(false);
            var source = sources.FirstOrDefault(item => string.Equals(item.SourceId, sourceId, StringComparison.Ordinal))
                ?? throw new InvalidOperationException("visual_source_not_found");

            var mode = source.Modes.FirstOrDefault();
            var options = mode is null
                ? new VisualCaptureOptions(1920, 1080, 30)
                : new VisualCaptureOptions(mode.Width, mode.Height, mode.FramesPerSecond, mode.PixelFormat);
            var session = await _captureFactory.CreateAsync(source, options, cancellationToken).ConfigureAwait(false);
            try
            {
                var status = await session.StartAsync(cancellationToken).ConfigureAwait(false);
                if (!status.IsRunning || status.Availability != VisualSourceAvailability.Available)
                    throw new InvalidOperationException(status.ErrorCode ?? "visual_preview_unavailable");

                _previewSession = session;
                _previewSharesProgram = false;
                _snapshot = _snapshot with { Preview = Slot(source, status, confirmed: true) };
            }
            catch
            {
                await ReleaseSessionAsync(session, CancellationToken.None).ConfigureAwait(false);
                throw;
            }
        }
        finally
        {
            _mutationGate.Release();
        }
    }

    public async Task ClearPreviewAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _mutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await ReleasePreviewOnlyAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _mutationGate.Release();
        }
    }

    public async Task TakePreviewAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _mutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_previewSession is null || _snapshot.Preview is not { Confirmed: true }) return;

            if (_previewSharesProgram)
            {
                _previewSession = null;
                _previewSharesProgram = false;
                _snapshot = _snapshot with { Preview = null };
                return;
            }

            var nextProgram = _previewSession;
            var nextSlot = _snapshot.Preview;
            var previousProgram = _programSession;

            _programSession = nextProgram;
            _previewSession = null;
            _previewSharesProgram = false;
            _snapshot = new VisualRouteSnapshot(null, nextSlot, false);

            if (previousProgram is not null && !ReferenceEquals(previousProgram, nextProgram))
                await ReleaseSessionAsync(previousProgram, CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            _mutationGate.Release();
        }
    }

    public async Task UseRenderedProgramAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _mutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var previousProgram = _programSession;
            _programSession = null;
            _snapshot = _snapshot with { Program = null, UsingRenderedProgram = true };
            if (_previewSharesProgram)
            {
                _previewSession = null;
                _previewSharesProgram = false;
                _snapshot = _snapshot with { Preview = null };
            }
            if (previousProgram is not null)
                await ReleaseSessionAsync(previousProgram, CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            _mutationGate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        await _mutationGate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed) return;
            var preview = _previewSession;
            var program = _programSession;
            _previewSession = null;
            _programSession = null;
            _previewSharesProgram = false;
            _snapshot = new VisualRouteSnapshot(null, null, true);
            if (preview is not null && !ReferenceEquals(preview, program))
                await ReleaseSessionAsync(preview, CancellationToken.None).ConfigureAwait(false);
            if (program is not null)
                await ReleaseSessionAsync(program, CancellationToken.None).ConfigureAwait(false);
            _disposed = true;
        }
        finally
        {
            _mutationGate.Release();
            _mutationGate.Dispose();
        }
    }

    private async Task ReleasePreviewOnlyAsync(CancellationToken cancellationToken)
    {
        var preview = _previewSession;
        var shared = _previewSharesProgram;
        _previewSession = null;
        _previewSharesProgram = false;
        _snapshot = _snapshot with { Preview = null };
        if (preview is not null && !shared && !ReferenceEquals(preview, _programSession))
            await ReleaseSessionAsync(preview, cancellationToken).ConfigureAwait(false);
    }

    private static VisualRouteSlot Slot(
        VisualSourceDescriptor source,
        VisualCaptureStatus status,
        bool confirmed) =>
        new(source.SourceId, source.Kind, status.Availability, confirmed, status.ErrorCode);

    private static async Task ReleaseSessionAsync(IVisualCaptureSession session, CancellationToken cancellationToken)
    {
        try
        {
            if (session.Status.IsRunning)
                await session.StopAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            await session.DisposeAsync().ConfigureAwait(false);
        }
    }
}
