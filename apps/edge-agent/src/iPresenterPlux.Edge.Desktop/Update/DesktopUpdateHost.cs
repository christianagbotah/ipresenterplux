using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Desktop.Update;

internal static class DesktopUpdateHost
{
    public static void Attach(MainWindow window, string? updateHealthToken)
    {
        ArgumentNullException.ThrowIfNull(window);
        if (window.Content is not Control existingContent) return;

        var paths = ShellPaths.CreateDefault();
        var settingsStore = new DesktopSettingsStore(paths.SettingsDirectory);
        var updateDirectory = Path.Combine(paths.SettingsDirectory, "Updates");
        var stateStore = new UpdateStateStore(updateDirectory);
        var httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        var workflow = new VpsUpdateStagingWorkflow(
            httpClient,
            UpdatePublicKeyCatalog.Load(),
            Path.Combine(updateDirectory, "staging"));
        var coordinator = new IpresenterUpdateCoordinator(workflow, stateStore);
        var localClient = new LocalOperatorClient(paths.EdgeDataDirectory, TimeSpan.FromSeconds(2));
        var status = new MenuItem
        {
            Header = "Updates · waiting",
            IsEnabled = false
        };
        var detail = new MenuItem
        {
            Header = $"Version {CurrentVersion()}",
            IsEnabled = false
        };
        var check = new MenuItem
        {
            Header = "Check for updates"
        };
        var install = new MenuItem
        {
            Header = "Restart & install",
            IsEnabled = false
        };
        var about = new MenuItem
        {
            Header = "About"
        };
        about.ItemsSource = new object[] { status, detail, new Separator(), check, install };
        var menu = new Menu
        {
            ItemsSource = new object[] { about },
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 0, 10, 0),
            Background = new SolidColorBrush(Color.Parse("#070A0F"))
        };
        var root = new Grid();
        window.Content = null;
        root.Children.Add(existingContent);
        root.Children.Add(menu);
        window.Content = root;

        var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        var busy = false;
        var installRoot = DesktopInstallLayout.TryResolveInstallRoot(AppContext.BaseDirectory);

        void Render()
        {
            status.Header = coordinator.State switch
            {
                DesktopUpdateState.Checking => "Updates · checking",
                DesktopUpdateState.Downloading => "Updates · downloading & verifying",
                DesktopUpdateState.Ready => $"Update {coordinator.StagedUpdate?.Version} ready",
                DesktopUpdateState.WaitingForSafeRestart => $"Update {coordinator.StagedUpdate?.Version} ready · waiting for a safe restart",
                DesktopUpdateState.Installing => "Update · restarting to install",
                DesktopUpdateState.Succeeded => "Update · installed",
                DesktopUpdateState.FailedRolledBack => "Update · previous version restored",
                _ => "Updates · up to date"
            };
            detail.Header = coordinator.LastError ?? coordinator.State switch
            {
                DesktopUpdateState.WaitingForSafeRestart => "Finish Program/recording before install.",
                DesktopUpdateState.Ready when installRoot is null => "Verified update; managed install unavailable.",
                DesktopUpdateState.Ready => "Verified update ready to install.",
                DesktopUpdateState.Downloading => "Downloading and verifying package.",
                _ => $"Version {CurrentVersion()}"
            };
            check.IsEnabled = OperatingSystem.IsWindows() &&
                              coordinator.State is not DesktopUpdateState.Checking and
                                  not DesktopUpdateState.Downloading and
                                  not DesktopUpdateState.Installing;
            install.IsEnabled = OperatingSystem.IsWindows() && installRoot is not null && coordinator.CanRestartAndInstall;
        }

        async Task<DesktopSettings> LoadSettingsAsync()
        {
            var settings = await settingsStore.LoadAsync(CancellationToken.None).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(settings.InstallationId))
                settings = settings with { InstallationId = Guid.NewGuid().ToString("N") };
            if (string.IsNullOrWhiteSpace(settings.UpdateHubUrl))
                settings = settings with { UpdateHubUrl = "https://updates.lightworldtech.com" };
            if (string.IsNullOrWhiteSpace(settings.UpdateChannel))
                settings = settings with { UpdateChannel = "stable" };
            return settings.NormalizeUpdateSettings();
        }

        async Task ProbeLocalBootstrapAsync()
        {
            try { _ = await localClient.QueryAsync(CancellationToken.None).ConfigureAwait(false); }
            catch { }
        }

        async Task<(LocalOperatorSnapshot Local, EdgeDesktopSnapshot Runtime)> SafetyAsync()
        {
            try
            {
                var response = await localClient.QueryAsync(CancellationToken.None).ConfigureAwait(false);
                return (response.Snapshot, RuntimeSnapshot(false));
            }
            catch
            {
                var runtimePresent = IsEdgeRuntimePresent();
                var local = new LocalOperatorSnapshot(
                    false, null, null, false, null, "Offline", null, "rehearsal", DateTimeOffset.UtcNow);
                return (local, RuntimeSnapshot(runtimePresent));
            }
        }

        async Task CheckAsync()
        {
            if (busy || !OperatingSystem.IsWindows()) return;
            busy = true;
            try
            {
                var settings = await LoadSettingsAsync().ConfigureAwait(false);
                var safety = await SafetyAsync().ConfigureAwait(false);
                await coordinator.CheckAsync(settings, CurrentVersion(), safety.Local, safety.Runtime, CancellationToken.None)
                    .ConfigureAwait(false);
            }
            finally
            {
                busy = false;
                await Dispatcher.UIThread.InvokeAsync(Render);
            }
        }

        check.Click += async (_, _) => await CheckAsync();
        install.Click += async (_, _) =>
        {
            if (busy || installRoot is null) return;
            busy = true;
            try
            {
                var safety = await SafetyAsync().ConfigureAwait(false);
                coordinator.RefreshSafety(safety.Local, safety.Runtime);
                if (!coordinator.CanRestartAndInstall) return;
                var planPath = await coordinator.PrepareApplyPlanAsync(
                    CurrentVersion(),
                    installRoot,
                    "iPresenterPlux.Edge.Desktop.exe",
                    CancellationToken.None).ConfigureAwait(false);
                var helper = coordinator.LaunchApplyHelper(installRoot, planPath);
                if (helper is null) return;
                helper.Dispose();
                await Dispatcher.UIThread.InvokeAsync(window.Close);
            }
            finally
            {
                busy = false;
                await Dispatcher.UIThread.InvokeAsync(Render);
            }
        };

        timer.Tick += async (_, _) =>
        {
            if (busy || coordinator.StagedUpdate is null) return;
            var safety = await SafetyAsync().ConfigureAwait(false);
            coordinator.RefreshSafety(safety.Local, safety.Runtime);
            Render();
        };
        coordinator.StateChanged += (_, _) => Dispatcher.UIThread.Post(Render);

        window.Opened += async (_, _) =>
        {
            var settingsTask = LoadSettingsAsync();
            var localBootstrapTask = ProbeLocalBootstrapAsync();
            if (!string.IsNullOrWhiteSpace(updateHealthToken) && installRoot is not null)
            {
                try
                {
                    await DesktopUpdateStartupHealth.ReportWhenReadyAsync(
                        settingsTask,
                        localBootstrapTask,
                        updateHealthToken,
                        installRoot,
                        CancellationToken.None).ConfigureAwait(false);
                }
                catch { }
            }

            var settings = await settingsTask.ConfigureAwait(false);
            await localBootstrapTask.ConfigureAwait(false);
            var safety = await SafetyAsync().ConfigureAwait(false);
            await coordinator.InitializeAsync(safety.Local, safety.Runtime, CancellationToken.None).ConfigureAwait(false);
            timer.Start();
            await Dispatcher.UIThread.InvokeAsync(Render);
            if (OperatingSystem.IsWindows())
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(2)).ConfigureAwait(false);
                    await CheckAsync().ConfigureAwait(false);
                }
                catch { }
            }
        };
        window.Closed += (_, _) =>
        {
            timer.Stop();
            httpClient.Dispose();
        };
        Render();
    }

    private static string CurrentVersion()
    {
        var version = typeof(MainWindow).Assembly.GetName().Version;
        if (version is null) return "1.0.0";
        return $"{Math.Max(version.Major, 0)}.{Math.Max(version.Minor, 0)}.{Math.Max(version.Build, 0)}";
    }

    private static EdgeDesktopSnapshot RuntimeSnapshot(bool critical) => new(
        critical ? EdgeDesktopRuntimeState.Active : EdgeDesktopRuntimeState.Stopped,
        null,
        null,
        false,
        false,
        null,
        DateTimeOffset.UtcNow,
        critical);

    private static bool IsEdgeRuntimePresent()
    {
        try
        {
            var processes = Process.GetProcessesByName("iPresenterPlux.Edge.Windows");
            try { return processes.Any(process => !process.HasExited); }
            finally { foreach (var process in processes) process.Dispose(); }
        }
        catch { return true; }
    }
}
