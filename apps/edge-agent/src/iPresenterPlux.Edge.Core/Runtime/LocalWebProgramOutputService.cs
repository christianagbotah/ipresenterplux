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

public sealed class LocalWebProgramOutputService : IMediaOutputService, IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly object _gate = new();
    private readonly HttpListener _listener = new();
    private readonly int _port;
    private CancellationTokenSource? _serverCts;
    private Task? _serverTask;
    private PresentationRenderItem? _preview;
    private PresentationRenderItem? _program;
    private bool _running;
    private bool _disposed;

    public LocalWebProgramOutputService(int port = 49321)
    {
        if (port is < 1024 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        _port = port;
    }

    public Uri ProgramUri => new($"http://127.0.0.1:{_port}/program");
    public Uri PreviewUri => new($"http://127.0.0.1:{_port}/preview");

    public LocalProgramSnapshot Snapshot
    {
        get { lock (_gate) return new LocalProgramSnapshot(_running, _preview, _program); }
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

    public Task SetPreviewAsync(PresentationRenderItem item, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(item);
        lock (_gate) _preview = item;
        return Task.CompletedTask;
    }

    public Task TakePreviewToProgramAsync(CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (_preview is null) throw new InvalidOperationException("No presentation item is prepared in Preview.");
            _program = _preview;
        }
        return Task.CompletedTask;
    }

    public Task ClearProgramAsync(CancellationToken cancellationToken)
    {
        lock (_gate) _program = null;
        return Task.CompletedTask;
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
            if (path is "/program" or "/preview")
            {
                await WriteAsync(context.Response, "text/html; charset=utf-8", RenderPage(path[1..])).ConfigureAwait(false);
                return;
            }
            if (path is "/api/state/program" or "/api/state/preview")
            {
                var item = path.EndsWith("program", StringComparison.Ordinal) ? Snapshot.Program : Snapshot.Preview;
                var json = JsonSerializer.Serialize(new { ok = true, item }, JsonOptions);
                await WriteAsync(context.Response, "application/json; charset=utf-8", json).ConfigureAwait(false);
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

    private static string RenderPage(string view) => $$"""
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>iPresenterPlux {{view}}</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#05070a;color:#fff;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
#stage{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:7vw;background:radial-gradient(circle at 50% 45%,#151b24 0,#070a0f 55%,#020304 100%)}
#mode{font-size:1.4vw;letter-spacing:.35em;text-transform:uppercase;color:#d7a94a;font-weight:800}#title{font-size:5vw;line-height:1.05;margin:1.5vw 0 0;font-weight:900}#body{max-width:82vw;font-size:2.25vw;line-height:1.45;margin:2vw 0 0;color:#f5f7fa;white-space:pre-wrap}#footer{font-size:1.35vw;margin-top:2vw;color:#aeb6c2;font-weight:700;letter-spacing:.08em}.empty{opacity:.28}
</style></head><body><main id="stage"><div id="mode">{{view}}</div><h1 id="title" class="empty">Waiting for iPresenterPlux</h1><div id="body"></div><div id="footer"></div></main>
<script>
const view={{JsonSerializer.Serialize(view)}};const title=document.getElementById('title'),body=document.getElementById('body'),footer=document.getElementById('footer');
async function refresh(){try{const r=await fetch('/api/state/'+view,{cache:'no-store'});const p=await r.json();const i=p.item;if(!i){title.textContent='';body.textContent='';footer.textContent='';title.classList.add('empty');return;}title.classList.remove('empty');title.textContent=i.title||'';body.textContent=i.body||'';footer.textContent=i.footer||'';}catch{}}
refresh();setInterval(refresh,250);
</script></body></html>
""";

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await StopProgramOutputAsync(CancellationToken.None).ConfigureAwait(false);
        _listener.Close();
    }
}
