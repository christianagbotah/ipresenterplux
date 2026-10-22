using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class MainWindowLayoutTests
{
    [Fact]
    public void OperatorWorkspaceUsesSixteenByNineStagesAndScrollSafeViewport()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("Width = 640", source, StringComparison.Ordinal);
        Assert.Contains("Height = 360", source, StringComparison.Ordinal);
        Assert.Contains("MaxWidth = 300", source, StringComparison.Ordinal);
        Assert.Contains("MaxHeight = 169", source, StringComparison.Ordinal);
        Assert.Contains("Stretch = Stretch.Uniform", source, StringComparison.Ordinal);
        Assert.Contains("var root = new Grid { Margin = new Thickness(14), MinHeight = 420 }", source, StringComparison.Ordinal);
        Assert.Contains("VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Width = 1600", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Height = 900", source, StringComparison.Ordinal);
        Assert.DoesNotContain("MinWidth = 1080", source, StringComparison.Ordinal);
        Assert.DoesNotContain("MinHeight = 330", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorKeepsOuterViewportFixedAndScrollsSidePanelsInternally()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var root = new Grid { Margin = new Thickness(14), MinHeight = 420 }", source, StringComparison.Ordinal);
        Assert.Contains("_rundown.MinHeight = 160", source, StringComparison.Ordinal);
        Assert.Contains("var left = new ScrollViewer", source, StringComparison.Ordinal);
        Assert.Contains("var right = new ScrollViewer", source, StringComparison.Ordinal);
        Assert.Contains("HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled", source, StringComparison.Ordinal);
        Assert.Contains("return root;", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorFitsViewportWithoutOuterHorizontalScrolling()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("new GridLength(220)", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(230)", source, StringComparison.Ordinal);
        Assert.Contains("MaxWidth = 300", source, StringComparison.Ordinal);
        Assert.Contains("MaxHeight = 169", source, StringComparison.Ordinal);
        Assert.Contains("var transitionActions = new WrapPanel", source, StringComparison.Ordinal);
        Assert.Contains("return root;", source, StringComparison.Ordinal);
        Assert.DoesNotContain("HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,\n            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,\n            Content = root", source, StringComparison.Ordinal);
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

    [Fact]
    public void SetupExposesPersistedProgramDisplaySelectionAndHotplugRefresh()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("Program output display", source, StringComparison.Ordinal);
        Assert.Contains("Screens.All", source, StringComparison.Ordinal);
        Assert.Contains("Screens.Changed", source, StringComparison.Ordinal);
        Assert.Contains("ProgramDisplaySelector.Resolve", source, StringComparison.Ordinal);
        Assert.Contains("_programDisplay", source, StringComparison.Ordinal);
    }

    [Fact]
    public void SyncedRundownPreviewUsesItemIdentityInsteadOfSerializedPresentation()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("item.IsSynced", source, StringComparison.Ordinal);
        Assert.Contains("PreparePreviewItemAsync(item.Id", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorMediaTransportAppearsOnlyForDynamicProgramMediaAndKeepsExistingHotkeys()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_mediaPause", source, StringComparison.Ordinal);
        Assert.Contains("_mediaResume", source, StringComparison.Ordinal);
        Assert.Contains("_mediaSeek", source, StringComparison.Ordinal);
        Assert.Contains("IsDynamicProgramMedia", source, StringComparison.Ordinal);
        Assert.Contains("LocalOperatorCommands.MediaPause", source, StringComparison.Ordinal);
        Assert.Contains("LocalOperatorCommands.MediaResume", source, StringComparison.Ordinal);
        Assert.Contains("SeekMediaAsync", source, StringComparison.Ordinal);
        Assert.Contains("if (args.Key == Key.F8) _ = TakeAsync();", source, StringComparison.Ordinal);
        Assert.Contains("if (args.Key == Key.F7) _ = ClearProgramAsync();", source, StringComparison.Ordinal);
        Assert.Contains("if (args.Key == Key.F6) _ = PreviewSelectedAsync();", source, StringComparison.Ordinal);
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
