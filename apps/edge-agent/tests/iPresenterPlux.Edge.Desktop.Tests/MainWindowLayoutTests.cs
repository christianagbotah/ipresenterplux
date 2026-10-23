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
        Assert.Contains("MaxWidth = 560", source, StringComparison.Ordinal);
        Assert.Contains("MaxHeight = 315", source, StringComparison.Ordinal);
        Assert.Contains("Stretch = Stretch.Uniform", source, StringComparison.Ordinal);
        Assert.Contains("var root = new Grid { Margin = new Thickness(6), MinHeight = 420 }", source, StringComparison.Ordinal);
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

        Assert.Contains("var root = new Grid { Margin = new Thickness(6), MinHeight = 420 }", source, StringComparison.Ordinal);
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

        Assert.Contains("new GridLength(240)", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(250)", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(4)", source, StringComparison.Ordinal);
        Assert.Contains("MaxWidth = 560", source, StringComparison.Ordinal);
        Assert.Contains("MaxHeight = 315", source, StringComparison.Ordinal);
        Assert.Contains("var transitionActions = new WrapPanel", source, StringComparison.Ordinal);
        Assert.Contains("return root;", source, StringComparison.Ordinal);
        Assert.DoesNotContain("HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,\n            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,\n            Content = root", source, StringComparison.Ordinal);
    }

    [Fact]
    public void ScriptureLookupStacksVersionAndActionWithoutNarrowTwoColumnCollision()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_bibleVersion.MinHeight = 38", source, StringComparison.Ordinal);
        Assert.Contains("_resolveScripture.HorizontalAlignment = HorizontalAlignment.Stretch", source, StringComparison.Ordinal);
        Assert.Contains("var scriptureLookupControls = new Grid { RowSpacing = 8 }", source, StringComparison.Ordinal);
        Assert.Contains("Grid.SetRow(_resolveScripture, 1)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("var scriptureRow = new Grid { ColumnDefinitions = new ColumnDefinitions(\"*,Auto\"), ColumnSpacing = 8 }", source, StringComparison.Ordinal);
    }

    [Fact]
    public void PreviewAndProgramHugTheCenterWhileSidePanesGainUsableWidth()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("new GridLength(240)", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(250)", source, StringComparison.Ordinal);
        Assert.Contains("previewStage.HorizontalAlignment = HorizontalAlignment.Right", source, StringComparison.Ordinal);
        Assert.Contains("programStage.HorizontalAlignment = HorizontalAlignment.Left", source, StringComparison.Ordinal);
        Assert.Contains("var stages = new Grid { ColumnSpacing = 8, MinHeight = 180, MaxHeight = 330 }", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorProtectsLiveStagesFromGrowingDetailsContent()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("new RowDefinition(new GridLength(3, GridUnitType.Star)) { MinHeight = 180 }", source, StringComparison.Ordinal);
        Assert.Contains("new RowDefinition(new GridLength(2, GridUnitType.Star)) { MinHeight = 96 }", source, StringComparison.Ordinal);
        Assert.Contains("var detailsScroll = new ScrollViewer", source, StringComparison.Ordinal);
        Assert.Contains("VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto", source, StringComparison.Ordinal);
        Assert.Contains("var detailsCard = Card(\"Details & Bible browser\", detailsScroll)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("MaxHeight = 280", source, StringComparison.Ordinal);
    }

    [Fact]
    public void TransitionSafetyHintLivesOnDedicatedRowBelowActions()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var transitionContent = new StackPanel { Spacing = 4 }", source, StringComparison.Ordinal);
        Assert.Contains("transitionContent.Children.Add(transitionActions)", source, StringComparison.Ordinal);
        Assert.Contains("transitionContent.Children.Add(transitionHint)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("transitionActions.Children.Add(transitionHint)", source, StringComparison.Ordinal);
        Assert.Contains("transitionActions.Children.Add(openProgram)", source, StringComparison.Ordinal);
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
    public void SetupWorkspaceKeepsSidebarAndMainAsIndependentVerticalScrollSurfaces()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("MinWidth = 900", source, StringComparison.Ordinal);
        Assert.Contains("var sidebarScroll = new ScrollViewer", source, StringComparison.Ordinal);
        Assert.Contains("var mainScroll = new ScrollViewer", source, StringComparison.Ordinal);
        Assert.Contains("Grid.SetColumn(mainScroll, 2)", source, StringComparison.Ordinal);
        Assert.Contains("return root;", source, StringComparison.Ordinal);
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

    [Fact]
    public void RundownPointerGesturesPreviewOnSingleTapAndTakeOnDoubleTap()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_rundown.Tapped +=", source, StringComparison.Ordinal);
        Assert.Contains("_rundown.DoubleTapped +=", source, StringComparison.Ordinal);
        Assert.Contains("PreviewSelectedAndTakeAsync", source, StringComparison.Ordinal);
    }

    [Fact]
    public void ScriptureLookupExposesOfflineBibleManagerAndLocalFirstResolution()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("Bible Versions", source, StringComparison.Ordinal);
        Assert.Contains("_desktopBibleLibrary.ResolveAsync", source, StringComparison.Ordinal);
        Assert.Contains("RefreshBibleVersionChoices", source, StringComparison.Ordinal);
        Assert.DoesNotContain("var scriptureEnabled = _workspace.HasSyncedCatalog && _workspace.ServiceTitle is not null", source, StringComparison.Ordinal);
    }

    [Fact]
    public void SetupPairsEnrollmentFieldsAndScrollsSidebarAndMainIndependently()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("Field(\"Control Plane URL\", _controlUrl, 0, 0)", source, StringComparison.Ordinal);
        Assert.Contains("Field(\"One-time pairing code\", _pairingCode, 0, 1)", source, StringComparison.Ordinal);
        Assert.Contains("Field(\"Device name\", _deviceName, 1, 0)", source, StringComparison.Ordinal);
        Assert.Contains("Field(\"Program output display\", displayPicker, 1, 1)", source, StringComparison.Ordinal);
        Assert.Contains("var sidebarScroll = new ScrollViewer", source, StringComparison.Ordinal);
        Assert.Contains("var mainScroll = new ScrollViewer", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Content = root\n        };", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorHeartbeatDoesNotRebindLibraryWhenPreviewProgramIdentityIsUnchanged()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("OperatorPresentationChanged", source, StringComparison.Ordinal);
        Assert.Contains("var previousSnapshot = _operatorSnapshot", source, StringComparison.Ordinal);
        Assert.Contains("if (OperatorPresentationChanged(previousSnapshot, snapshot))", source, StringComparison.Ordinal);
        Assert.Contains("RefreshOperatorFeedback", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorSeparatesLibraryDetailsAndServiceSchedule()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("LIBRARY", source, StringComparison.Ordinal);
        Assert.Contains("SELECTED CONTENT", source, StringComparison.Ordinal);
        Assert.Contains("SERVICE SCHEDULE", source, StringComparison.Ordinal);
        Assert.Contains("_libraryResults", source, StringComparison.Ordinal);
        Assert.Contains("_schedule", source, StringComparison.Ordinal);
        Assert.Contains("Add Selected", source, StringComparison.Ordinal);
        Assert.Contains("Move Up", source, StringComparison.Ordinal);
        Assert.Contains("Move Down", source, StringComparison.Ordinal);
    }

    [Fact]
    public void ScriptureDetailsExposeBookChapterAndVerseBrowser()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_browserBook", source, StringComparison.Ordinal);
        Assert.Contains("_browserChapter", source, StringComparison.Ordinal);
        Assert.Contains("_browserFromVerse", source, StringComparison.Ordinal);
        Assert.Contains("_browserToVerse", source, StringComparison.Ordinal);
        Assert.Contains("LoadBibleChapterAsync", source, StringComparison.Ordinal);
        Assert.Contains("Preview Verse Range", source, StringComparison.Ordinal);
    }

    [Fact]
    public void AiScriptureAutomationIsDiscoverableFromOperator()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("AI Scripture", source, StringComparison.Ordinal);
        Assert.Contains("Manual · Auto Preview · guarded Auto Live", source, StringComparison.Ordinal);
        Assert.Contains("CloudUri(\"/scripture\")", source, StringComparison.Ordinal);
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
