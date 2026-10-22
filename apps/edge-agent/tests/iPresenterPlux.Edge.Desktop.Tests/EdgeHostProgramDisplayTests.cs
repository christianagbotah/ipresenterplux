using iPresenterPlux.Edge.Desktop;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class EdgeHostProgramDisplayTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ipresenterplux-startinfo-display", Guid.NewGuid().ToString("N"));

    [Fact]
    public void SelectedDisplayIsPassedToManagedKioskRuntime()
    {
        var paths = Paths();
        var settings = new DesktopSettings(
            "https://control.example.test",
            "Sanctuary Edge",
            ProgramDisplayId: "projector",
            ProgramDisplayX: 1920,
            ProgramDisplayY: -10,
            ProgramDisplayWidth: 1920,
            ProgramDisplayHeight: 1080);

        var start = EdgeHostStartInfoFactory.Create(paths, settings, null);

        Assert.Equal("true", start.Environment["IPRESENTERPLUX_PROGRAM_AUTO_OPEN"]);
        Assert.Equal("1920,-10", start.Environment["IPRESENTERPLUX_PROGRAM_POSITION"]);
        Assert.Equal("1920,1080", start.Environment["IPRESENTERPLUX_PROGRAM_SIZE"]);
    }

    [Fact]
    public void RuntimeDoesNotAutoOpenKioskWithoutResolvedDisplay()
    {
        var paths = Paths();
        var settings = new DesktopSettings("https://control.example.test", "Sanctuary Edge");

        var start = EdgeHostStartInfoFactory.Create(paths, settings, null);

        Assert.Equal("false", start.Environment["IPRESENTERPLUX_PROGRAM_AUTO_OPEN"]);
        Assert.False(start.Environment.ContainsKey("IPRESENTERPLUX_PROGRAM_POSITION"));
        Assert.False(start.Environment.ContainsKey("IPRESENTERPLUX_PROGRAM_SIZE"));
    }

    private ShellPaths Paths()
    {
        Directory.CreateDirectory(_root);
        var runtime = Path.Combine(_root, OperatingSystem.IsWindows() ? "edge.exe" : "edge");
        File.WriteAllText(runtime, "fixture");
        return new ShellPaths(Path.Combine(_root, "settings"), Path.Combine(_root, "edge-data"), runtime);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
