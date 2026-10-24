using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class MainWindowLayoutTests
{
    [Fact]
    public void OperatorWorkspaceUsesCompactSixteenByNineStages()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("Width = 640", source, StringComparison.Ordinal);
        Assert.Contains("Height = 360", source, StringComparison.Ordinal);
        Assert.Contains("MaxWidth = 320", source, StringComparison.Ordinal);
        Assert.Contains("MaxHeight = 180", source, StringComparison.Ordinal);
        Assert.Contains("Stretch = Stretch.Uniform", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(250)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("MaxWidth = 340", source, StringComparison.Ordinal);
        Assert.DoesNotContain("MaxHeight = 191", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorKeepsResourceTabsAndActionsFixedOutsideScrollSurfaces()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var categoryToolbar = new Grid", source, StringComparison.Ordinal);
        Assert.Contains("categoryToolbar.Children.Add(categoryBar)", source, StringComparison.Ordinal);
        Assert.Contains("categoryToolbar.Children.Add(_addSelectedToSchedule)", source, StringComparison.Ordinal);
        Assert.Contains("Child = libraryPanel", source, StringComparison.Ordinal);
        Assert.DoesNotContain("var resourceDeckScroll = new ScrollViewer", source, StringComparison.Ordinal);
        Assert.DoesNotContain("var detailsScroll = new ScrollViewer", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorGivesScheduleMoreWidthThanPreviewAndProgram()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("new GridLength(1.8, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(1, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.Contains("MaxWidth = 400", source, StringComparison.Ordinal);
        Assert.Contains("HorizontalAlignment = HorizontalAlignment.Center", source, StringComparison.Ordinal);
        Assert.DoesNotContain("production.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(230)))", source, StringComparison.Ordinal);
    }

    [Fact]
    public void ScriptureLookupStacksVersionAndActionWithoutNarrowTwoColumnCollision()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_bibleVersion.MinHeight = 36", source, StringComparison.Ordinal);
        Assert.Contains("Grid.SetColumn(_resolveScripture, 2)", source, StringComparison.Ordinal);
        Assert.Contains("var scriptureLookup = new Grid { ColumnSpacing = 6 }", source, StringComparison.Ordinal);
        Assert.Contains("Grid.SetColumn(_resolveScripture, 2)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("var scriptureRow = new Grid { ColumnDefinitions = new ColumnDefinitions(\"*,Auto\"), ColumnSpacing = 8 }", source, StringComparison.Ordinal);
    }

    [Fact]
    public void PreviewAndProgramCardsHugTheirStagesInsteadOfStretchingWide()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var previewPane = BuildProductionPane", source, StringComparison.Ordinal);
        Assert.Contains("var programPane = BuildProductionPane", source, StringComparison.Ordinal);
        Assert.Contains("MaxWidth = 400", source, StringComparison.Ordinal);
        Assert.Contains("Padding = new Thickness(8)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Safe staging — selecting content never changes the congregation screen.", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Exactly what the TV/projector is showing now.", source, StringComparison.Ordinal);
    }

    [Fact]
    public void TransitionSafetyHintLivesOnDedicatedRowBelowActions()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("previewActions.Children.Add(_take)", source, StringComparison.Ordinal);
        Assert.Contains("programActions.Children.Add(_clear)", source, StringComparison.Ordinal);
        Assert.Contains("programActions.Children.Add(openProgram)", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorHeaderUsesOneCompactRowWithoutDescriptiveCopy()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var headerGrid = new Grid { ColumnDefinitions = new ColumnDefinitions(\"Auto,*,Auto\"), ColumnSpacing = 12 }", source, StringComparison.Ordinal);
        Assert.Contains("Label(\"LIVE PRODUCTION\", 16, FontWeight.Bold)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("IPRESENTERPLUX · OPERATOR", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Schedule · Preview · Program stay visible while you search and browse resources", source, StringComparison.Ordinal);
        Assert.DoesNotContain("HeaderHint()", source, StringComparison.Ordinal);
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
    public void RundownPointerUsesExactClickedRowForPreviewAndDoubleClickLive()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_rundown.PointerPressed += OnLibraryPointerPressed", source, StringComparison.Ordinal);
        Assert.Contains("FindPointerRundownRow", source, StringComparison.Ordinal);
        Assert.Contains("args.ClickCount >= 2", source, StringComparison.Ordinal);
        Assert.Contains("PreviewItemAndTakeAsync(row.Item)", source, StringComparison.Ordinal);
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
    public void OperatorRemovesSelectedContentPanelButKeepsScheduleActions()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("RESOURCE DECK", source, StringComparison.Ordinal);
        Assert.Contains("SERVICE SCHEDULE", source, StringComparison.Ordinal);
        Assert.Contains("_libraryResults", source, StringComparison.Ordinal);
        Assert.Contains("_schedule", source, StringComparison.Ordinal);
        Assert.Contains("Add Selected", source, StringComparison.Ordinal);
        Assert.Contains("Move Up", source, StringComparison.Ordinal);
        Assert.Contains("Move Down", source, StringComparison.Ordinal);
        Assert.DoesNotContain("SELECTED CONTENT", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Selected content details will appear here", source, StringComparison.Ordinal);
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
    public void AiScriptureRemainsDiscoverableWithoutVerboseSelectedContentCopy()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("LinkButton(\"AI Scripture\", () => CloudUri(\"/scripture\"))", source, StringComparison.Ordinal);
        Assert.DoesNotContain("AI Scripture · Manual · Auto Preview · guarded Auto Live", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorKeepsSchedulePreviewProgramAboveFixedResourceDeckControls()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var production = new Grid", source, StringComparison.Ordinal);
        Assert.Contains("SERVICE SCHEDULE", source, StringComparison.Ordinal);
        Assert.Contains("var previewPane = BuildProductionPane", source, StringComparison.Ordinal);
        Assert.Contains("var programPane = BuildProductionPane", source, StringComparison.Ordinal);
        Assert.Contains("RESOURCE DECK", source, StringComparison.Ordinal);
        Assert.Contains("var categoryToolbar = new Grid", source, StringComparison.Ordinal);
        Assert.DoesNotContain("var resourceDeckScroll = new ScrollViewer", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorUsesPointerClickCountForExactRowPreviewAndLive()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_rundown.PointerPressed += OnLibraryPointerPressed", source, StringComparison.Ordinal);
        Assert.Contains("_schedule.PointerPressed += OnSchedulePointerPressed", source, StringComparison.Ordinal);
        Assert.Contains("args.ClickCount >= 2", source, StringComparison.Ordinal);
        Assert.Contains("FindPointerRundownRow", source, StringComparison.Ordinal);
        Assert.DoesNotContain("_rundown.Tapped +=", source, StringComparison.Ordinal);
        Assert.DoesNotContain("_rundown.DoubleTapped +=", source, StringComparison.Ordinal);
        Assert.DoesNotContain("_schedule.Tapped +=", source, StringComparison.Ordinal);
        Assert.DoesNotContain("_schedule.DoubleTapped +=", source, StringComparison.Ordinal);
    }


    [Fact]
    public void BibleManagerSupportsCatalogSearchAndLicenseRequiredRows()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "BibleVersionManagerWindow.cs"));

        Assert.Contains("Search Bible versions", source, StringComparison.Ordinal);
        Assert.Contains("DesktopBibleLibrary.Catalog", source, StringComparison.Ordinal);
        Assert.Contains("License/provider required", source, StringComparison.Ordinal);
        Assert.Contains("CanDownload", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorSurfacesAdvancedAiWorkspacesWithoutChangingProgramAuthority()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("LinkButton(\"AI Director\", () => CloudUri(\"/ai-director\"))", source, StringComparison.Ordinal);
        Assert.Contains("LinkButton(\"Translations\", () => CloudUri(\"/translations\"))", source, StringComparison.Ordinal);
        Assert.Contains("_microphoneStatus", source, StringComparison.Ordinal);
        Assert.Contains("_asrStatus", source, StringComparison.Ordinal);
        Assert.Contains("_voiceScriptureStatus", source, StringComparison.Ordinal);
        Assert.Contains("LocalOperatorCommands.ProgramTake", source, StringComparison.Ordinal);
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
