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
    private readonly object _gate = new();
    private readonly HttpListener _listener = new();
    private readonly int _port;
    private readonly FileProgramStateStore? _stateStore;
    private readonly SemaphoreSlim _persistenceGate = new(1, 1);
    private CancellationTokenSource? _serverCts;
    private Task? _serverTask;
    private PresentationRenderItem? _preview;
    private PresentationRenderItem? _program;
    private bool _running;
    private bool _persistenceHealthy = true;
    private bool _disposed;

    public LocalWebProgramOutputService(int port = 49321, FileProgramStateStore? stateStore = null)
    {
        if (port is < 1024 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        _port = port;
        _stateStore = stateStore;
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
                _persistenceHealthy = true;
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
        lock (_gate) _preview = item;
        await SaveCurrentStateAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task TakePreviewToProgramAsync(CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (_preview is null) throw new InvalidOperationException("No presentation item is prepared in Preview.");
            _program = _preview;
        }
        await SaveCurrentStateAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task ClearProgramAsync(CancellationToken cancellationToken)
    {
        lock (_gate) _program = null;
        await SaveCurrentStateAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken)
    {
        var mutated = false;
        lock (_gate)
        {
            if (_preview is not null && _preview.ServiceId != serviceId) { _preview = null; mutated = true; }
            if (_program is not null && _program.ServiceId != serviceId) { _program = null; mutated = true; }
        }
        if (mutated) await SaveCurrentStateAsync(cancellationToken).ConfigureAwait(false);
    }

    private PersistedProgramState PersistentSnapshot() => new(1, _preview, _program);

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
            if (!string.Equals(context.Request.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = (int)HttpStatusCode.MethodNotAllowed;
                context.Response.Headers["Allow"] = "GET";
                await WriteAsync(context.Response, "text/plain; charset=utf-8", "Method not allowed").ConfigureAwait(false);
                return;
            }

            var path = context.Request.Url?.AbsolutePath ?? "/";
            if (path is "/program" or "/preview")
            {
                await WriteAsync(context.Response, "text/html; charset=utf-8", RenderPage(path[1..])).ConfigureAwait(false);
                return;
            }
            if (path is "/api/state/program" or "/api/state/preview")
            {
                var item = path.EndsWith("program", StringComparison.Ordinal) ? Snapshot.Program : Snapshot.Preview;
                var theme = item is null ? null : PresentationThemeMetadata.Resolve(item.Metadata);
                var json = JsonSerializer.Serialize(new { ok = true, item, theme }, JsonOptions);
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

    private static string RenderPage(string view) => $$$"""
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>iPresenterPlux {{{view}}}</title><style>
:root{--ip-bg:linear-gradient(135deg,#090d14,#121b2a);--ip-primary:#ffffff;--ip-secondary:#e5b95e;--ip-title-scale:1;--ip-body-scale:1;--ip-footer-scale:1;--ip-safe:6}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#05070a;color:#fff;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
#stage{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:calc(var(--ip-safe)*1%);background:var(--ip-bg);transition:background .22s ease}
#content{max-width:92vw;box-sizing:border-box;border-radius:1.2vw}
#mode{font-size:clamp(12px,1.4vw,28px);letter-spacing:.35em;text-transform:uppercase;color:var(--ip-secondary);font-weight:800}
#title{font-size:clamp(12px,calc(5vw * var(--ip-title-scale)),9vw);line-height:1.05;margin:1.5vw 0 0;font-weight:900;color:var(--ip-secondary)}
#body{max-width:82vw;font-size:clamp(12px,calc(2.25vw * var(--ip-body-scale)),5vw);line-height:1.45;margin:2vw 0 0;color:var(--ip-primary);white-space:pre-wrap}
#footer{font-size:clamp(12px,calc(1.35vw * var(--ip-footer-scale)),3vw);margin-top:2vw;color:var(--ip-secondary);font-weight:700;letter-spacing:.08em}.empty{opacity:.28}
.anim-fade{animation:ipFade .28s ease both}.anim-slide{animation:ipSlide .3s ease both}.anim-zoom{animation:ipZoom .28s ease both}
@keyframes ipFade{from{opacity:0}to{opacity:1}}@keyframes ipSlide{from{opacity:0;transform:translateY(2vh)}to{opacity:1;transform:none}}@keyframes ipZoom{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
</style></head><body><main id="stage"><div id="content"><div id="mode">{{{view}}}</div><h1 id="title" class="empty">Waiting for iPresenterPlux</h1><div id="body"></div><div id="footer"></div></div></main>
<script>
const view={{{JsonSerializer.Serialize(view)}}};
const stage=document.getElementById('stage'),content=document.getElementById('content'),title=document.getElementById('title'),body=document.getElementById('body'),footer=document.getElementById('footer'),mode=document.getElementById('mode');
const gradients=Object.freeze({midnight:'linear-gradient(135deg,#090d14,#121b2a)',violet_pink:'linear-gradient(135deg,#312e81,#7c3aed,#db2777)',navy_teal:'linear-gradient(135deg,#07111f,#0f3d56)',ivory_rose:'linear-gradient(135deg,#fff7ed,#fce7f3)'});
const fonts=new Set(['Inter','Arial','Verdana','Trebuchet MS','Georgia','Times New Roman','Noto Sans','Noto Serif']);
const hex=/^#[0-9a-f]{6}$/i;
const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
const horizontal=value=>value==='left'?'flex-start':value==='right'?'flex-end':'center';
const vertical=value=>value==='top'?'flex-start':value==='bottom'?'flex-end':'center';
function applyTheme(theme,item){
  const t=theme||{};const bg=t.background||{};let background=gradients.midnight;
  if(bg.kind==='solid'&&hex.test(bg.value||''))background=bg.value;
  else if(bg.kind==='gradient'&&Object.prototype.hasOwnProperty.call(gradients,bg.value))background=gradients[bg.value];
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
  mode.style.color=hex.test(t.secondaryTextColor||'')?t.secondaryTextColor:'#e5b95e';
}
function animateContent(kind){content.classList.remove('anim-fade','anim-slide','anim-zoom');void content.offsetWidth;if(kind==='fade')content.classList.add('anim-fade');else if(kind==='slide')content.classList.add('anim-slide');else if(kind==='zoom')content.classList.add('anim-zoom');}
let lastItemId=null;
async function refresh(){try{const r=await fetch('/api/state/'+view,{cache:'no-store'});const p=await r.json();const i=p.item;applyTheme(p.theme,i);if(!i){title.textContent='';body.textContent='';footer.textContent='';title.classList.add('empty');lastItemId=null;return;}title.classList.remove('empty');title.textContent=i.title||'';body.textContent=i.body||'';footer.textContent=i.footer||'';if(i.itemId!==lastItemId){animateContent(p.theme?.animation);lastItemId=i.itemId;}}catch{}}
refresh();setInterval(refresh,250);
</script></body></html>
""";

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await StopProgramOutputAsync(CancellationToken.None).ConfigureAwait(false);
        _listener.Close();
        _persistenceGate.Dispose();
    }
}
