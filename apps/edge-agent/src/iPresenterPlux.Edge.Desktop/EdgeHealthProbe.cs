namespace iPresenterPlux.Edge.Desktop;

public sealed record EdgeHealthProbeResult(bool ControlPlaneHealthy, bool LocalProgramHealthy);

public interface IEdgeHealthProbe
{
    Task<EdgeHealthProbeResult> ProbeAsync(Uri controlPlane, int programPort, CancellationToken cancellationToken);
}

public sealed class HttpEdgeHealthProbe : IEdgeHealthProbe, IDisposable
{
    private readonly HttpClient _client = new() { Timeout = TimeSpan.FromSeconds(2) };

    public async Task<EdgeHealthProbeResult> ProbeAsync(
        Uri controlPlane,
        int programPort,
        CancellationToken cancellationToken)
    {
        var controlHealthy = await IsHealthyAsync(new Uri(controlPlane, "/api/v1/health"), cancellationToken).ConfigureAwait(false);
        var programHealthy = await IsHealthyAsync(
            new Uri($"http://127.0.0.1:{programPort}/api/state/program"),
            cancellationToken).ConfigureAwait(false);
        return new EdgeHealthProbeResult(controlHealthy, programHealthy);
    }

    private async Task<bool> IsHealthyAsync(Uri uri, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
            return response.IsSuccessStatusCode;
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or OperationCanceledException)
        {
            return false;
        }
    }

    public void Dispose() => _client.Dispose();
}
