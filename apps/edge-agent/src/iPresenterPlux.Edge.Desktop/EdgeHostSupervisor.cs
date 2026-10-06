using System.Diagnostics;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Desktop;

public enum EdgeDesktopRuntimeState
{
    SetupRequired,
    Stopped,
    Starting,
    Active,
    Degraded,
    Stopping,
    EnrollmentRequired,
    AlreadyRunning,
    ConfigurationError,
    Crashed
}

public sealed record EdgeDesktopSnapshot(
    EdgeDesktopRuntimeState State,
    int? ProcessId,
    int? ExitCode,
    bool ControlPlaneHealthy,
    bool LocalProgramHealthy,
    string? ErrorCode,
    DateTimeOffset UpdatedAt);

public sealed class EdgeHostSupervisor : IAsyncDisposable
{
    private readonly ShellPaths _paths;
    private readonly IEdgeChildProcessFactory _processFactory;
    private readonly IEdgeHealthProbe _healthProbe;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IEdgeChildProcess? _process;
    private CancellationTokenSource? _monitorCancellation;
    private Task? _monitorTask;
    private bool _stopRequested;

    public EdgeHostSupervisor(
        ShellPaths paths,
        IEdgeChildProcessFactory? processFactory = null,
        IEdgeHealthProbe? healthProbe = null)
    {
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _processFactory = processFactory ?? new SystemEdgeChildProcessFactory();
        _healthProbe = healthProbe ?? new HttpEdgeHealthProbe();
        Snapshot = new EdgeDesktopSnapshot(
            EdgeDesktopRuntimeState.Stopped, null, null, false, false, null, DateTimeOffset.UtcNow);
    }

    public EdgeDesktopSnapshot Snapshot { get; private set; }
    public event EventHandler<EdgeDesktopSnapshot>? SnapshotChanged;

    public async Task StartAsync(DesktopSettings settings, string? pairingCode, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_process is { HasExited: false }) return;
            _monitorCancellation?.Cancel();
            if (_monitorTask is not null)
            {
                try { await _monitorTask.ConfigureAwait(false); }
                catch (OperationCanceledException) { }
                catch { }
            }
            _monitorCancellation?.Dispose();
            _monitorCancellation = null;
            _monitorTask = null;
            _process?.Dispose();
            _process = null;

            var normalized = settings.Normalize();
            var controlPlane = normalized.ValidateControlPlaneUri();
            Publish(EdgeDesktopRuntimeState.Starting, null, null, false, false, null);

            ProcessStartInfo startInfo;
            try { startInfo = EdgeHostStartInfoFactory.Create(_paths, normalized, pairingCode); }
            catch (FileNotFoundException)
            {
                Publish(EdgeDesktopRuntimeState.ConfigurationError, null, null, false, false, "runtime_missing");
                return;
            }
            catch (InvalidOperationException)
            {
                Publish(EdgeDesktopRuntimeState.ConfigurationError, null, null, false, false, "configuration_invalid");
                return;
            }

            _stopRequested = false;
            try
            {
                _process = _processFactory.Start(startInfo);
            }
            catch
            {
                Publish(EdgeDesktopRuntimeState.Crashed, null, null, false, false, "runtime_start_failed");
                return;
            }
            finally
            {
                startInfo.Environment.Remove("IPRESENTERPLUX_PAIRING_CODE");
            }

            _monitorCancellation = new CancellationTokenSource();
            var child = _process;
            Publish(EdgeDesktopRuntimeState.Starting, child.Id, null, false, false, null);
            _monitorTask = MonitorAsync(child, controlPlane, normalized.ProgramPort, _monitorCancellation.Token);
        }
        finally { _gate.Release(); }
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        IEdgeChildProcess? child;
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            child = _process;
            if (child is null || child.HasExited)
            {
                Publish(EdgeDesktopRuntimeState.Stopped, null, child?.HasExited == true ? child.ExitCode : null, false, false, null);
                return;
            }
            _stopRequested = true;
            Publish(EdgeDesktopRuntimeState.Stopping, child.Id, null, Snapshot.ControlPlaneHealthy, Snapshot.LocalProgramHealthy, null);
            await new FileEdgeHostShutdownSignal(_paths.EdgeDataDirectory).RequestAsync(cancellationToken).ConfigureAwait(false);
        }
        finally { _gate.Release(); }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        var forced = false;
        try { await child.WaitForExitAsync(timeout.Token).ConfigureAwait(false); }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            forced = true;
            try { child.Kill(entireProcessTree: true); } catch { }
            try { await child.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false); } catch { }
        }

        Publish(EdgeDesktopRuntimeState.Stopped, null, child.HasExited ? child.ExitCode : null, false, false, forced ? "forced_shutdown" : null);
    }

    public async Task RestartAsync(DesktopSettings settings, string? pairingCode, CancellationToken cancellationToken = default)
    {
        await StopAsync(cancellationToken).ConfigureAwait(false);
        await StartAsync(settings, pairingCode, cancellationToken).ConfigureAwait(false);
    }

    private async Task MonitorAsync(IEdgeChildProcess child, Uri controlPlane, int programPort, CancellationToken cancellationToken)
    {
        var exitTask = child.WaitForExitAsync(cancellationToken);
        try
        {
            while (!exitTask.IsCompleted && !cancellationToken.IsCancellationRequested)
            {
                EdgeHealthProbeResult health;
                try { health = await _healthProbe.ProbeAsync(controlPlane, programPort, cancellationToken).ConfigureAwait(false); }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
                catch { health = new EdgeHealthProbeResult(false, false); }

                if (!child.HasExited && !_stopRequested)
                {
                    var state = health.ControlPlaneHealthy
                        ? EdgeDesktopRuntimeState.Active
                        : EdgeDesktopRuntimeState.Degraded;
                    Publish(state, child.Id, null, health.ControlPlaneHealthy, health.LocalProgramHealthy,
                        health.ControlPlaneHealthy ? null : "control_plane_unreachable");
                }

                var delay = Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
                await Task.WhenAny(exitTask, delay).ConfigureAwait(false);
            }

            try { await exitTask.ConfigureAwait(false); }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { return; }
            if (_stopRequested) return;
            var exitCode = child.ExitCode;
            Publish(MapExitState(exitCode), null, exitCode, false, false, ExitErrorCode(exitCode));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    public static EdgeDesktopRuntimeState MapExitState(int exitCode) => exitCode switch
    {
        0 => EdgeDesktopRuntimeState.Stopped,
        2 => EdgeDesktopRuntimeState.ConfigurationError,
        3 => EdgeDesktopRuntimeState.EnrollmentRequired,
        4 => EdgeDesktopRuntimeState.AlreadyRunning,
        _ => EdgeDesktopRuntimeState.Crashed
    };

    private static string? ExitErrorCode(int exitCode) => exitCode switch
    {
        0 => null,
        2 => "runtime_configuration_error",
        3 => "enrollment_required",
        4 => "runtime_already_running",
        _ => "runtime_exited"
    };

    private void Publish(
        EdgeDesktopRuntimeState state,
        int? processId,
        int? exitCode,
        bool controlHealthy,
        bool localProgramHealthy,
        string? errorCode)
    {
        Snapshot = new EdgeDesktopSnapshot(
            state, processId, exitCode, controlHealthy, localProgramHealthy, errorCode, DateTimeOffset.UtcNow);
        SnapshotChanged?.Invoke(this, Snapshot);
    }

    public async ValueTask DisposeAsync()
    {
        try { await StopAsync().ConfigureAwait(false); } catch { }
        _monitorCancellation?.Cancel();
        if (_monitorTask is not null)
        {
            try { await _monitorTask.ConfigureAwait(false); } catch { }
        }
        _monitorCancellation?.Dispose();
        _process?.Dispose();
        if (_healthProbe is IDisposable disposable) disposable.Dispose();
        _gate.Dispose();
    }
}
