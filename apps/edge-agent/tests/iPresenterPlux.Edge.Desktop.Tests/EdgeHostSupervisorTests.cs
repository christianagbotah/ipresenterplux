using System.Collections;
using System.Diagnostics;
using iPresenterPlux.Edge.Desktop;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class EdgeHostSupervisorTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(), "ipresenterplux-desktop-supervisor-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task StartPassesPairingOnlyThroughTransientChildEnvironment()
    {
        var paths = Paths();
        var factory = new FakeProcessFactory();
        var health = new FakeHealthProbe(new EdgeHealthProbeResult(true, true));
        await using var supervisor = new EdgeHostSupervisor(paths, factory, health);
        var pairing = "PAIR-ONLY-ONCE-4491";

        await supervisor.StartAsync(Settings(), pairing);
        await EventuallyAsync(() => supervisor.Snapshot.State == EdgeDesktopRuntimeState.Active);

        Assert.NotNull(factory.EnvironmentAtStart);
        Assert.Equal(pairing, factory.EnvironmentAtStart!["IPRESENTERPLUX_PAIRING_CODE"]);
        Assert.DoesNotContain(pairing, factory.FileNameAtStart ?? "", StringComparison.Ordinal);
        Assert.Empty(factory.ArgumentsAtStart ?? []);
        Assert.Equal(EdgeDesktopRuntimeState.Active, supervisor.Snapshot.State);
        Assert.True(supervisor.Snapshot.ControlPlaneHealthy);
        Assert.True(supervisor.Snapshot.LocalProgramHealthy);
    }

    [Fact]
    public async Task StopRequestsGracefulFileSignalBeforeAnyForceKill()
    {
        var paths = Paths();
        var factory = new FakeProcessFactory();
        await using var supervisor = new EdgeHostSupervisor(
            paths,
            factory,
            new FakeHealthProbe(new EdgeHealthProbeResult(true, true)));
        await supervisor.StartAsync(Settings(), null);
        await EventuallyAsync(() => factory.Process is not null);

        var stop = supervisor.StopAsync();
        var requestPath = Path.Combine(paths.EdgeDataDirectory, "desktop-shutdown.request");
        await EventuallyAsync(() => File.Exists(requestPath));
        Assert.False(factory.Process!.KillCalled);
        factory.Process.Complete(0);
        await stop;

        Assert.False(factory.Process.KillCalled);
        Assert.Equal(EdgeDesktopRuntimeState.Stopped, supervisor.Snapshot.State);
    }

    [Theory]
    [InlineData(0, EdgeDesktopRuntimeState.Stopped)]
    [InlineData(2, EdgeDesktopRuntimeState.ConfigurationError)]
    [InlineData(3, EdgeDesktopRuntimeState.EnrollmentRequired)]
    [InlineData(4, EdgeDesktopRuntimeState.AlreadyRunning)]
    [InlineData(9, EdgeDesktopRuntimeState.Crashed)]
    public void ExitCodesMapToBoundedOperatorStates(int exitCode, EdgeDesktopRuntimeState expected)
    {
        Assert.Equal(expected, EdgeHostSupervisor.MapExitState(exitCode));
    }

    [Fact]
    public async Task CloudLossDegradesWithoutStoppingLocalRuntime()
    {
        var paths = Paths();
        var factory = new FakeProcessFactory();
        var health = new FakeHealthProbe(new EdgeHealthProbeResult(false, true));
        await using var supervisor = new EdgeHostSupervisor(paths, factory, health);

        await supervisor.StartAsync(Settings(), null);
        await EventuallyAsync(() => supervisor.Snapshot.State == EdgeDesktopRuntimeState.Degraded);

        Assert.False(factory.Process!.HasExited);
        Assert.True(supervisor.Snapshot.LocalProgramHealthy);
        Assert.False(supervisor.Snapshot.ControlPlaneHealthy);
        factory.Process.Complete(0);
    }

    private ShellPaths Paths()
    {
        Directory.CreateDirectory(_root);
        var runtime = Path.Combine(_root, OperatingSystem.IsWindows() ? "edge.exe" : "edge");
        File.WriteAllText(runtime, "fixture");
        return new ShellPaths(
            Path.Combine(_root, "settings"),
            Path.Combine(_root, "edge-data"),
            runtime);
    }

    private static DesktopSettings Settings() => new("https://control.example.test", "Sanctuary Edge");

    private static async Task EventuallyAsync(Func<bool> condition)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(3);
        while (!condition())
        {
            if (DateTimeOffset.UtcNow >= deadline) throw new TimeoutException("Condition was not met.");
            await Task.Delay(25);
        }
    }

    private sealed class FakeHealthProbe(EdgeHealthProbeResult result) : IEdgeHealthProbe
    {
        public Task<EdgeHealthProbeResult> ProbeAsync(Uri controlPlane, int programPort, CancellationToken cancellationToken) =>
            Task.FromResult(result);
    }

    private sealed class FakeProcessFactory : IEdgeChildProcessFactory
    {
        public FakeProcess? Process { get; private set; }
        public Dictionary<string, string?>? EnvironmentAtStart { get; private set; }
        public string? FileNameAtStart { get; private set; }
        public IReadOnlyList<string>? ArgumentsAtStart { get; private set; }

        public IEdgeChildProcess Start(ProcessStartInfo startInfo)
        {
            EnvironmentAtStart = startInfo.Environment.ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal);
            FileNameAtStart = startInfo.FileName;
            ArgumentsAtStart = startInfo.ArgumentList.ToArray();
            Process = new FakeProcess();
            return Process;
        }
    }

    private sealed class FakeProcess : IEdgeChildProcess
    {
        private readonly TaskCompletionSource _exit = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _exitCode;
        public int Id => 4242;
        public bool HasExited => _exit.Task.IsCompleted;
        public int ExitCode => HasExited ? _exitCode : throw new InvalidOperationException("Process has not exited.");
        public bool KillCalled { get; private set; }

        public Task WaitForExitAsync(CancellationToken cancellationToken) => _exit.Task.WaitAsync(cancellationToken);
        public void Kill(bool entireProcessTree)
        {
            KillCalled = true;
            Complete(-1);
        }
        public void Complete(int exitCode)
        {
            _exitCode = exitCode;
            _exit.TrySetResult();
        }
        public void Dispose() { }
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
