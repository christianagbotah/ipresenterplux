using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class ProgramDisplayTests
{
    [Fact]
    public async Task KioskLauncherRejectsRemoteUrlsAndGracefullyHandlesMissingBrowser()
    {
        var directory = TempDirectory();
        try
        {
            await using var launcher = new ChromiumKioskLauncher(Array.Empty<string>(), directory);
            await Assert.ThrowsAsync<ArgumentException>(() =>
                launcher.LaunchAsync(new Uri("https://example.com/program"), cancellationToken: CancellationToken.None));

            var launched = await launcher.LaunchAsync(
                new Uri("http://127.0.0.1:49321/program"), cancellationToken: CancellationToken.None);
            Assert.False(launched);
            Assert.False(launcher.IsRunning);
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    [Fact]
    public void DisplayConfigurationParsesProjectorPlacement()
    {
        var previousAuto = Environment.GetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_AUTO_OPEN");
        var previousPosition = Environment.GetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_POSITION");
        var previousSize = Environment.GetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_SIZE");
        var previousBrowser = Environment.GetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_BROWSER_PATH");
        try
        {
            Environment.SetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_AUTO_OPEN", "yes");
            Environment.SetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_POSITION", "1920,-10");
            Environment.SetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_SIZE", "1920,1080");
            Environment.SetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_BROWSER_PATH", "/browser/path");

            var configuration = ProgramDisplayConfiguration.FromEnvironment(defaultAutoOpen: false);

            Assert.True(configuration.AutoOpen);
            Assert.Equal("/browser/path", configuration.BrowserPath);
            Assert.Equal(1920, configuration.Placement?.X);
            Assert.Equal(-10, configuration.Placement?.Y);
            Assert.Equal(1920, configuration.Placement?.Width);
            Assert.Equal(1080, configuration.Placement?.Height);
        }
        finally
        {
            Environment.SetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_AUTO_OPEN", previousAuto);
            Environment.SetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_POSITION", previousPosition);
            Environment.SetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_SIZE", previousSize);
            Environment.SetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_BROWSER_PATH", previousBrowser);
        }
    }

    private static string TempDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenterplux-display-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        return directory;
    }
}
