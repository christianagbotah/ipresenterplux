using System.Diagnostics;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Runtime;
using Lightworld.Update.Client;

namespace iPresenterPlux.Edge.Desktop.Update;

public enum DesktopUpdateState
{
    Idle,
    Checking,
    Downloading,
    Ready,
    WaitingForSafeRestart,
    Installing,
    Succeeded,
    FailedRolledBack
}

public sealed class IpresenterUpdateCoordinator
{
    private static readonly JsonSerializerOptions PlanJsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly IUpdateStagingWorkflow _workflow;
    private readonly UpdateStateStore _store;
    private bool _safeToRestart;

    public IpresenterUpdateCoordinator(IUpdateStagingWorkflow workflow, UpdateStateStore store)
    {
        _workflow = workflow ?? throw new ArgumentNullException(nameof(workflow));
        _store = store ?? throw new ArgumentNullException(nameof(store));
    }

    public DesktopUpdateState State { get; private set; } = DesktopUpdateState.Idle;
    public StagedDesktopUpdate? StagedUpdate { get; private set; }
    public string? LastError { get; private set; }
    public bool CanRestartAndInstall => StagedUpdate is not null && State == DesktopUpdateState.Ready && _safeToRestart;
    public event EventHandler? StateChanged;

    public async Task InitializeAsync(
        LocalOperatorSnapshot local,
        EdgeDesktopSnapshot runtime,
        CancellationToken cancellationToken)
    {
        StagedUpdate = await _store.LoadAsync(cancellationToken).ConfigureAwait(false);
        _safeToRestart = UpdateSafetyPolicy.IsSafe(local, runtime);
        SetState(StagedUpdate is null
            ? DesktopUpdateState.Idle
            : _safeToRestart ? DesktopUpdateState.Ready : DesktopUpdateState.WaitingForSafeRestart);
    }

    public async Task CheckAsync(
        DesktopSettings settings,
        string currentVersion,
        LocalOperatorSnapshot local,
        EdgeDesktopSnapshot runtime,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(settings);
        LastError = null;
        _safeToRestart = UpdateSafetyPolicy.IsSafe(local, runtime);
        SetState(DesktopUpdateState.Checking);
        try
        {
            SetState(DesktopUpdateState.Downloading);
            var staged = await _workflow.CheckAndStageAsync(settings, currentVersion, cancellationToken).ConfigureAwait(false);
            if (staged is null)
            {
                StagedUpdate = null;
                await _store.ClearAsync(cancellationToken).ConfigureAwait(false);
                SetState(DesktopUpdateState.Idle);
                return;
            }

            StagedUpdate = staged;
            await _store.SaveAsync(staged, cancellationToken).ConfigureAwait(false);
            SetState(_safeToRestart ? DesktopUpdateState.Ready : DesktopUpdateState.WaitingForSafeRestart);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            LastError = "Update check could not be completed. The installed version remains available.";
            SetState(StagedUpdate is null
                ? DesktopUpdateState.Idle
                : _safeToRestart ? DesktopUpdateState.Ready : DesktopUpdateState.WaitingForSafeRestart);
        }
    }

    public void RefreshSafety(LocalOperatorSnapshot local, EdgeDesktopSnapshot runtime)
    {
        _safeToRestart = UpdateSafetyPolicy.IsSafe(local, runtime);
        if (StagedUpdate is null) return;
        if (State is DesktopUpdateState.Installing or DesktopUpdateState.Succeeded or DesktopUpdateState.FailedRolledBack) return;
        SetState(_safeToRestart ? DesktopUpdateState.Ready : DesktopUpdateState.WaitingForSafeRestart);
    }

    public async Task<string> PrepareApplyPlanAsync(
        string currentVersion,
        string installRoot,
        string desktopExeRelativePath,
        CancellationToken cancellationToken)
    {
        if (!CanRestartAndInstall || StagedUpdate is null)
            throw new InvalidOperationException("The staged update cannot be installed until the local live session is safe to restart.");
        ArgumentException.ThrowIfNullOrWhiteSpace(currentVersion);
        ArgumentException.ThrowIfNullOrWhiteSpace(installRoot);
        ArgumentException.ThrowIfNullOrWhiteSpace(desktopExeRelativePath);

        var root = Path.GetFullPath(installRoot);
        var stateDirectory = Path.Combine(root, "state");
        Directory.CreateDirectory(stateDirectory);
        var healthToken = Guid.NewGuid().ToString("N");
        var plan = new DesktopApplyPlan(
            "ipresenterplux",
            currentVersion,
            StagedUpdate.Version,
            Path.GetFullPath(StagedUpdate.PackagePath),
            root,
            desktopExeRelativePath,
            healthToken,
            45,
            StagedUpdate.Size,
            StagedUpdate.Sha256,
            Environment.ProcessId,
            30,
            StagedUpdate.PackageKind,
            StagedUpdate.FullFallbackUrl,
            StagedUpdate.FullFallbackSize,
            StagedUpdate.FullFallbackSha256);
        var planPath = Path.Combine(stateDirectory, $"update-plan-{healthToken}.json");
        await File.WriteAllTextAsync(planPath, JsonSerializer.Serialize(plan, PlanJsonOptions), cancellationToken)
            .ConfigureAwait(false);
        SetState(DesktopUpdateState.Installing);
        return planPath;
    }

    public Process? LaunchApplyHelper(string installRoot, string planPath)
    {
        var helper = Path.Combine(Path.GetFullPath(installRoot), OperatingSystem.IsWindows()
            ? "Lightworld.Update.Helper.exe"
            : "Lightworld.Update.Helper");
        if (!File.Exists(helper))
        {
            LastError = "The installed update helper is missing. Reinstall iPresenterPlux to repair updates.";
            SetState(_safeToRestart ? DesktopUpdateState.Ready : DesktopUpdateState.WaitingForSafeRestart);
            return null;
        }

        var start = new ProcessStartInfo(helper)
        {
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(helper)!
        };
        start.ArgumentList.Add("apply");
        start.ArgumentList.Add("--plan");
        start.ArgumentList.Add(Path.GetFullPath(planPath));
        try
        {
            var process = Process.Start(start);
            if (process is not null) return process;
        }
        catch { }
        LastError = "The update helper could not be started. The current version remains installed.";
        SetState(_safeToRestart ? DesktopUpdateState.Ready : DesktopUpdateState.WaitingForSafeRestart);
        return null;
    }

    private void SetState(DesktopUpdateState state)
    {
        State = state;
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    private sealed record DesktopApplyPlan(
        string Product,
        string FromVersion,
        string ToVersion,
        string StagedPackagePath,
        string InstallRoot,
        string DesktopExeRelativePath,
        string HealthToken,
        int HealthTimeoutSeconds,
        long ExpectedPackageSize,
        string ExpectedPackageSha256,
        int ParentProcessId,
        int ParentExitTimeoutSeconds,
        UpdatePackageKind PackageKind,
        string? FullFallbackUrl,
        long? FullFallbackSize,
        string? FullFallbackSha256);
}
