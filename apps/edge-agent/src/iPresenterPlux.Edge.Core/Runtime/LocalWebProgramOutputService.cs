using System.Net;
using System.Text;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed record LocalProgramSnapshot(
    bool OutputRunning,
    PresentationRenderItem? Preview,
    PresentationRenderItem? Program);

public sealed class LocalWebProgramOutputService : IMediaOutputService, IServiceScopedMediaOutput, IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static readonly HashSet<string> BrowserPlaybackErrorCodes = new(StringComparer.Ordinal)
    {
        "media_browser_playback_blocked",
        "media_browser_decode_failed",
        "media_browser_asset_unavailable"
    };
    private readonly object _gate = new();
    private readonly HttpListener _listener = new();
    private readonly int _port;
    private readonly FileProgramStateStore? _stateStore;
    private readonly PresentationThemeAssetCache _themeAssetCache;
    private readonly IMediaAssetCache? _mediaAssetCache;
    private readonly IMediaPreparationCoordinator? _mediaPreparation;
    private readonly MediaPlaybackCoordinator? _mediaPlayback;
    private readonly SemaphoreSlim _persistenceGate = new(1, 1);
    private readonly SemaphoreSlim _programMutationGate = new(1, 1);
    private CancellationTokenSource? _serverCts;
    private Task? _serverTask;
    private PresentationRenderItem? _preview;
    private PresentationRenderItem? _program;
    private IDisposable? _previewMediaLease;
    private IDisposable? _programMediaLease;
    private MediaPlaybackSnapshot? _pendingPlaybackRecovery;
    private bool _running;
    private bool _persistenceHealthy = true;
    private bool _disposed;

    public LocalWebProgramOutputService(
        int port = 49321,
        FileProgramStateStore? stateStore = null,
        PresentationThemeAssetCache? themeAssetCache = null,
        IMediaAssetCache? mediaAssetCache = null,
        IMediaPreparationCoordinator? mediaPreparation = null,
        MediaPlaybackCoordinator? mediaPlayback = null)
    {
        if (port is < 1024 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        _port = port;
        _stateStore = stateStore;
        _themeAssetCache = themeAssetCache ?? new PresentationThemeAssetCache();
        _mediaAssetCache = mediaAssetCache;
        _mediaPreparation = mediaPreparation;
        _mediaPlayback = mediaPlayback;
    }

    public Uri ProgramUri => new($"http://127.0.0.1:{_port}/program");
    public Uri PreviewUri => new($"http://127.0.0.1:{_port}/preview");

    public LocalProgramSnapshot Snapshot
    {
        get { lock (_gate) return new LocalProgramSnapshot(_running, _preview, _program); }
    }

    public Guid? LastKnownServiceId
    {
        get { lock (_gate) return _program?.ServiceId ?? _preview?.ServiceId; }
    }

    public bool PersistenceHealthy
    {
        get { lock (_gate) return _persistenceHealthy; }
    }

    public MediaPlaybackSnapshot? PlaybackSnapshot => _mediaPlayback?.Snapshot;

    public async Task RestoreAsync(CancellationToken cancellationToken)
    {
        if (_stateStore is null) return;
        try
        {
            var state = await _stateStore.ReadAsync(cancellationToken).ConfigureAwait(false);
            if (state is null) return;
            lock (_gate)
            {
                _preview = state.Preview;
                _program = state.Program;
                _pendingPlaybackRecovery = state.MediaPlayback;
                _persistenceHealthy = true;
            }
            if (_mediaPlayback is not null && state.MediaPlayback is not null)
            {
                _ = await _mediaPlayback.RestoreRecoveryAsync(state.MediaPlayback, cancellationToken).ConfigureAwait(false);
                if (_mediaPlayback.Snapshot is not null)
                {
                    lock (_gate) _pendingPlaybackRecovery = null;
                }
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            lock (_gate) _persistenceHealthy = false;
        }
    }

    public Task StartProgramOutputAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        lock (_gate)
        {
            if (_running) return Task.CompletedTask;
            _listener.Prefixes.Clear();
            _listener.Prefixes.Add($"http://127.0.0.1:{_port}/");
            _listener.Start();
            _serverCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            _running = true;
            _serverTask = ServeAsync(_serverCts.Token);
        }
        return Task.CompletedTask;
    }

    public async Task StopProgramOutputAsync(CancellationToken cancellationToken)
    {
        CancellationTokenSource? cts;
        Task? task;
        lock (_gate)
        {
            if (!_running) return;
            _running = false;
            cts = _serverCts;
            task = _serverTask;
            _serverCts = null;
            _serverTask = null;
            cts?.Cancel();
            _listener.Stop();
        }
        if (task is not null)
        {
            try { await task.WaitAsync(cancellationToken).ConfigureAwait(false); }
            catch (OperationCanceledException) when (cts?.IsCancellationRequested == true) { }
            catch (HttpListenerException) when (cts?.IsCancellationRequested == true) { }
            catch (ObjectDisposedException) when (cts?.IsCancellationRequested == true) { }
        }
        cts?.Dispose();
    }

    public async Task SetPreviewAsync(PresentationRenderItem item, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(item);
        var nextLease = AcquireReadyMediaLease(item);
        IDisposable? previousLease;
        lock (_gate)
        {
            previousLease = _previewMediaLease;
            _previewMediaLease = nextLease;
            _preview = item;
        }
        previousLease?.Dispose();
        await SaveCurrentStateAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task TakePreviewToProgramAsync(CancellationToken cancellationToken)
    {
        await _programMutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            PresentationRenderItem preview;
            lock (_gate) preview = _preview ?? throw new InvalidOperationException("No presentation item is prepared in Preview.");
            var nextLease = AcquireReadyMediaLease(preview);
            try
            {
                if (_mediaPlayback is not null)
                {
                    if (preview.Media is not null)
                    {
                        var prepared = _mediaPreparation?.TryGet(preview.ItemId);
                        if (prepared?.State != MediaPreparationState.Ready || prepared.Asset is null || prepared.ServiceId != preview.ServiceId)
                            throw new InvalidOperationException("Media item is not ready for Program playback.");
                        await _mediaPlayback.TakeAsync(prepared.Asset, cancellationToken).ConfigureAwait(false);
                    }
                    else
                    {
                        await _mediaPlayback.ClearAsync(cancellationToken).ConfigureAwait(false);
                    }
                }

                IDisposable? previousLease;
                lock (_gate)
                {
                    previousLease = _programMediaLease;
                    _programMediaLease = nextLease;
                    _program = preview;
                    nextLease = null;
                }
                previousLease?.Dispose();
                await SaveCurrentStateAsync(cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                nextLease?.Dispose();
            }
        }
        finally
        {
            _programMutationGate.Release();
        }
    }

    public async Task ClearProgramAsync(CancellationToken cancellationToken)
    {
        await _programMutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_mediaPlayback is not null) await _mediaPlayback.ClearAsync(cancellationToken).ConfigureAwait(false);
            IDisposable? previousLease;
            lock (_gate)
            {
                _program = null;
                previousLease = _programMediaLease;
                _programMediaLease = null;
            }
            previousLease?.Dispose();
            await SaveCurrentStateAsync(cancellationToken).ConfigureAwait(false);
        }
        finally { _programMutationGate.Release(); }
    }

    public Task<MediaPlaybackSnapshot> PauseMediaAsync(CancellationToken cancellationToken) =>
        MutatePlaybackAsync(
            token => (_mediaPlayback ?? throw new InvalidOperationException("Media playback is unavailable.")).PauseAsync(token),
            cancellationToken);

    public Task<MediaPlaybackSnapshot> ResumeMediaAsync(CancellationToken cancellationToken) =>
        MutatePlaybackAsync(
            token => (_mediaPlayback ?? throw new InvalidOperationException("Media playback is unavailable.")).ResumeAsync(token),
            cancellationToken);

    public Task<MediaPlaybackSnapshot> SeekMediaAsync(double positionSeconds, CancellationToken cancellationToken) =>
        MutatePlaybackAsync(
            token => (_mediaPlayback ?? throw new InvalidOperationException("Media playback is unavailable.")).SeekAsync(positionSeconds, token),
            cancellationToken);

    private async Task<MediaPlaybackSnapshot> MutatePlaybackAsync(
        Func<CancellationToken, Task<MediaPlaybackSnapshot>> mutation,
        CancellationToken cancellationToken)
    {
        await _programMutationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var snapshot = await mutation(cancellationToken).ConfigureAwait(false);
            await SaveCurrentStateAsync(cancellationToken).ConfigureAwait(false);
            return snapshot;
        }
        finally
        {
            _programMutationGate.Release();
        }
    }

    public async Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken)
    {
        var mutated = false;
        IDisposable? previewLease = null;
        IDisposable? programLease = null;
        lock (_gate)
        {
            if (_preview is not null && _preview.ServiceId != serviceId)
            {
                _preview = null; mutated = true; previewLease = _previewMediaLease; _previewMediaLease = null;
            }
            if (_program is not null && _program.ServiceId != serviceId)
            {
                _program = null; mutated = true; programLease = _programMediaLease; _programMediaLease = null;
            }
        }
        previewLease?.Dispose();
        programLease?.Dispose();
        if (_mediaPlayback is not null)
        {
            await _mediaPlayback.SetActiveServiceAsync(serviceId, cancellationToken).ConfigureAwait(false);
            MediaPlaybackSnapshot? pending;
            lock (_gate) pending = _pendingPlaybackRecovery;
            if (pending is not null)
            {
                if (serviceId == pending.ServiceId)
                {
                    _ = await _mediaPlayback.RestoreRecoveryAsync(pending, cancellationToken).ConfigureAwait(false);
                    if (_mediaPlayback.Snapshot is not null)
                    {
                        lock (_gate) _pendingPlaybackRecovery = null;
                    }
                }
                else
                {
                    lock (_gate) _pendingPlaybackRecovery = null;
                }
            }
        }
        if (mutated) await SaveCurrentStateAsync(cancellationToken).ConfigureAwait(false);
    }

    private IDisposable? AcquireReadyMediaLease(PresentationRenderItem item)
    {
        if (!string.Equals(item.ItemType, "media", StringComparison.OrdinalIgnoreCase) && item.Media is null) return null;
        if (item.Media is null || _mediaPreparation is null)
            throw new InvalidOperationException("Media Preview requires a ready Edge media preparation.");
        var prepared = _mediaPreparation.TryGet(item.ItemId);
        if (prepared?.State != MediaPreparationState.Ready || prepared.Asset is null || prepared.ServiceId != item.ServiceId)
            throw new InvalidOperationException("Media item is not ready for Preview/Program output.");
        return _mediaPreparation.AcquireReadyLease(item.ItemId);
    }

    private static object? BrowserItem(PresentationRenderItem? item) => item is null ? null : new
    {
        item.ItemId, item.ServiceId, item.ItemType, item.Title, item.Body, item.Footer, item.Metadata
    };

    private BrowserMediaView? BrowserMedia(PresentationRenderItem? item, bool includePlayback)
    {
        if (item?.Media is null || _mediaPreparation is null || _mediaAssetCache is null) return null;
        var prepared = _mediaPreparation.TryGet(item.ItemId);
        if (prepared?.State != MediaPreparationState.Ready || prepared.Asset is null ||
            prepared.ServiceId != item.ServiceId || !_mediaAssetCache.TryGetReady(prepared.Asset.CacheKey, out var cacheEntry))
        {
            return new BrowserMediaView(
                null, item.Media.MediaKind, item.Media.ContentTypeHint, item.Media.Fit, item.Media.Volume,
                item.Media.Loop, prepared?.State.ToString().ToLowerInvariant() ?? "not_ready", null);
        }

        BrowserPlaybackView? playbackView = null;
        if (includePlayback && _mediaPlayback?.Snapshot is { } playback &&
            string.Equals(playback.ItemId, item.ItemId, StringComparison.Ordinal) &&
            playback.ServiceId == item.ServiceId)
        {
            playbackView = new BrowserPlaybackView(
                playback.Revision,
                playback.State,
                playback.EffectivePositionSeconds,
                DateTimeOffset.UtcNow);
        }

        return new BrowserMediaView(
            $"/api/media-assets/{cacheEntry.CacheKey}", cacheEntry.MediaKind, cacheEntry.ContentType,
            item.Media.Fit, item.Media.Volume, item.Media.Loop, "ready", playbackView);
    }

    private sealed record BrowserPlaybackView(
        long Revision,
        string State,
        double EffectivePositionSeconds,
        DateTimeOffset ServerTimeUtc);

    private sealed record BrowserMediaView(
        string? AssetUrl,
        string MediaKind,
        string? ContentType,
        string Fit,
        double Volume,
        bool Loop,
        string PreparationState,
        BrowserPlaybackView? Playback);

    private sealed record BrowserPlaybackReport(string ItemId, long Revision, string ErrorCode);

    private PersistedProgramState PersistentSnapshot() =>
        new(1, _preview, _program, _mediaPlayback?.Snapshot ?? _pendingPlaybackRecovery);

    private async Task SaveCurrentStateAsync(CancellationToken cancellationToken)
    {
        if (_stateStore is null) return;
        await _persistenceGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            PersistedProgramState state;
            lock (_gate) state = PersistentSnapshot();
            try
            {
                await _stateStore.SaveAsync(state, cancellationToken).ConfigureAwait(false);
                lock (_gate) _persistenceHealthy = true;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                lock (_gate) _persistenceHealthy = false;
            }
        }
        finally { _persistenceGate.Release(); }
    }

    private async Task ServeAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            HttpListenerContext context;
            try
            {
                context = await _listener.GetContextAsync().WaitAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (HttpListenerException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (ObjectDisposedException) when (cancellationToken.IsCancellationRequested) { break; }
            _ = Task.Run(() => HandleAsync(context), CancellationToken.None);
        }
    }

    private async Task HandleAsync(HttpListenerContext context)
    {
        try
        {
            var path = context.Request.Url?.AbsolutePath ?? "/";
            if (path == "/api/media-playback/report")
            {
                await HandleMediaPlaybackReportAsync(context).ConfigureAwait(false);
                return;
            }
            if (path.StartsWith("/api/media-assets/", StringComparison.Ordinal))
            {
                await HandleMediaAssetAsync(context, path).ConfigureAwait(false);
                return;
            }
            if (!string.Equals(context.Request.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = (int)HttpStatusCode.MethodNotAllowed;
                context.Response.Headers["Allow"] = "GET";
                await WriteAsync(context.Response, "text/plain; charset=utf-8", "Method not allowed").ConfigureAwait(false);
                return;
            }
            if (path is "/program" or "/preview")
            {
                await WriteAsync(context.Response, "text/html; charset=utf-8", RenderPage(path[1..])).ConfigureAwait(false);
                return;
            }
            if (path is "/api/state/program" or "/api/state/preview")
            {
                var isProgramState = path.EndsWith("program", StringComparison.Ordinal);
                var item = isProgramState ? Snapshot.Program : Snapshot.Preview;
                var theme = item is null ? null : PresentationThemeMetadata.Resolve(item.Metadata);
                var themeAssets = theme is null ? new Dictionary<string, string>() : _themeAssetCache.AvailableLoopbackUrls(theme);
                var json = JsonSerializer.Serialize(new
                {
                    ok = true,
                    item = BrowserItem(item),
                    theme,
                    themeAssets,
                    media = BrowserMedia(item, isProgramState)
                }, JsonOptions);
                await WriteAsync(context.Response, "application/json; charset=utf-8", json).ConfigureAwait(false);
                return;
            }
            if (path.StartsWith("/api/theme-assets/", StringComparison.Ordinal) && Guid.TryParse(path["/api/theme-assets/".Length..], out var assetId))
            {
                if (!_themeAssetCache.TryResolve(assetId, out var assetPath, out var assetContentType))
                {
                    context.Response.StatusCode = (int)HttpStatusCode.NotFound;
                    await WriteAsync(context.Response, "text/plain; charset=utf-8", "Theme asset not found").ConfigureAwait(false);
                    return;
                }
                await WriteFileAsync(context.Response, assetContentType, assetPath).ConfigureAwait(false);
                return;
            }
            context.Response.StatusCode = 404;
            await WriteAsync(context.Response, "text/plain; charset=utf-8", "Not found").ConfigureAwait(false);
        }
        catch
        {
            try { context.Response.Abort(); } catch { }
        }
    }

    private async Task HandleMediaPlaybackReportAsync(HttpListenerContext context)
    {
        if (!string.Equals(context.Request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = (int)HttpStatusCode.MethodNotAllowed;
            context.Response.Headers["Allow"] = "POST";
            await WriteAsync(context.Response, "text/plain; charset=utf-8", "Method not allowed").ConfigureAwait(false);
            return;
        }

        if (context.Request.ContentLength64 > 2048)
        {
            context.Response.StatusCode = (int)HttpStatusCode.BadRequest;
            await WriteAsync(context.Response, "text/plain; charset=utf-8", "Invalid playback report").ConfigureAwait(false);
            return;
        }

        BrowserPlaybackReport? report;
        try
        {
            using var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding ?? Encoding.UTF8, false, 1024, leaveOpen: true);
            var body = await reader.ReadToEndAsync().ConfigureAwait(false);
            if (body.Length > 2048) throw new JsonException("Playback report is too large.");
            report = JsonSerializer.Deserialize<BrowserPlaybackReport>(body, JsonOptions);
        }
        catch (JsonException)
        {
            context.Response.StatusCode = (int)HttpStatusCode.BadRequest;
            await WriteAsync(context.Response, "text/plain; charset=utf-8", "Invalid playback report").ConfigureAwait(false);
            return;
        }

        if (report is null || string.IsNullOrWhiteSpace(report.ItemId) || report.ItemId.Length > 128 ||
            report.Revision < 0 || string.IsNullOrWhiteSpace(report.ErrorCode) ||
            !BrowserPlaybackErrorCodes.Contains(report.ErrorCode))
        {
            context.Response.StatusCode = (int)HttpStatusCode.BadRequest;
            await WriteAsync(context.Response, "text/plain; charset=utf-8", "Invalid playback report").ConfigureAwait(false);
            return;
        }

        if (_mediaPlayback is null)
        {
            context.Response.StatusCode = (int)HttpStatusCode.Conflict;
            await WriteAsync(context.Response, "text/plain; charset=utf-8", "Playback state changed").ConfigureAwait(false);
            return;
        }

        await _programMutationGate.WaitAsync().ConfigureAwait(false);
        try
        {
            var updated = await _mediaPlayback.ReportBrowserErrorAsync(
                report.ItemId, report.Revision, report.ErrorCode, CancellationToken.None).ConfigureAwait(false);
            if (updated is null)
            {
                context.Response.StatusCode = (int)HttpStatusCode.Conflict;
                await WriteAsync(context.Response, "text/plain; charset=utf-8", "Playback state changed").ConfigureAwait(false);
                return;
            }
            await SaveCurrentStateAsync(CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            _programMutationGate.Release();
        }

        context.Response.StatusCode = (int)HttpStatusCode.NoContent;
        context.Response.ContentLength64 = 0;
        context.Response.Headers["Cache-Control"] = "no-store";
        context.Response.Close();
    }

    private async Task HandleMediaAssetAsync(HttpListenerContext context, string path)
    {
        var isGet = string.Equals(context.Request.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase);
        var isHead = string.Equals(context.Request.HttpMethod, "HEAD", StringComparison.OrdinalIgnoreCase);
        if (!isGet && !isHead)
        {
            context.Response.StatusCode = (int)HttpStatusCode.MethodNotAllowed;
            context.Response.Headers["Allow"] = "GET, HEAD";
            await WriteAsync(context.Response, "text/plain; charset=utf-8", "Method not allowed").ConfigureAwait(false);
            return;
        }

        var cacheKey = path["/api/media-assets/".Length..];
        if (!IsCacheKey(cacheKey) || _mediaAssetCache is null || !_mediaAssetCache.TryGetReady(cacheKey, out var entry) ||
            !File.Exists(entry.Path) || new FileInfo(entry.Path).Length != entry.Length)
        {
            context.Response.StatusCode = (int)HttpStatusCode.NotFound;
            await WriteAsync(context.Response, "text/plain; charset=utf-8", "Media asset not found").ConfigureAwait(false);
            return;
        }

        var start = 0L;
        var end = entry.Length - 1;
        var range = context.Request.Headers["Range"];
        var partial = !string.IsNullOrWhiteSpace(range);
        if (partial && !HttpByteRange.TryParseSingle(range, entry.Length, out start, out end))
        {
            context.Response.StatusCode = (int)HttpStatusCode.RequestedRangeNotSatisfiable;
            context.Response.Headers["Content-Range"] = $"bytes */{entry.Length}";
            context.Response.Headers["Accept-Ranges"] = "bytes";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.ContentLength64 = 0;
            context.Response.Close();
            return;
        }

        var count = end - start + 1;
        context.Response.StatusCode = partial ? (int)HttpStatusCode.PartialContent : (int)HttpStatusCode.OK;
        context.Response.ContentType = entry.ContentType;
        context.Response.ContentLength64 = count;
        context.Response.Headers["Accept-Ranges"] = "bytes";
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
        if (partial) context.Response.Headers["Content-Range"] = $"bytes {start}-{end}/{entry.Length}";
        if (isHead)
        {
            context.Response.Close();
            return;
        }

        await using var input = new FileStream(entry.Path, FileMode.Open, FileAccess.Read, FileShare.Read, 81_920, useAsync: true);
        input.Seek(start, SeekOrigin.Begin);
        var remaining = count;
        var buffer = new byte[81_920];
        while (remaining > 0)
        {
            var read = await input.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, remaining))).ConfigureAwait(false);
            if (read == 0) break;
            await context.Response.OutputStream.WriteAsync(buffer.AsMemory(0, read)).ConfigureAwait(false);
            remaining -= read;
        }
        context.Response.Close();
    }

    private static bool IsCacheKey(string value) =>
        value.Length == 64 && value.All(character =>
            character is >= '0' and <= '9' or >= 'a' and <= 'f' or >= 'A' and <= 'F');

    private static async Task WriteAsync(HttpListenerResponse response, string contentType, string body)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        response.StatusCode = response.StatusCode == 0 ? 200 : response.StatusCode;
        response.ContentType = contentType;
        response.ContentEncoding = Encoding.UTF8;
        response.ContentLength64 = bytes.Length;
        response.Headers["Cache-Control"] = "no-store";
        await response.OutputStream.WriteAsync(bytes).ConfigureAwait(false);
        response.Close();
    }

    private static async Task WriteFileAsync(HttpListenerResponse response, string contentType, string path)
    {
        var info = new FileInfo(path);
        response.StatusCode = 200;
        response.ContentType = contentType;
        response.ContentLength64 = info.Length;
        response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
        await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81_920, useAsync: true);
        await input.CopyToAsync(response.OutputStream).ConfigureAwait(false);
        response.Close();
    }

    private static string RenderPage(string view) => $$$"""
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>iPresenterPlux {{{view}}}</title><style>
:root{--ip-bg:linear-gradient(135deg,#090d14,#121b2a);--ip-primary:#ffffff;--ip-secondary:#e5b95e;--ip-title-scale:1;--ip-body-scale:1;--ip-footer-scale:1;--ip-safe:6}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#05070a;color:#fff;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
#stage{box-sizing:border-box;position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:calc(var(--ip-safe)*1%);background:var(--ip-bg);transition:background .22s ease}
#content{max-width:92vw;box-sizing:border-box;border-radius:1.2vw;position:relative;z-index:2}
#media-image,#media-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}#media-image[hidden],#media-video[hidden],#media-audio[hidden]{display:none}#stage.media-image-active #content,#stage.media-video-active #content{display:none}
#mode{font-size:clamp(12px,1.4vw,28px);letter-spacing:.35em;text-transform:uppercase;color:var(--ip-secondary);font-weight:800}
#title{font-size:clamp(12px,calc(5vw * var(--ip-title-scale)),9vw);line-height:1.05;margin:1.5vw 0 0;font-weight:900;color:var(--ip-secondary)}
#body{max-width:82vw;font-size:clamp(12px,calc(2.25vw * var(--ip-body-scale)),5vw);line-height:1.45;margin:2vw 0 0;color:var(--ip-primary);white-space:pre-wrap}
#logo{position:absolute;display:block;object-fit:contain;z-index:3}#logo[hidden]{display:none}
#footer{font-size:clamp(12px,calc(1.35vw * var(--ip-footer-scale)),3vw);margin-top:2vw;color:var(--ip-secondary);font-weight:700;letter-spacing:.08em}.empty{opacity:.28}
.anim-fade{animation:ipFade .28s ease both}.anim-slide{animation:ipSlide .3s ease both}.anim-zoom{animation:ipZoom .28s ease both}
@keyframes ipFade{from{opacity:0}to{opacity:1}}@keyframes ipSlide{from{opacity:0;transform:translateY(2vh)}to{opacity:1;transform:none}}@keyframes ipZoom{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
</style></head><body><main id="stage"><img id="media-image" alt="" hidden><video id="media-video" playsinline hidden></video><audio id="media-audio" hidden></audio><img id="logo" alt="" hidden><div id="content"><div id="mode">{{{view}}}</div><h1 id="title" class="empty">Waiting for iPresenterPlux</h1><div id="body"></div><div id="footer"></div></div></main>
<script>
const view={{{JsonSerializer.Serialize(view)}}};
const stage=document.getElementById('stage'),content=document.getElementById('content'),title=document.getElementById('title'),body=document.getElementById('body'),footer=document.getElementById('footer'),mode=document.getElementById('mode'),logo=document.getElementById('logo'),mediaImage=document.getElementById('media-image'),mediaVideo=document.getElementById('media-video'),mediaAudio=document.getElementById('media-audio');
const gradients=Object.freeze({midnight:'linear-gradient(135deg,#090d14,#121b2a)',violet_pink:'linear-gradient(135deg,#312e81,#7c3aed,#db2777)',navy_teal:'linear-gradient(135deg,#07111f,#0f3d56)',ivory_rose:'linear-gradient(135deg,#fff7ed,#fce7f3)'});
const fonts=new Set(['Inter','Arial','Verdana','Trebuchet MS','Georgia','Times New Roman','Noto Sans','Noto Serif']);
const hex=/^#[0-9a-f]{6}$/i;
const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
const horizontal=value=>value==='left'?'flex-start':value==='right'?'flex-end':'center';
const vertical=value=>value==='top'?'flex-start':value==='bottom'?'flex-end':'center';
function applyTheme(theme,item,assets){
  const t=theme||{};const bg=t.background||{};const localAssets=assets||{};let background=gradients.midnight;
  if(bg.kind==='solid'&&hex.test(bg.value||''))background=bg.value;
  else if(bg.kind==='gradient'&&Object.prototype.hasOwnProperty.call(gradients,bg.value))background=gradients[bg.value];
  else if(bg.kind==='image'&&typeof localAssets[bg.value]==='string')background=`url("${localAssets[bg.value]}") center/cover no-repeat`;
  stage.style.setProperty('--ip-bg',background);
  stage.style.setProperty('--ip-primary',hex.test(t.primaryTextColor||'')?t.primaryTextColor:'#ffffff');
  stage.style.setProperty('--ip-secondary',hex.test(t.secondaryTextColor||'')?t.secondaryTextColor:'#e5b95e');
  stage.style.setProperty('--ip-title-scale',String(clamp(t.titleSizeScale,.5,2.5,1)));
  stage.style.setProperty('--ip-body-scale',String(clamp(t.bodySizeScale,.5,2.25,1)));
  stage.style.setProperty('--ip-footer-scale',String(clamp(t.footerSizeScale,.5,1.75,1)));
  stage.style.setProperty('--ip-safe',String(clamp(t.safeAreaPercent,0,15,6)));
  const h=['left','center','right'].includes(t.horizontalAlignment)?t.horizontalAlignment:'center';
  const v=['top','center','bottom'].includes(t.verticalAlignment)?t.verticalAlignment:'center';
  stage.style.alignItems=horizontal(h);stage.style.justifyContent=vertical(v);stage.style.textAlign=h;
  const font=fonts.has(t.fontFamily)?t.fontFamily:'Inter';title.style.fontFamily=font;body.style.fontFamily=font;footer.style.fontFamily=font;
  const shadow=t.shadow===true?'0 2px 14px rgba(0,0,0,.65)':'none';title.style.textShadow=shadow;body.style.textShadow=shadow;
  const lower=t.lowerThird||{};const lowerMode=['off','auto','always'].includes(lower.mode)?lower.mode:'auto';
  const isLower=lowerMode==='always'||(lowerMode==='auto'&&item?.itemType==='lower_third');
  if(isLower){const pos=['bottom_left','bottom_center','bottom_right'].includes(lower.position)?lower.position:'bottom_left';stage.style.justifyContent='flex-end';stage.style.alignItems=pos.endsWith('left')?'flex-start':pos.endsWith('right')?'flex-end':'center';stage.style.textAlign=pos.endsWith('left')?'left':pos.endsWith('right')?'right':'center';content.style.backgroundColor=`rgba(0,0,0,${clamp(t.backingOpacity,0,1,.18)})`;content.style.padding='1.2vw 1.5vw';}
  else{content.style.backgroundColor='transparent';content.style.padding='0';}
  const logoConfig=t.logo||{};const logoUrl=logoConfig.mediaId&&typeof localAssets[logoConfig.mediaId]==='string'?localAssets[logoConfig.mediaId]:null;
  if(logoUrl){logo.src=logoUrl;logo.hidden=false;const size=clamp(logoConfig.sizePercent,1,30,8);logo.style.width=size+'%';logo.style.height='auto';logo.style.top=logoConfig.position?.startsWith('top')?'var(--logo-gap,3%)':'auto';logo.style.bottom=logoConfig.position?.startsWith('bottom')?'var(--logo-gap,3%)':'auto';logo.style.left=logoConfig.position?.endsWith('left')?'var(--logo-gap,3%)':'auto';logo.style.right=logoConfig.position?.endsWith('right')?'var(--logo-gap,3%)':'auto';}else{logo.hidden=true;logo.removeAttribute('src');}
  mode.style.color=hex.test(t.secondaryTextColor||'')?t.secondaryTextColor:'#e5b95e';
}
function animateContent(kind){content.classList.remove('anim-fade','anim-slide','anim-zoom');void content.offsetWidth;if(kind==='fade')content.classList.add('anim-fade');else if(kind==='slide')content.classList.add('anim-slide');else if(kind==='zoom')content.classList.add('anim-zoom');}
async function reportPlaybackError(itemId,revision,errorCode){if(!itemId||!Number.isFinite(Number(revision)))return;try{await fetch('/api/media-playback/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({itemId,revision,errorCode}),cache:'no-store'});}catch{}}
function resetDynamicMedia(element){element.pause();element.hidden=true;element.removeAttribute('src');delete element.dataset.identity;delete element.dataset.revision;delete element.dataset.reportedRevision;try{element.load();}catch{}}
async function syncDynamicMedia(element,media,item){
  const identity=(item?.itemId||'')+'|'+media.assetUrl+'|'+media.mediaKind;
  if(element.dataset.identity!==identity){element.pause();element.src=media.assetUrl;element.dataset.identity=identity;delete element.dataset.revision;delete element.dataset.reportedRevision;try{element.load();}catch{}}
  element.hidden=false;element.loop=media.loop===true;element.volume=clamp(media.volume,0,1,1);
  const playback=media.playback;if(!playback){element.pause();return;}
  const revision=Number(playback.revision);let target=Number(playback.effectivePositionSeconds);const serverTime=Date.parse(playback.serverTimeUtc||'');
  if(playback.state==='playing'&&Number.isFinite(serverTime)&&Number.isFinite(target))target+=Math.max(0,(Date.now()-serverTime)/1000);
  if(Number.isFinite(target)&&Math.abs(element.currentTime-target)>0.25){try{element.currentTime=target;}catch{}}
  if(element.dataset.revision===String(revision))return;element.dataset.revision=String(revision);
  if(playback.state==='playing'){
    try{await element.play();}
    catch{if(element.dataset.reportedRevision!==String(revision)){element.dataset.reportedRevision=String(revision);await reportPlaybackError(item?.itemId,playback.revision,'media_browser_playback_blocked');}}
  }else{element.pause();}
}
async function applyMedia(media,item){
  const kind=media?.mediaKind;const hasAsset=typeof media?.assetUrl==='string';
  stage.classList.remove('media-image-active','media-video-active');
  if(kind==='image'&&hasAsset){resetDynamicMedia(mediaVideo);resetDynamicMedia(mediaAudio);const identity=(item?.itemId||'')+'|'+media.assetUrl;if(mediaImage.dataset.identity!==identity){mediaImage.src=media.assetUrl;mediaImage.dataset.identity=identity;}mediaImage.style.objectFit=media.fit==='cover'?'cover':'contain';mediaImage.hidden=false;stage.classList.add('media-image-active');return;}
  mediaImage.hidden=true;mediaImage.removeAttribute('src');delete mediaImage.dataset.identity;
  if((kind==='video'||kind==='audio')&&hasAsset){const active=kind==='video'?mediaVideo:mediaAudio;const inactive=kind==='video'?mediaAudio:mediaVideo;resetDynamicMedia(inactive);if(kind==='video'){mediaVideo.style.objectFit=media.fit==='cover'?'cover':'contain';stage.classList.add('media-video-active');}await syncDynamicMedia(active,media,item);return;}
  resetDynamicMedia(mediaVideo);resetDynamicMedia(mediaAudio);
}
let lastItemId=null;
async function refresh(){try{const r=await fetch('/api/state/'+view,{cache:'no-store'});const p=await r.json();const i=p.item;applyTheme(p.theme,i,p.themeAssets);await applyMedia(p.media,i);if(!i){title.textContent='';body.textContent='';footer.textContent='';title.classList.add('empty');lastItemId=null;return;}title.classList.remove('empty');title.textContent=i.title||'';body.textContent=i.body||'';footer.textContent=i.footer||'';if(i.itemId!==lastItemId){animateContent(p.theme?.animation);lastItemId=i.itemId;}}catch{}}
refresh();setInterval(refresh,250);
</script></body></html>
""";

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        if (_stateStore is not null) await SaveCurrentStateAsync(CancellationToken.None).ConfigureAwait(false);
        _disposed = true;
        await StopProgramOutputAsync(CancellationToken.None).ConfigureAwait(false);
        IDisposable? previewLease;
        IDisposable? programLease;
        lock (_gate)
        {
            previewLease = _previewMediaLease; _previewMediaLease = null;
            programLease = _programMediaLease; _programMediaLease = null;
        }
        previewLease?.Dispose();
        programLease?.Dispose();
        _listener.Close();
        _programMutationGate.Dispose();
        _persistenceGate.Dispose();
    }
}
