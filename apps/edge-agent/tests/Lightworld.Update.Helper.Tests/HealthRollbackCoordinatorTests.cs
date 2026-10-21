using Lightworld.Update.Helper;
using Xunit;

namespace Lightworld.Update.Helper.Tests;

public sealed class HealthRollbackCoordinatorTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "lightworld-health-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task MatchingHealthMarkerKeepsNewVersion()
    {
        SeedVersions("new", "old");
        var coordinator = new HealthRollbackCoordinator(_root);
        var token = "healthy-token";
        var marker = coordinator.HealthMarkerPath(token);
        Directory.CreateDirectory(Path.GetDirectoryName(marker)!);
        await File.WriteAllTextAsync(marker, token);

        var healthy = await coordinator.ConfirmOrRollbackAsync(token, TimeSpan.FromSeconds(1), () => true, CancellationToken.None);

        Assert.True(healthy);
        Assert.Equal("new", await File.ReadAllTextAsync(Path.Combine(_root, "current", "version.txt")));
    }

    [Fact]
    public async Task MissingHealthMarkerRollsBackAfterTimeout()
    {
        SeedVersions("broken", "good");
        var coordinator = new HealthRollbackCoordinator(_root, TimeSpan.FromMilliseconds(10));

        var healthy = await coordinator.ConfirmOrRollbackAsync("never", TimeSpan.FromMilliseconds(35), () => true, CancellationToken.None);

        Assert.False(healthy);
        Assert.Equal("good", await File.ReadAllTextAsync(Path.Combine(_root, "current", "version.txt")));
    }

    [Fact]
    public async Task ProcessStartFailureRollsBack()
    {
        SeedVersions("broken", "good");
        var coordinator = new HealthRollbackCoordinator(_root);

        var healthy = await coordinator.LaunchAndConfirmAsync(
            new UpdatePlan("ipresenterplux", "1.0.0", "1.1.0", "unused.zip", _root, "iPresenterPlux.Edge.Desktop.exe", "launch-fail", 1, 0, new string('0', 64)),
            _ => throw new InvalidOperationException("simulated start failure"),
            CancellationToken.None);

        Assert.False(healthy);
        Assert.Equal("good", await File.ReadAllTextAsync(Path.Combine(_root, "current", "version.txt")));
    }

    private void SeedVersions(string current, string previous)
    {
        Directory.CreateDirectory(Path.Combine(_root, "current"));
        Directory.CreateDirectory(Path.Combine(_root, "previous"));
        File.WriteAllText(Path.Combine(_root, "current", "version.txt"), current);
        File.WriteAllText(Path.Combine(_root, "previous", "version.txt"), previous);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}
