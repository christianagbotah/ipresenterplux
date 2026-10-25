using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class MainWindowLayoutTests
{
    [Fact]
    public void OperatorWorkspaceUsesResizableProductionConsoleAndScalableSixteenByNineStages()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("Width = 640", source, StringComparison.Ordinal);
        Assert.Contains("Height = 360", source, StringComparison.Ordinal);
        Assert.Contains("Stretch = Stretch.Uniform", source, StringComparison.Ordinal);
        Assert.Contains("HorizontalAlignment = HorizontalAlignment.Stretch", source, StringComparison.Ordinal);
        Assert.Contains("VerticalAlignment = VerticalAlignment.Stretch", source, StringComparison.Ordinal);
        Assert.Contains("GridResizeDirection.Columns", source, StringComparison.Ordinal);
        Assert.Contains("GridResizeDirection.Rows", source, StringComparison.Ordinal);
        Assert.DoesNotContain("MaxWidth = 320", source, StringComparison.Ordinal);
        Assert.DoesNotContain("MaxHeight = 180", source, StringComparison.Ordinal);
        Assert.DoesNotContain("MaxWidth = 400", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorUsesTwoVerticalSplittersAndOneHorizontalSplitter()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var schedulePreviewSplitter = ProductionSplitter(GridResizeDirection.Columns)", source, StringComparison.Ordinal);
        Assert.Contains("var previewProgramSplitter = ProductionSplitter(GridResizeDirection.Columns)", source, StringComparison.Ordinal);
        Assert.Contains("var productionResourceSplitter = ProductionSplitter(GridResizeDirection.Rows)", source, StringComparison.Ordinal);
        Assert.Contains("GridResizeBehavior.PreviousAndNext", source, StringComparison.Ordinal);
        Assert.Contains("MinWidth = 180", source, StringComparison.Ordinal);
        Assert.Contains("MinWidth = 240", source, StringComparison.Ordinal);
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
    public void OperatorDefaultsToNarrowScheduleAndBalancedPreviewProgram()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("new GridLength(0.72, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(1.14, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(5)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("new GridLength(1.8, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("HorizontalAlignment = HorizontalAlignment.Center,\n            Child = grid", source, StringComparison.Ordinal);
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
    public void PreviewAndProgramUseFlatStretchingToolPanes()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var previewPane = BuildProductionPane", source, StringComparison.Ordinal);
        Assert.Contains("var programPane = BuildProductionPane", source, StringComparison.Ordinal);
        Assert.Contains("CornerRadius = new CornerRadius(8)", source, StringComparison.Ordinal);
        Assert.Contains("HorizontalAlignment = HorizontalAlignment.Stretch", source, StringComparison.Ordinal);
        Assert.DoesNotContain("MaxWidth = 400", source, StringComparison.Ordinal);
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

    [Fact]
    public void OperatorRendersRichScheduleAndLibraryRowsWithStateChips()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));
        var rows = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "OperatorRowTemplates.cs"));

        Assert.Contains("ItemTemplate = OperatorRowTemplates.ScheduleRowTemplate()", source, StringComparison.Ordinal);
        Assert.Contains("ItemTemplate = OperatorRowTemplates.LibraryRowTemplate()", source, StringComparison.Ordinal);
        Assert.Contains("\"LIVE\"", rows, StringComparison.Ordinal);
        Assert.Contains("\"PREVIEW\"", rows, StringComparison.Ordinal);
        Assert.Contains("\"NEXT\"", rows, StringComparison.Ordinal);
        // The preview/take semantics stay owned by the hosting list boxes.
        Assert.Contains("_rundown.PointerPressed += OnLibraryPointerPressed", source, StringComparison.Ordinal);
        Assert.Contains("_schedule.PointerPressed += OnSchedulePointerPressed", source, StringComparison.Ordinal);
    }

    [Fact]
    public void ProgramStageCarriesLiveBadgeAndRedLiveAccentWhilePreviewStaysGold()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("BuildStage(\"PROGRAM\", _programTitle, _programBody, _programFooter, Live, _programLiveBadge)", source, StringComparison.Ordinal);
        Assert.Contains("BuildStage(\"PREVIEW\", _previewTitle, _previewBody, _previewFooter, Gold)", source, StringComparison.Ordinal);
        Assert.Contains("_programLiveBadge.IsVisible = snapshot.Program is not null", source, StringComparison.Ordinal);
        Assert.Contains("_programLiveBadge.IsVisible = false", source, StringComparison.Ordinal);
        Assert.Contains("● LIVE", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorWiresStatusStripAndVoiceScriptureChip()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_operatorRuntime, _operatorRecording, _microphoneStatus, _asrStatus, _voiceScriptureStatus", source, StringComparison.Ordinal);
        Assert.Contains("statusStrip.Children.Add(_operatorFeedback)", source, StringComparison.Ordinal);
        Assert.Contains("Grid.SetRow(statusBar, 4)", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OfflineBibleBrowserIsReachableFromTheResourceDeck()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("Grid.SetRow(_scriptureBrowserPanel, 4)", source, StringComparison.Ordinal);
        Assert.Contains("BuildScriptureBrowserPanel()", source, StringComparison.Ordinal);
        Assert.Contains("_scriptureBrowserPanel.IsVisible = !_scriptureBrowserPanel.IsVisible", source, StringComparison.Ordinal);
        Assert.Contains("Preview Verse Range", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorWorkspaceSupportsCollapsePresetsAndPersistedSplitters()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("SetSchedulePaneCollapsed", source, StringComparison.Ordinal);
        Assert.Contains("SetResourceDeckCollapsed", source, StringComparison.Ordinal);
        Assert.Contains("ApplyWorkspacePreset", source, StringComparison.Ordinal);
        Assert.Contains("ResetWorkspaceLayout", source, StringComparison.Ordinal);
        Assert.Contains("ApplySavedWorkspaceLayout", source, StringComparison.Ordinal);
        Assert.Contains("PersistWorkspaceLayout", source, StringComparison.Ordinal);
        Assert.Contains("OperatorWorkspaceLayouts.FromActualBounds", source, StringComparison.Ordinal);
    }

    [Fact]
    public void ConsoleChromeKeepsCompactMetricsWithoutChangingBehavior()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("ApplyConsoleChrome()", source, StringComparison.Ordinal);
        Assert.Contains("Resources[\"SystemAccentColor\"] = Color.Parse(\"#D7A94A\")", source, StringComparison.Ordinal);
        Assert.Contains("x.OfType<ListBoxItem>().Class(\":selected\")", source, StringComparison.Ordinal);
        Assert.Contains("x.OfType<TabStripItem>()", source, StringComparison.Ordinal);
        // Safety copy stays available where Take happens.
        Assert.Contains("ToolTip.SetTip(_take, \"Preview is safe · Take is explicit · Clear never stops Edge (F8).\")", source, StringComparison.Ordinal);
    }

    [Fact]
    public void EmptyStatesAndCatalogStatusAreSurfaced()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_libraryEmptyHint.IsVisible = libraryState.Rows.Count == 0", source, StringComparison.Ordinal);
        Assert.Contains("_scheduleEmptyHint.IsVisible = scheduleState.Rows.Count == 0", source, StringComparison.Ordinal);
        Assert.Contains("_catalogStatus.Text = _workspace.StatusLabel", source, StringComparison.Ordinal);
        Assert.Contains("_catalogService.Text = _workspace.ServiceTitle", source, StringComparison.Ordinal);
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
