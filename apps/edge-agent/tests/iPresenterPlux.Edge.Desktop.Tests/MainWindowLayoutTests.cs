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
    public void OperatorUsesSidebarSplitterTakeSeamAndDeckSplitter()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var sidebarPreviewSplitter = ProductionSplitter(GridResizeDirection.Columns)", source, StringComparison.Ordinal);
        Assert.Contains("var seamSplitter = ProductionSplitter(GridResizeDirection.Columns)", source, StringComparison.Ordinal);
        Assert.Contains("var deckSplitter = ProductionSplitter(GridResizeDirection.Rows)", source, StringComparison.Ordinal);
        Assert.Contains("GridResizeBehavior.PreviousAndNext", source, StringComparison.Ordinal);
        Assert.Contains("MinWidth = 220", source, StringComparison.Ordinal);
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
    public void OperatorDefaultsToLibrarySidebarSixtyFortyStageAndTallerDeck()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        // 52px rail, 60/40 stage monitors, deck slightly taller than the stage.
        Assert.Contains("new ColumnDefinition(new GridLength(64))", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(2.15, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(1.45, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(1.32, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.Contains("new GridLength(5)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("new GridLength(0.72, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("new GridLength(1.14, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("new GridLength(1.8, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("HorizontalAlignment = HorizontalAlignment.Center,\n            Child = grid", source, StringComparison.Ordinal);
    }

    [Fact]
    public void ScriptureLookupStacksVersionAndActionWithoutNarrowTwoColumnCollision()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_bibleVersion.MinHeight = 36", source, StringComparison.Ordinal);
        // v2.2: the lookup is two rows (version + reference, then actions) so a
        // narrow deck pane can never collide the inputs with the buttons.
        Assert.Contains("var scriptureLookup = new Grid { RowSpacing = 6, ColumnSpacing = 6 }", source, StringComparison.Ordinal);
        Assert.Contains("lookupActions.Children.Add(_resolveScripture)", source, StringComparison.Ordinal);
        Assert.Contains("lookupActions.Children.Add(_manageBibleVersions)", source, StringComparison.Ordinal);
        Assert.Contains("Grid.SetColumnSpan(lookupActions, 2)", source, StringComparison.Ordinal);
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

        // TAKE lives on the central seam, NOT in the preview action row — adding it
        // to both double-parents the button and crashes startup (see
        // MainWindowVisualTreeTests).
        Assert.DoesNotContain("previewActions.Children.Add(_take)", source, StringComparison.Ordinal);
        Assert.Contains("previewActions.Children.Add(_prepare)", source, StringComparison.Ordinal);
        Assert.Contains("programActions.Children.Add(_clear)", source, StringComparison.Ordinal);
        Assert.Contains("programActions.Children.Add(openProgram)", source, StringComparison.Ordinal);
        // Start Recording lives ONLY in the command bar (next to GO LIVE) — the
        // program action row must not double-parent the same button instance.
        Assert.Contains("headerActions.Children.Add(_record)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("programActions.Children.Add(_record)", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorCommandBarCarriesBrandServiceTruthAndLiveControls()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var headerGrid = new Grid { ColumnDefinitions = new ColumnDefinitions(\"Auto,*,Auto\"), ColumnSpacing = 12 }", source, StringComparison.Ordinal);
        Assert.Contains("Label(\"iPresenterPlux\", 14, FontWeight.Bold)", source, StringComparison.Ordinal);
        Assert.Contains("OperatorTheme.Chip(\"STUDIO\", Gold", source, StringComparison.Ordinal);
        Assert.Contains("_goLive.Content = snapshot.OutputRunning ? \"END LIVE\" : \"GO LIVE\";", source, StringComparison.Ordinal);
        Assert.Contains("_studioClock.Text = DateTime.Now.ToString(\"HH:mm:ss\", CultureInfo.InvariantCulture);", source, StringComparison.Ordinal);
        Assert.DoesNotContain("LIVE PRODUCTION", source, StringComparison.Ordinal);
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
        Assert.Contains("_schedule.PointerPressed += OnSchedulePointerPressed", source, StringComparison.Ordinal);
        Assert.Contains("_upNext.PointerPressed += OnUpNextPointerPressed", source, StringComparison.Ordinal);
        Assert.Contains("FindPointerRundownRow", source, StringComparison.Ordinal);
        Assert.Contains("args.ClickCount >= 2", source, StringComparison.Ordinal);
        Assert.Contains("PreviewItemAndTakeAsync(row.Item)", source, StringComparison.Ordinal);
    }

    [Fact]
    public void BibleVersePointerStagesPreviewAndDoubleClickTakesProgram()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_browserVerses.PointerPressed += OnBibleVersePointerPressed", source, StringComparison.Ordinal);
        Assert.Contains("FindPointerBibleVerse", source, StringComparison.Ordinal);
        Assert.Contains("PreviewBrowserVerseAsync(verse)", source, StringComparison.Ordinal);
        Assert.Contains("PreviewBrowserVerseAndTakeAsync(verse)", source, StringComparison.Ordinal);
        Assert.Contains("args.ClickCount >= 2", source, StringComparison.Ordinal);
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
    public void OperatorKeepsSidebarStageAndPlayoutDeckInOneBodyGrid()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var body = new Grid", source, StringComparison.Ordinal);
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

        // v2.2: the AI links live on the icon rail as glyph buttons (the old
        // 11px word labels clipped mid-word at 52px); launching stays external
        // and Program authority stays with the operator.
        Assert.Contains("RailButton(\"✦\", \"AI DIR\", \"AI Director workspace on the Control Plane\")", source, StringComparison.Ordinal);
        Assert.Contains("RailButton(\"⇄\", \"TRANS\", \"AI translations workspace on the Control Plane\")", source, StringComparison.Ordinal);
        Assert.Contains("LaunchExternalUri(() => CloudUri(\"/ai-director\"))", source, StringComparison.Ordinal);
        Assert.Contains("LaunchExternalUri(() => CloudUri(\"/translations\"))", source, StringComparison.Ordinal);
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

        Assert.Contains("ItemTemplate = OperatorRowTemplates.ScheduleRowTemplate(BuildScheduleContextMenu)", source, StringComparison.Ordinal);
        Assert.Contains("ItemTemplate = OperatorRowTemplates.LibraryRowTemplate(BuildLibraryContextMenu)", source, StringComparison.Ordinal);
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
    public void OfflineBibleBrowserLivesInTheScriptureSidebarCard()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("Grid.SetRow(_scriptureBrowserPanel, 1)", source, StringComparison.Ordinal);
        Assert.Contains("BuildScriptureBrowserPanel()", source, StringComparison.Ordinal);
        Assert.Contains("_scriptureBrowserPanel.IsVisible = !_scriptureBrowserPanel.IsVisible", source, StringComparison.Ordinal);
        Assert.Contains("Preview Verse Range", source, StringComparison.Ordinal);
    }

    [Fact]
    public void OperatorWorkspaceSupportsCollapsePresetsAndPersistedSplitters()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("SetSidebarPaneCollapsed", source, StringComparison.Ordinal);
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
        Assert.Contains("Resources[\"SystemAccentColor\"] = Color.Parse(\"#E3B75C\")", source, StringComparison.Ordinal);
        Assert.Contains("x.OfType<ListBoxItem>().Class(\":selected\")", source, StringComparison.Ordinal);
        Assert.Contains("x.OfType<TabStripItem>()", source, StringComparison.Ordinal);
        // Safety copy stays available where Take happens.
        Assert.Contains("ToolTip.SetTip(_take, \"Preview is safe · Take is explicit (F8) · Clear never stops Edge (F7).\")", source, StringComparison.Ordinal);
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

    // --- Studio Shell v2.1: stage row, TAKE seam, playout deck ---

    [Fact]
    public void PlayoutDeckCarriesUpNextAndTitlesScriptureBelowTheStage()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("Grid.SetRow(playoutDeck, 2)", source, StringComparison.Ordinal);
        Assert.Contains("Grid.SetColumn(playoutDeck, 3)", source, StringComparison.Ordinal);
        Assert.Contains("Grid.SetColumnSpan(playoutDeck, 3)", source, StringComparison.Ordinal);
        Assert.Contains("Label(\"UP NEXT\", 9, FontWeight.Bold, Gold)", source, StringComparison.Ordinal);
        Assert.Contains("Label(\"TITLES & SCRIPTURE\", 9, FontWeight.Bold, Gold)", source, StringComparison.Ordinal);
        Assert.Contains("\"AUTO-FOLLOW\"", source, StringComparison.Ordinal);

        // The local heuristic "AI Director" engine was removed: AI recommendations
        // belong to the existing Control/AI system and must not be re-invented as a
        // second architecture inside the Edge desktop frontend.
        Assert.DoesNotContain("OperatorSuggestions", source, StringComparison.Ordinal);
        Assert.DoesNotContain("AI DIRECTOR", source, StringComparison.Ordinal);
        Assert.DoesNotContain("_suggestionsHost", source, StringComparison.Ordinal);
        Assert.DoesNotContain("RefreshSuggestions", source, StringComparison.Ordinal);
    }

    [Fact]
    public void TakeSitsOnTheResizableSeamBetweenPreviewAndProgram()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var seam = new Grid { MinWidth = 64, Children = { seamSplitter, takeStack } }", source, StringComparison.Ordinal);
        Assert.Contains("Grid.SetColumn(seam, 4)", source, StringComparison.Ordinal);
        Assert.Contains("_take.Content = \"TAKE\"", source, StringComparison.Ordinal);
        Assert.Contains("Children = { _take, takeHint }", source, StringComparison.Ordinal);
        // TAKE must live ONLY on the central seam. Adding it to previewActions as
        // well double-parents the button and crashes MainWindow at startup.
        Assert.DoesNotContain("previewActions.Children.Add(_take)", source, StringComparison.Ordinal);
    }

    [Fact]
    public void RailSwitchesSidebarModesAndKeepsAiWorkspacesAndSetupReachable()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("_sidebarModeButtons = railButtons", source, StringComparison.Ordinal);
        Assert.Contains("railButton.Click += (_, _) => ShowSidebarMode(mode);", source, StringComparison.Ordinal);
        Assert.Contains("_scheduleCard.IsVisible = _sidebarMode == \"schedule\";", source, StringComparison.Ordinal);
        Assert.Contains("_libraryCard.IsVisible = _sidebarMode is \"library\" or \"media\";", source, StringComparison.Ordinal);
        Assert.Contains("_scriptureCard.IsVisible = _sidebarMode == \"scripture\";", source, StringComparison.Ordinal);
        Assert.Contains("setupButton.Click += (_, _) => _tabs.SelectedIndex = SetupTabIndex;", source, StringComparison.Ordinal);
    }

    [Fact]
    public void LowerThirdComposerIsNotRecreatedInTheDesktopFrontend()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        // The lower-third composer was new authoring business logic, not a visual
        // redesign — it was removed from this PR's scope (BLOCKER 2 review).
        Assert.DoesNotContain("SendLowerThirdToPreviewAsync", source, StringComparison.Ordinal);
        Assert.DoesNotContain("_sendLowerThird", source, StringComparison.Ordinal);
        Assert.DoesNotContain("_lowerThirdTemplate", source, StringComparison.Ordinal);
        Assert.DoesNotContain("LOWER THIRD", source, StringComparison.Ordinal);
    }

    [Fact]
    public void ExistingOperatorActionsRemainWiredToTheirExistingCommands()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        // GO LIVE / END LIVE and Start Recording are UI surfaces for backend
        // commands that already exist on main (output.start/stop, recording.start/stop)
        // — they stay. They must remain ordinary operator commands.
        Assert.Contains("LocalOperatorCommands.OutputStart", source, StringComparison.Ordinal);
        Assert.Contains("LocalOperatorCommands.OutputStop", source, StringComparison.Ordinal);
        Assert.Contains("_goLive.Click += async (_, _) => await ToggleOutputAsync();", source, StringComparison.Ordinal);
        Assert.Contains("_record.Click += async (_, _) => await ToggleRecordingAsync();", source, StringComparison.Ordinal);
    }

    // --- v2.2: workspace mechanics, density, adaptability ---

    [Fact]
    public void ResourceCategoriesScrollInAnOverflowStripInsteadOfOverlapping()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var categoryBar = new OperatorOverflowStrip()", source, StringComparison.Ordinal);
        Assert.Contains("categoryBar.EnsureVisible(capturedButton)", source, StringComparison.Ordinal);
        Assert.Contains("_activeCategoryButtons = categoryBar.ItemHost", source, StringComparison.Ordinal);
        // The old flat StackPanel overlapped the toolbar actions at narrow pane
        // widths — it must not come back.
        Assert.DoesNotContain("var categoryBar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 }", source, StringComparison.Ordinal);
    }

    [Fact]
    public void CommandRailIsIconFirstSoNothingClipsAtFiftyTwoPixels()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("private static Button RailButton(string glyph, string caption, string tooltip)", source, StringComparison.Ordinal);
        Assert.Contains("RailButton(glyph, caption, tooltip)", source, StringComparison.Ordinal);
        Assert.Contains("(\"schedule\", \"☰\", \"SCHEDULE\"", source, StringComparison.Ordinal);
        Assert.Contains("(\"library\", \"▤\", \"LIBRARY\"", source, StringComparison.Ordinal);
        Assert.Contains("(\"scripture\", \"✝\", \"BIBLE\"", source, StringComparison.Ordinal);
        Assert.Contains("(\"media\", \"▶\", \"MEDIA\"", source, StringComparison.Ordinal);
        Assert.Contains("RailButton(\"⚙\", \"SETUP\", \"Activation and runtime setup tab\")", source, StringComparison.Ordinal);
        // Word labels at 11px clipped mid-word inside the 52px rail ("Sched",
        // "Librar", "Trc") — the ToolButton-based rail must not return.
        Assert.DoesNotContain("OperatorTheme.ToolButton(\"Schedule\"", source, StringComparison.Ordinal);
        Assert.DoesNotContain("OperatorTheme.ToolButton(\"Scripture\"", source, StringComparison.Ordinal);
        Assert.DoesNotContain("LinkButton(\"AI Director\"", source, StringComparison.Ordinal);
    }

    [Fact]
    public void DeckColumnsAreResizableAndPersistedLikeEveryOtherRegion()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("var deckColumnSplitter = ProductionSplitter(GridResizeDirection.Columns)", source, StringComparison.Ordinal);
        Assert.Contains("_deckColumnSplitterField = deckColumnSplitter", source, StringComparison.Ordinal);
        Assert.Contains("OperatorWorkspaceLayouts.DeckColumnsFromActualBounds(deckLeft.Width, deckRight.Width)", source, StringComparison.Ordinal);
        Assert.Contains("OperatorDeckLeftColumn = deckLeftStar", source, StringComparison.Ordinal);
        Assert.Contains("OperatorDeckRightColumn = deckRightStar", source, StringComparison.Ordinal);
        Assert.Contains("_playoutDeck.ColumnDefinitions[0].Width = new GridLength(deckLeft, GridUnitType.Star)", source, StringComparison.Ordinal);
        Assert.Contains("_playoutDeck.ColumnDefinitions[2].Width = new GridLength(deckRight, GridUnitType.Star)", source, StringComparison.Ordinal);
    }

    [Fact]
    public void WorkspacePersistenceCoversSidebarModeAndDeckColumnsWithClamps()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));
        var settings = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "DesktopSettings.cs"));

        // Persisted: pane widths/heights, collapsed state, preset, sidebar mode.
        Assert.Contains("OperatorSidebarMode = mode", source, StringComparison.Ordinal);
        Assert.Contains("ShowSidebarMode(_settings.OperatorSidebarMode)", source, StringComparison.Ordinal);
        Assert.Contains("OperatorSidebarMode = operatorSidebarMode", settings, StringComparison.Ordinal);
        Assert.Contains("OperatorDeckLeftColumn = ClampStar(OperatorDeckLeftColumn)", settings, StringComparison.Ordinal);
        Assert.Contains("OperatorDeckRightColumn = ClampStar(OperatorDeckRightColumn)", settings, StringComparison.Ordinal);
    }

    [Fact]
    public void ResetWorkspaceRestoresStudioLayoutWithoutDeletingSettingsFiles()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("private void ResetWorkspaceLayout()", source, StringComparison.Ordinal);
        Assert.Contains("ApplyWorkspacePreset(OperatorWorkspaceLayouts.Production)", source, StringComparison.Ordinal);
        Assert.Contains("_sidebarPaneSavedWidth = null", source, StringComparison.Ordinal);
        Assert.Contains("_resourceDeckSavedHeight = null", source, StringComparison.Ordinal);
        Assert.Contains("Workspace reset to the Studio layout.", source, StringComparison.Ordinal);
    }

    [Fact]
    public void PresetsRearrangeOneWorkspaceGeometryAndSidebarMode()
    {
        var layouts = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "OperatorWorkspaceLayouts.cs"));

        Assert.Contains("SidebarModeForPreset", layouts, StringComparison.Ordinal);
        Assert.Contains("Scripture => \"scripture\"", layouts, StringComparison.Ordinal);
        Assert.Contains("Media => \"media\"", layouts, StringComparison.Ordinal);
        Assert.Contains("DeckColumnsFromActualBounds", layouts, StringComparison.Ordinal);
        Assert.Contains("public const string ProductionSidebarMode = \"schedule\";", layouts, StringComparison.Ordinal);
    }

    [Fact]
    public void CollapsedPanesAreRestoredByRailButtonsWithoutDeadRectangles()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        // Selecting any sidebar mode expands a collapsed sidebar: the compact
        // rail is the restore affordance.
        Assert.Contains("if (_settings.OperatorSidebarCollapsed) SetSidebarPaneCollapsed(false);", source, StringComparison.Ordinal);
        Assert.Contains("sidebarToggle.Click += (_, _) => SetSidebarPaneCollapsed(!_settings.OperatorSidebarCollapsed);", source, StringComparison.Ordinal);
        Assert.Contains("deckToggle.Click += (_, _) => SetResourceDeckCollapsed(!_settings.OperatorResourceDeckCollapsed);", source, StringComparison.Ordinal);
        Assert.Contains("private void RefreshPaneToggleStates()", source, StringComparison.Ordinal);
    }

    [Fact]
    public void RowContextMenusReuseExistingCommandsOnly()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("private ContextMenu BuildScheduleContextMenu(OperatorRundownRow row)", source, StringComparison.Ordinal);
        Assert.Contains("private ContextMenu BuildLibraryContextMenu(OperatorRundownRow row)", source, StringComparison.Ordinal);
        Assert.Contains("private ContextMenu BuildUpNextContextMenu(OperatorRundownRow row)", source, StringComparison.Ordinal);
        // The menus route through the SAME selection + command paths as the
        // toolbar buttons and pointer contracts — no new product logic.
        Assert.Contains("_ = MoveScheduledAsync(-1);", source, StringComparison.Ordinal);
        Assert.Contains("_ = RemoveScheduledAsync();", source, StringComparison.Ordinal);
        Assert.Contains("_ = AddSelectedToScheduleAsync();", source, StringComparison.Ordinal);
        Assert.Contains("_ = PreviewItemAndTakeAsync(row.Item);", source, StringComparison.Ordinal);
    }

    [Fact]
    public void WorkspacePersistenceSavesThroughTheContextFreeMarshallingHelper()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        // The shutdown path persists geometry synchronously on the UI thread;
        // the save must go through SettingsPersistence (thread-pool marshalling,
        // no captured UI dispatcher) or a genuinely asynchronous file write can
        // deadlock window close. See SettingsPersistenceTests and the
        // PersistingWorkspaceGeometryNeverCapturesTheBlockedUiThread guard.
        Assert.Contains(
            "SettingsPersistence.RunBlockingWithoutCapture(",
            source,
            StringComparison.Ordinal);
        Assert.DoesNotContain(
            "_settingsStore.SaveAsync(_settings, CancellationToken.None).GetAwaiter().GetResult()",
            source,
            StringComparison.Ordinal);
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
