using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Desktop.Update;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class UpdateCoordinatorTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "ipresenterplux-update-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void DefaultSettingsUseStableLightworldUpdateHub()
    {
        var settings = DesktopSettings.CreateDefault();
        Assert.Equal("stable", settings.UpdateChannel);
        Assert.Equal("https://updates.lightworldtech.com", settings.UpdateHubUrl);
        Assert.DoesNotContain("ProductKey", string.Join(',', typeof(DesktopSettings).GetProperties().Select(p => p.Name)), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Token", string.Join(',', typeof(DesktopSettings).GetProperties().Select(p => p.Name)), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DownloadedUpdateWaitsUntilRestartIsSafe()
    {
        var staged = SampleUpdate("2.0.0");
        var coordinator = Coordinator(new FakeWorkflow(staged));
        await coordinator.CheckAsync(DesktopSettings.CreateDefault() with { ControlPlaneUrl = "https://control.example.test" }, "1.0.0", Local(recording: true), Runtime(), CancellationToken.None);
        Assert.Equal(DesktopUpdateState.WaitingForSafeRestart, coordinator.State);
        Assert.False(coordinator.CanRestartAndInstall);

        coordinator.RefreshSafety(Local(), Runtime());
        Assert.Equal(DesktopUpdateState.Ready, coordinator.State);
        Assert.True(coordinator.CanRestartAndInstall);
    }

    [Fact]
    public async Task NoLongerOfferedReleaseDiscardsPreviouslyStagedPackage()
    {
        var store = new UpdateStateStore(_directory);
        await store.SaveAsync(SampleUpdate("1.9.0"), CancellationToken.None);
        var coordinator = new IpresenterUpdateCoordinator(new FakeWorkflow(null), store);

        await coordinator.CheckAsync(DesktopSettings.CreateDefault() with { ControlPlaneUrl = "https://control.example.test" }, "1.8.0", Local(), Runtime(), CancellationToken.None);

        Assert.Equal(DesktopUpdateState.Idle, coordinator.State);
        Assert.Null(await store.LoadAsync(CancellationToken.None));
    }

    [Fact]
    public async Task StateStoreRoundTripsOnlyNonSecretStagedMetadata()
    {
        var store = new UpdateStateStore(_directory);
        var update = SampleUpdate("2.1.0");
        await store.SaveAsync(update, CancellationToken.None);
        var json = await File.ReadAllTextAsync(store.StatePath);
        var loaded = await store.LoadAsync(CancellationToken.None);

        Assert.Equal(update, loaded);
        Assert.DoesNotContain("productKey", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("bearer", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("privateKey", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task HealthMarkerWaitsForSettingsAndLocalBootstrap()
    {
        var installRoot = Path.Combine(_directory, "install");
        var settingsLoaded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var localBootstrap = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var token = "health_123";
        var marker = Path.Combine(installRoot, "state", $"health-{token}.ok");

        var report = DesktopUpdateStartupHealth.ReportWhenReadyAsync(
            settingsLoaded.Task,
            localBootstrap.Task,
            token,
            installRoot,
            CancellationToken.None);

        await Task.Delay(25);
        Assert.False(File.Exists(marker));
        settingsLoaded.SetResult();
        await Task.Delay(25);
        Assert.False(File.Exists(marker));
        localBootstrap.SetResult();
        await report;

        Assert.Equal(token, await File.ReadAllTextAsync(marker));
    }

    [Fact]
    public void ProgramAcceptsUpdateHealthTokenWithoutWritingMarkerDirectly()
    {
        var program = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "Program.cs"));
        Assert.Contains("--update-health-token", program, StringComparison.Ordinal);
        Assert.DoesNotContain("health-", program, StringComparison.OrdinalIgnoreCase);
    }

    private IpresenterUpdateCoordinator Coordinator(IUpdateStagingWorkflow workflow) =>
        new(workflow, new UpdateStateStore(_directory));

    private static StagedDesktopUpdate SampleUpdate(string version) => new(
        version,
        Path.Combine(Path.GetTempPath(), $"ipresenterplux-{version}.zip"),
        1234,
        new string('a', 64),
        "Release notes",
        DateTimeOffset.Parse("2026-10-21T00:00:00Z"));

    private static LocalOperatorSnapshot Local(bool recording = false) => new(
        false, null, null, recording, recording ? "recording-1" : null, "Online", null, "rehearsal", DateTimeOffset.UtcNow);

    private static EdgeDesktopSnapshot Runtime() => new(
        EdgeDesktopRuntimeState.Active, 1234, null, true, true, null, DateTimeOffset.UtcNow, false);

    private sealed class FakeWorkflow(StagedDesktopUpdate? result) : IUpdateStagingWorkflow
    {
        public Task<StagedDesktopUpdate?> CheckAndStageAsync(
            DesktopSettings settings,
            string currentVersion,
            CancellationToken cancellationToken) => Task.FromResult(result);
    }

    private static string FindSourceFile(params string[] pathParts)
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine([current.FullName, .. pathParts]);
            if (File.Exists(candidate)) return candidate;
            current = current.Parent;
        }
        throw new FileNotFoundException("Could not locate desktop source from the test output directory.");
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
