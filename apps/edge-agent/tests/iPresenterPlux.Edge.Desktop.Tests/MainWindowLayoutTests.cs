using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class MainWindowLayoutTests
{
    [Fact]
    public void OperatorWorkspaceUsesSixteenByNineStagesAndScrollSafeViewport()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("Width = 1600", source, StringComparison.Ordinal);
        Assert.Contains("Height = 900", source, StringComparison.Ordinal);
        Assert.Contains("Stretch = Stretch.Uniform", source, StringComparison.Ordinal);
        Assert.Contains("MinWidth = 1080", source, StringComparison.Ordinal);
        Assert.Contains("HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto", source, StringComparison.Ordinal);
        Assert.Contains("VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto", source, StringComparison.Ordinal);
        Assert.DoesNotContain("MinHeight = 330", source, StringComparison.Ordinal);
    }

    [Fact]
    public void NormalRestoreBoundsFitCommonLaptopWorkArea()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("Width = 1040", source, StringComparison.Ordinal);
        Assert.Contains("Height = 640", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Height = 720", source, StringComparison.Ordinal);
    }

    [Fact]
    public void SetupWorkspaceScrollsAsOneSurfaceInsteadOfClippingSidebar()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("MinWidth = 900", source, StringComparison.Ordinal);
        Assert.Contains("Content = root", source, StringComparison.Ordinal);
        Assert.Contains("Grid.SetColumn(main, 2)", source, StringComparison.Ordinal);
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

        throw new FileNotFoundException("Could not locate MainWindow.cs from the desktop test output directory.");
    }
}
