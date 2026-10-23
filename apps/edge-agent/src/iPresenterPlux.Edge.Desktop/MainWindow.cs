using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.Security;

namespace iPresenterPlux.Edge.Desktop;

public sealed class MainWindow : Window
{
    private const int OperatorTabIndex = 0;
    private const int ActivationTabIndex = 1;
    private const int SetupTabIndex = 2;
    private static readonly IBrush Surface = Brush("#0D121A");
    private static readonly IBrush SurfaceRaised = Brush("#121925");
    private static readonly IBrush Gold = Brush("#D7A94A");
    private static readonly IBrush Muted = Brush("#8B95A5");
    private static readonly IBrush Good = Brush("#55D38A");
    private static readonly IBrush Warning = Brush("#F0B75E");
    private static readonly IBrush Danger = Brush("#F47B7B");

    private readonly ShellPaths _paths = ShellPaths.CreateDefault();
    private readonly DesktopSettingsStore _settingsStore;
    private readonly EdgeHostSupervisor _supervisor;
    private readonly LocalOperatorClient _operatorClient;
    private readonly DesktopBibleLibrary _desktopBibleLibrary;
    private readonly DesktopOperatorScheduleStore _scheduleStore;
    private readonly DesktopEntitlementStore _entitlementStore;
    private readonly HttpClient _licensingHttpClient = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly EntitlementClient _entitlementClient;
    private readonly IReadOnlyDictionary<string, byte[]> _entitlementPublicKeys;
    private readonly DispatcherTimer _operatorTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly TabControl _tabs = new();
    private readonly TextBox _operatorSearch = Input("Search scripture, songs, slides or media", false);
    private readonly TextBox _scriptureReference = Input("John 3:16 or Psalm 23", false);
    private readonly ComboBox _bibleVersion = new() { MinHeight = 38, MinWidth = 96 };
    private readonly Button _resolveScripture = ActionButton("Find & Preview", true);
    private readonly Button _manageBibleVersions = ActionButton("Bible Versions", false);
    private readonly TextBlock _rundownEyebrow = Label("LIBRARY", 10, FontWeight.Bold, Gold);
    private readonly TextBlock _rundownTitle = Label("Search & browse", 19, FontWeight.Bold);
    private readonly TextBlock _rundownCurrent = Label("CURRENT · Program clear", 10, FontWeight.SemiBold, Muted);
    private readonly TextBlock _catalogStatus = Label("LOCAL REHEARSAL", 10, FontWeight.Bold, Warning);
    private readonly TextBlock _catalogService = Label("Demo content · no synced service yet", 11, FontWeight.Normal, Muted);
    private readonly ListBox _libraryResults = new();
    private ListBox _rundown => _libraryResults;
    private readonly ListBox _schedule = new();
    private readonly TextBlock _detailsTitle = Label("Select content", 18, FontWeight.Bold);
    private readonly TextBlock _detailsMeta = Label("Choose Scripture, a song, slide or media item from the Library.", 10, FontWeight.SemiBold, Gold);
    private readonly TextBlock _detailsBody = Label("Selected content details will appear here before you add it to the service schedule or send it to Preview.", 12, FontWeight.Normal, Muted);
    private readonly ComboBox _browserBook = new() { MinHeight = 36, MinWidth = 150 };
    private readonly ComboBox _browserChapter = new() { MinHeight = 36, MinWidth = 76 };
    private readonly ComboBox _browserFromVerse = new() { MinHeight = 36, MinWidth = 76 };
    private readonly ComboBox _browserToVerse = new() { MinHeight = 36, MinWidth = 76 };
    private readonly ListBox _browserVerses = new() { MinHeight = 110, MaxHeight = 210 };
    private readonly StackPanel _scriptureBrowserPanel = new() { Spacing = 8, IsVisible = false };
    private readonly Button _browserPreviewRange = ActionButton("Preview Verse Range", true);
    private readonly Button _addSelectedToSchedule = ActionButton("Add Selected", false);
    private readonly Button _removeScheduled = ActionButton("Remove", false);
    private readonly Button _moveScheduledUp = ActionButton("Move Up", false);
    private readonly Button _moveScheduledDown = ActionButton("Move Down", false);
    private readonly TextBlock _previewTitle = Label("Preview is clear", 22, FontWeight.Bold);
    private readonly TextBlock _previewBody = Label("Select a cue and press Preview Selected.", 16, FontWeight.Normal, Muted);
    private readonly TextBlock _previewFooter = Label("PREVIEW", 11, FontWeight.Bold, Gold);
    private readonly TextBlock _programTitle = Label("Program is clear", 22, FontWeight.Bold);
    private readonly TextBlock _programBody = Label("Nothing is currently live on Program.", 16, FontWeight.Normal, Muted);
    private readonly TextBlock _programFooter = Label("PROGRAM", 11, FontWeight.Bold, Good);
    private readonly TextBlock _operatorRuntime = Label("EDGE OFFLINE", 11, FontWeight.Bold, Muted);
    private readonly TextBlock _operatorService = Label("LOCAL REHEARSAL", 11, FontWeight.Bold, Warning);
    private readonly TextBlock _operatorRecording = Label("RECORDING OFF", 11, FontWeight.Bold, Muted);
    private readonly TextBlock _microphoneStatus = Label("MIC · WAITING", 10, FontWeight.Bold, Muted);
    private readonly TextBlock _asrStatus = Label("ASR · CHECKING", 10, FontWeight.Bold, Muted);
    private readonly TextBlock _voiceScriptureStatus = Label("VOICE SCRIPTURE · DETECT", 10, FontWeight.Bold, Gold);
    private readonly TextBlock _operatorFeedback = Label("Local operator channel is waiting for Edge.", 12, FontWeight.Normal, Muted);
    private readonly Button _prepare = ActionButton("Preview Selected", false);
    private readonly Button _take = ActionButton("TAKE → PROGRAM", true);
    private readonly Button _clear = ActionButton("Clear Program", false);
    private readonly Button _record = ActionButton("Start Recording", false);
    private readonly Button _mediaPause = ActionButton("Pause Media", false);
    private readonly Button _mediaResume = ActionButton("Resume Media", false);
    private readonly TextBox _mediaSeek = Input("Seconds", false);
    private readonly Button _mediaSeekApply = ActionButton("Seek", false);
    private readonly List<Button> _localOutputButtons = [];
    private string _activeCategory = "All";
    private OperatorWorkspaceView _workspace = OperatorWorkspaceCatalog.FromCatalog(null, stale: false);
    private LocalOperatorSnapshot _operatorSnapshot = new(
        OutputRunning: false,
        Preview: null,
        Program: null,
        IsRecording: false,
        RecordingId: null,
        ConnectionStatus: "Offline",
        ActiveServiceId: null,
        ServiceMode: "rehearsal",
        UpdatedAt: DateTimeOffset.MinValue);
    private string? _selectedRundownItemId;
    private string? _selectedScheduleItemId;
    private string _activeSelectionSurface = "library";
    private List<OperatorWorkspaceItem> _localSchedule = [];
    private OperatorWorkspaceItem? _selectedDetailItem;
    private IReadOnlyList<DesktopBibleVerse> _visibleBibleVerses = Array.Empty<DesktopBibleVerse>();
    private bool _browserBusy;
    private bool _rebuildingOperatorCollections;
    private string? _catalogRevision;
    private bool _catalogStale;
    private bool _operatorBusy;
    private bool _recordingActive;
    private readonly TextBox _controlUrl = Input("https://control.example.com", false);
    private readonly TextBox _activationControlUrl = Input("https://control.example.com", false);
    private readonly TextBox _productKey = Input("IPLX-XXXXX-XXXXX-XXXXX-XXXXX", true);
    private readonly TextBlock _entitlementStatus = Label("Activation required", 22, FontWeight.Bold, Warning);
    private readonly TextBlock _entitlementDetail = Label("Enter the Control Plane URL and product key supplied with your subscription.", 12, FontWeight.Normal, Muted);
    private readonly TextBlock _entitlementDevice = Label("Installation identity will be created locally.", 11, FontWeight.Normal, Muted);
    private readonly TextBlock _entitlementFeedback = Label("", 12, FontWeight.Normal, Muted);
    private readonly Button _activate = ActionButton("Activate iPresenterPlux", true);
    private readonly Button _renewEntitlement = ActionButton("Retry validation", false);
    private readonly TextBox _deviceName = Input("Church production computer", false);
    private readonly TextBox _pairingCode = Input("One-time pairing code", true);
    private readonly ComboBox _programDisplay = new() { MinHeight = 42, MinWidth = 260 };
    private readonly TextBlock _programDisplayHint = Label("Program output display will be detected after the window opens.", 11, FontWeight.Normal, Muted);
    private readonly TextBlock _statusTitle = Label("Stopped", 22, FontWeight.Bold);
    private readonly TextBlock _statusDetail = Label("The local Edge runtime is not running.", 12, FontWeight.Normal, Muted);
    private readonly Border _statusDot = new() { Width = 10, Height = 10, CornerRadius = new CornerRadius(99), Background = Muted };
    private readonly TextBlock _cloudStatus = Label("Control Plane · unknown", 12, FontWeight.SemiBold, Muted);
    private readonly TextBlock _programStatus = Label("Local Program · waiting — start Edge first", 12, FontWeight.SemiBold, Muted);
    private readonly TextBlock _feedback = Label("", 12, FontWeight.Normal, Muted);
    private readonly Button _start = ActionButton("Start Edge", true);
    private readonly Button _stop = ActionButton("Stop", false);
    private readonly Button _restart = ActionButton("Restart", false);
    private readonly Button _save = ActionButton("Save settings", false);
    private DesktopSettings _settings = DesktopSettings.CreateDefault();
    private EntitlementValidation? _entitlementValidation;
    private bool _entitlementUsable;
    private bool _allowClose;

    public MainWindow()
    {
        _settingsStore = new DesktopSettingsStore(_paths.SettingsDirectory);
        _supervisor = new EdgeHostSupervisor(_paths);
        _operatorClient = new LocalOperatorClient(_paths.EdgeDataDirectory);
        _desktopBibleLibrary = new DesktopBibleLibrary(Path.Combine(_paths.EdgeDataDirectory, "bibles"));
        _scheduleStore = new DesktopOperatorScheduleStore(Path.Combine(_paths.EdgeDataDirectory, "operator"));
        _entitlementStore = DesktopEntitlementStore.CreateDefault();
        _entitlementPublicKeys = EntitlementPublicKeyCatalog.Load();
        _entitlementClient = new EntitlementClient(_licensingHttpClient, _entitlementStore, _entitlementPublicKeys);
        _supervisor.SnapshotChanged += (_, snapshot) => Dispatcher.UIThread.Post(() => RenderSnapshot(snapshot));
        _operatorTimer.Tick += async (_, _) => await RefreshOperatorAsync();

        Title = "iPresenterPlux Edge";
        Width = 1040;
        Height = 640;
        MinWidth = 760;
        MinHeight = 520;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        WindowDecorations = Avalonia.Controls.WindowDecorations.Full;
        CanMinimize = true;
        CanMaximize = true;
        ExtendClientAreaToDecorationsHint = false;
        Background = Brush("#070A0F");
        _mediaPause.IsVisible = false;
        _mediaResume.IsVisible = false;
        _mediaSeek.IsVisible = false;
        _mediaSeekApply.IsVisible = false;
        var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "icon.png");
        if (File.Exists(icon)) Icon = new WindowIcon(icon);

        Content = BuildContent();
        RefreshBibleVersionChoices();
        Opened += OnWindowOpened;
        Closing += OnClosing;
        KeyDown += (_, args) =>
        {
            if (args.Key == Key.F5 && _restart.IsEnabled) _ = RestartAsync();
            if (args.Key == Key.F8) _ = TakeAsync();
            if (args.Key == Key.F7) _ = ClearProgramAsync();
            if (args.Key == Key.F6) _ = PreviewSelectedAsync();
            if (args.Source is not TextBox && args.Source is not ComboBox &&
                (args.KeyModifiers & KeyModifiers.Control) != 0)
            {
                if (args.Key == Key.Up)
                {
                    MoveRundownSelection(-1);
                    args.Handled = true;
                }
                else if (args.Key == Key.Down)
                {
                    MoveRundownSelection(1);
                    args.Handled = true;
                }
            }
        };

        _save.Click += async (_, _) => await SaveAsync();
        _activate.Click += async (_, _) => await ActivateLicenseAsync();
        _renewEntitlement.Click += async (_, _) => await RenewEntitlementAsync();
        _start.Click += async (_, _) => await StartAsync();
        _stop.Click += async (_, _) => await StopAsync();
        _restart.Click += async (_, _) => await RestartAsync();
        _prepare.Click += async (_, _) => await PreviewSelectedAsync();
        _take.Click += async (_, _) => await TakeAsync();
        _clear.Click += async (_, _) => await ClearProgramAsync();
        _record.Click += async (_, _) => await ToggleRecordingAsync();
        _mediaPause.Click += async (_, _) => await PauseProgramMediaAsync();
        _mediaResume.Click += async (_, _) => await ResumeProgramMediaAsync();
        _mediaSeekApply.Click += async (_, _) => await SeekProgramMediaAsync();
        _mediaSeek.KeyDown += (_, args) =>
        {
            if (args.Key == Key.Enter && _mediaSeekApply.IsEnabled) _ = SeekProgramMediaAsync();
        };
        _resolveScripture.Click += async (_, _) => await ResolveAndPreviewScriptureAsync();
        _manageBibleVersions.Click += async (_, _) => await OpenBibleVersionsAsync();
        _scriptureReference.KeyDown += (_, args) =>
        {
            if (args.Key == Key.Enter) _ = ResolveAndPreviewScriptureAsync();
        };
        _operatorSearch.TextChanged += (_, _) => RefreshRundown();
        _browserBook.SelectionChanged += async (_, _) => await LoadBibleBookChaptersAsync();
        _browserChapter.SelectionChanged += async (_, _) => await LoadBibleChapterAsync();
        _browserFromVerse.SelectionChanged += (_, _) => NormalizeBrowserVerseRange();
        _browserPreviewRange.Click += async (_, _) => await PreviewBrowserVerseRangeAsync();
        _addSelectedToSchedule.Click += async (_, _) => await AddSelectedToScheduleAsync();
        _removeScheduled.Click += async (_, _) => await RemoveScheduledAsync();
        _moveScheduledUp.Click += async (_, _) => await MoveScheduledAsync(-1);
        _moveScheduledDown.Click += async (_, _) => await MoveScheduledAsync(1);
        _programDisplay.SelectionChanged += (_, _) =>
        {
            if (_programDisplay.SelectedItem is ProgramDisplayTarget target)
                RenderProgramDisplayHint(target, usedFallback: false, topologyChanged: false);
        };
        _tabs.SelectionChanged += (_, _) =>
        {
            if (_tabs.SelectedIndex == OperatorTabIndex && !_entitlementUsable)
                _tabs.SelectedIndex = ActivationTabIndex;
        };
    }

    private async void OnWindowOpened(object? sender, EventArgs e)
    {
        WindowState = WindowState.Maximized;
        await LoadAsync();
        Screens.Changed += (_, _) => Dispatcher.UIThread.Post(() => RefreshProgramDisplays(topologyChanged: true));
    }

    private Control BuildContent()
    {
        _tabs.Background = Brush("#070A0F");
        _tabs.ItemsSource = new object[]
        {
            new TabItem { Header = "Operator", Content = BuildOperatorContent() },
            new TabItem { Header = "Activation", Content = BuildActivationContent() },
            new TabItem { Header = "Setup & Runtime", Content = BuildSetupContent() }
        };
        _tabs.SelectedIndex = ActivationTabIndex;
        return _tabs;
    }

    private Control BuildActivationContent()
    {
        _productKey.PasswordChar = '●';
        _entitlementDetail.TextWrapping = TextWrapping.Wrap;
        _entitlementDevice.TextWrapping = TextWrapping.Wrap;
        _entitlementFeedback.TextWrapping = TextWrapping.Wrap;

        var form = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        form.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        form.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        form.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        form.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        form.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        form.Children.Add(Field("Control Plane URL", _activationControlUrl, 0, 0, 2));
        form.Children.Add(Field("Product key", _productKey, 1, 0, 2));

        var actions = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var button in new[] { _activate, _renewEntitlement })
        {
            button.Margin = new Thickness(0, 0, 10, 0);
            actions.Children.Add(button);
        }
        var settings = ActionButton("Open Setup & Settings", false);
        settings.Click += (_, _) => _tabs.SelectedIndex = SetupTabIndex;
        actions.Children.Add(settings);
        Grid.SetRow(actions, 2);
        Grid.SetColumnSpan(actions, 2);
        form.Children.Add(actions);

        var status = new StackPanel {
            Spacing = 8,
            Children = {
                Label("SUBSCRIPTION STATUS", 10, FontWeight.Bold, Gold),
                _entitlementStatus,
                _entitlementDetail,
                _entitlementDevice,
                Separator(),
                Label("Settings remain available even when a subscription needs attention. Existing local work is not force-stopped solely because online validation is temporarily unavailable.", 11, FontWeight.Normal, Muted)
            }
        };

        var panel = new StackPanel {
            Spacing = 18,
            MaxWidth = 780,
            HorizontalAlignment = HorizontalAlignment.Center,
            Children = {
                new StackPanel {
                    Spacing = 5,
                    Children = {
                        Label("IPRESENTERPLUX", 10, FontWeight.Bold, Gold),
                        Label("Activate this production computer", 30, FontWeight.Bold),
                        Label("Use the online subscription key issued for this church. Product keys are never saved by the desktop app.", 13, FontWeight.Normal, Muted)
                    }
                },
                Card("Activation", form),
                Card("Subscription", status),
                _entitlementFeedback
            }
        };

        return new ScrollViewer {
            Margin = new Thickness(24),
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            Content = panel
        };
    }

    private Control BuildOperatorContent()
    {
        var root = new Grid { Margin = new Thickness(6), MinHeight = 420 };
        root.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        root.RowDefinitions.Add(new RowDefinition(new GridLength(6)));
        root.RowDefinitions.Add(new RowDefinition(new GridLength(270)));
        root.RowDefinitions.Add(new RowDefinition(new GridLength(6)));
        root.RowDefinitions.Add(new RowDefinition(new GridLength(1, GridUnitType.Star)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(230)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(6)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(6)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));

        var operatorStatus = new WrapPanel {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center
        };
        foreach (var status in new[] { _operatorRuntime, _operatorService, _operatorRecording })
        {
            status.Margin = new Thickness(0, 0, 12, 0);
            operatorStatus.Children.Add(status);
        }
        var openProgramHeader = LocalOutputButton("Open Program", "program");
        openProgramHeader.MinHeight = 32;
        openProgramHeader.Padding = new Thickness(10, 5);
        operatorStatus.Children.Add(openProgramHeader);

        var voiceStatus = new WrapPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        foreach (var status in new[] { _microphoneStatus, _asrStatus, _voiceScriptureStatus })
        {
            status.Margin = new Thickness(0, 0, 10, 0);
            voiceStatus.Children.Add(status);
        }
        var headerRight = new StackPanel {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Right,
            Children = { operatorStatus, voiceStatus, HeaderHint() }
        };
        var headerGrid = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        headerGrid.Children.Add(new StackPanel {
            Spacing = 1,
            Children = {
                Label("IPRESENTERPLUX · OPERATOR", 9, FontWeight.Bold, Gold),
                Label("Live Production", 22, FontWeight.Bold),
                Label("Schedule · Preview · Program stay visible while you search and browse resources", 10, FontWeight.Normal, Muted)
            }
        });
        Grid.SetColumn(headerRight, 1);
        headerGrid.Children.Add(headerRight);
        var header = new Border {
            Background = Surface,
            CornerRadius = new CornerRadius(16),
            Padding = new Thickness(14, 9),
            Child = headerGrid
        };
        Grid.SetColumnSpan(header, 5);
        root.Children.Add(header);

        var production = new Grid { ColumnSpacing = 6 };
        production.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(230)));
        production.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        production.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));

        _schedule.Background = SurfaceRaised;
        _schedule.MinHeight = 140;
        _schedule.SelectionChanged += (_, _) =>
        {
            if (!_rebuildingOperatorCollections && _schedule.SelectedItem is OperatorRundownRow row)
            {
                _selectedScheduleItemId = row.Item.Id;
                _activeSelectionSurface = "schedule";
                RenderSelectedDetails(row.Item);
            }
            RefreshScheduleActionState();
        };
        _schedule.PointerPressed += OnSchedulePointerPressed;
        var scheduleActions = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var button in new[] { _removeScheduled, _moveScheduledUp, _moveScheduledDown })
        {
            button.MinWidth = 0;
            button.MinHeight = 32;
            button.Padding = new Thickness(8, 4);
            button.Margin = new Thickness(0, 0, 5, 4);
            scheduleActions.Children.Add(button);
        }
        var scheduleLayout = new Grid { RowSpacing = 6 };
        scheduleLayout.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        scheduleLayout.RowDefinitions.Add(new RowDefinition(new GridLength(1, GridUnitType.Star)));
        scheduleLayout.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        var scheduleHeader = new StackPanel {
            Spacing = 2,
            Children = {
                Label("SERVICE SCHEDULE", 9, FontWeight.Bold, Gold),
                _rundownCurrent,
                Label("Click → Preview · double-click → Program", 9, FontWeight.Normal, Muted)
            }
        };
        scheduleLayout.Children.Add(scheduleHeader);
        Grid.SetRow(_schedule, 1);
        scheduleLayout.Children.Add(_schedule);
        Grid.SetRow(scheduleActions, 2);
        scheduleLayout.Children.Add(scheduleActions);
        var scheduleCard = new Border {
            Background = Surface,
            CornerRadius = new CornerRadius(16),
            Padding = new Thickness(10),
            Child = scheduleLayout
        };
        production.Children.Add(scheduleCard);

        var previewActions = new WrapPanel { Orientation = Orientation.Horizontal };
        _prepare.MinHeight = 34;
        _prepare.Padding = new Thickness(10, 5);
        _prepare.Margin = new Thickness(0, 0, 6, 0);
        _take.MinHeight = 34;
        _take.Padding = new Thickness(12, 5);
        previewActions.Children.Add(_prepare);
        previewActions.Children.Add(_take);
        var previewPane = BuildProductionPane(
            "PREVIEW",
            "Safe staging — selecting content never changes the congregation screen.",
            BuildStage("PREVIEW", _previewTitle, _previewBody, _previewFooter, Gold),
            previewActions,
            Gold);
        Grid.SetColumn(previewPane, 1);
        production.Children.Add(previewPane);

        var programActions = new WrapPanel { Orientation = Orientation.Horizontal };
        _clear.MinHeight = 34;
        _clear.Padding = new Thickness(10, 5);
        _clear.Margin = new Thickness(0, 0, 6, 0);
        var openProgram = LocalOutputButton("Open Program", "program");
        openProgram.MinHeight = 34;
        openProgram.Padding = new Thickness(10, 5);
        openProgram.Margin = new Thickness(0, 0, 6, 0);
        programActions.Children.Add(_clear);
        programActions.Children.Add(openProgram);
        _record.MinHeight = 34;
        _record.Padding = new Thickness(10, 5);
        programActions.Children.Add(_record);
        var mediaActions = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var control in new Control[] { _mediaPause, _mediaResume, _mediaSeek, _mediaSeekApply })
        {
            control.Margin = new Thickness(0, 0, 5, 0);
            mediaActions.Children.Add(control);
        }
        var programActionStack = new StackPanel { Spacing = 4, Children = { programActions, mediaActions } };
        var programPane = BuildProductionPane(
            "PROGRAM · LIVE",
            "Exactly what the TV/projector is showing now.",
            BuildStage("PROGRAM", _programTitle, _programBody, _programFooter, Good),
            programActionStack,
            Good);
        Grid.SetColumn(programPane, 2);
        production.Children.Add(programPane);

        Grid.SetRow(production, 2);
        Grid.SetColumnSpan(production, 5);
        root.Children.Add(production);

        _operatorSearch.MinHeight = 36;
        _scriptureReference.MinHeight = 36;
        _scriptureReference.IsEnabled = true;
        _bibleVersion.Background = SurfaceRaised;
        _bibleVersion.Foreground = Brushes.White;
        _bibleVersion.MinHeight = 36;
        _resolveScripture.MinHeight = 36;
        _resolveScripture.Padding = new Thickness(10, 5);
        _manageBibleVersions.MinHeight = 36;
        _manageBibleVersions.Padding = new Thickness(10, 5);

        var categoryBar = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var category in OperatorWorkspaceCatalog.Categories)
        {
            var button = ActionButton(category, false);
            button.MinWidth = 0;
            button.MinHeight = 30;
            button.Padding = new Thickness(9, 4);
            button.Margin = new Thickness(0, 0, 5, 5);
            var captured = category;
            button.Click += (_, _) => { _activeCategory = captured; RefreshRundown(); };
            categoryBar.Children.Add(button);
        }

        var scriptureLookup = new Grid { ColumnSpacing = 6 };
        scriptureLookup.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(110)));
        scriptureLookup.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        scriptureLookup.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));
        scriptureLookup.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));
        scriptureLookup.Children.Add(_bibleVersion);
        Grid.SetColumn(_scriptureReference, 1);
        scriptureLookup.Children.Add(_scriptureReference);
        Grid.SetColumn(_resolveScripture, 2);
        scriptureLookup.Children.Add(_resolveScripture);
        Grid.SetColumn(_manageBibleVersions, 3);
        scriptureLookup.Children.Add(_manageBibleVersions);

        _rundown.Background = SurfaceRaised;
        _rundown.MinHeight = 130;
        _rundown.SelectionChanged += (_, _) =>
        {
            if (!_rebuildingOperatorCollections && _rundown.SelectedItem is OperatorRundownRow row)
            {
                _selectedRundownItemId = row.Item.Id;
                _activeSelectionSurface = "library";
                RenderSelectedDetails(row.Item);
            }
            _prepare.IsEnabled = _rundown.SelectedItem is OperatorRundownRow;
            _addSelectedToSchedule.IsEnabled = _rundown.SelectedItem is OperatorRundownRow;
        };
        _rundown.PointerPressed += OnLibraryPointerPressed;

        var libraryPanel = new Grid { RowSpacing = 6 };
        libraryPanel.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        libraryPanel.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        libraryPanel.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        libraryPanel.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        libraryPanel.RowDefinitions.Add(new RowDefinition(new GridLength(1, GridUnitType.Star)));
        libraryPanel.Children.Add(new StackPanel {
            Spacing = 2,
            Children = {
                Label("RESOURCE DECK", 9, FontWeight.Bold, Gold),
                Label("Scripture · Songs · Media · Slides · Announcements", 14, FontWeight.Bold),
                Label("Search or browse without ever hiding Preview and Program.", 9, FontWeight.Normal, Muted)
            }
        });
        Grid.SetRow(categoryBar, 1);
        libraryPanel.Children.Add(categoryBar);
        Grid.SetRow(_operatorSearch, 2);
        libraryPanel.Children.Add(_operatorSearch);
        Grid.SetRow(scriptureLookup, 3);
        libraryPanel.Children.Add(scriptureLookup);
        Grid.SetRow(_rundown, 4);
        libraryPanel.Children.Add(_rundown);

        _browserBook.ItemsSource = _desktopBibleLibrary.ListBooks();
        _browserVerses.Background = SurfaceRaised;
        var browserSelectors = new Grid { ColumnSpacing = 5 };
        browserSelectors.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(2, GridUnitType.Star)));
        browserSelectors.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        browserSelectors.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        browserSelectors.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        browserSelectors.Children.Add(Field("Book", _browserBook, 0, 0));
        browserSelectors.Children.Add(Field("Chapter", _browserChapter, 0, 1));
        browserSelectors.Children.Add(Field("From", _browserFromVerse, 0, 2));
        browserSelectors.Children.Add(Field("To", _browserToVerse, 0, 3));
        _scriptureBrowserPanel.Children.Clear();
        _scriptureBrowserPanel.Children.Add(Label("BIBLE BROWSER · WHOLE CHAPTER", 9, FontWeight.Bold, Gold));
        _scriptureBrowserPanel.Children.Add(browserSelectors);
        _scriptureBrowserPanel.Children.Add(_browserVerses);
        _scriptureBrowserPanel.Children.Add(_browserPreviewRange);

        _detailsBody.TextWrapping = TextWrapping.Wrap;
        var detailsActions = new WrapPanel { Orientation = Orientation.Horizontal };
        _addSelectedToSchedule.Margin = new Thickness(0, 0, 6, 0);
        detailsActions.Children.Add(_addSelectedToSchedule);
        detailsActions.Children.Add(LinkButton("AI Scripture", () => CloudUri("/scripture")));
        var detailsPanel = new StackPanel {
            Spacing = 6,
            Children = {
                Label("SELECTED CONTENT", 9, FontWeight.Bold, Gold),
                _detailsTitle,
                _detailsMeta,
                _detailsBody,
                Label("AI Scripture · Manual · Auto Preview · guarded Auto Live", 9, FontWeight.SemiBold, Muted),
                detailsActions,
                _scriptureBrowserPanel
            }
        };

        var resourceDeck = new Grid { ColumnSpacing = 8 };
        resourceDeck.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1.15, GridUnitType.Star)));
        resourceDeck.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(0.85, GridUnitType.Star)));
        resourceDeck.Children.Add(libraryPanel);
        var detailsScroll = new ScrollViewer {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            Content = detailsPanel
        };
        Grid.SetColumn(detailsScroll, 1);
        resourceDeck.Children.Add(detailsScroll);

        var resourceDeckScroll = new ScrollViewer {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            Content = resourceDeck
        };
        var resourceDeckCard = new Border {
            Background = Surface,
            CornerRadius = new CornerRadius(16),
            Padding = new Thickness(10),
            Child = resourceDeckScroll
        };
        Grid.SetRow(resourceDeckCard, 4);
        Grid.SetColumnSpan(resourceDeckCard, 5);
        root.Children.Add(resourceDeckCard);

        RefreshRundown();
        return root;
    }

    private static Border BuildProductionPane(
        string title,
        string subtitle,
        Control stage,
        Control actions,
        IBrush accent)
    {
        var grid = new Grid { RowSpacing = 5 };
        grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        grid.RowDefinitions.Add(new RowDefinition(new GridLength(1, GridUnitType.Star)));
        grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        grid.Children.Add(new StackPanel {
            Spacing = 1,
            Children = {
                Label(title, 10, FontWeight.Bold, accent),
                Label(subtitle, 9, FontWeight.Normal, Muted)
            }
        });
        Grid.SetRow(stage, 1);
        grid.Children.Add(stage);
        Grid.SetRow(actions, 2);
        grid.Children.Add(actions);
        return new Border {
            Background = Surface,
            CornerRadius = new CornerRadius(16),
            Padding = new Thickness(9),
            Child = grid
        };
    }

    private async void OnLibraryPointerPressed(object? sender, PointerPressedEventArgs args)
    {
        if (!args.GetCurrentPoint(_rundown).Properties.IsLeftButtonPressed) return;
        var row = FindPointerRundownRow(args);
        if (row is null) return;
        _activeSelectionSurface = "library";
        _selectedRundownItemId = row.Item.Id;
        _rundown.SelectedItem = row;
        RenderSelectedDetails(row.Item);
        args.Handled = true;
        if (args.ClickCount >= 2) await PreviewItemAndTakeAsync(row.Item);
        else await PreviewItemAsync(row.Item);
    }

    private async void OnSchedulePointerPressed(object? sender, PointerPressedEventArgs args)
    {
        if (!args.GetCurrentPoint(_schedule).Properties.IsLeftButtonPressed) return;
        var row = FindPointerRundownRow(args);
        if (row is null) return;
        _activeSelectionSurface = "schedule";
        _selectedScheduleItemId = row.Item.Id;
        _schedule.SelectedItem = row;
        RenderSelectedDetails(row.Item);
        args.Handled = true;
        if (args.ClickCount >= 2) await PreviewItemAndTakeAsync(row.Item);
        else await PreviewItemAsync(row.Item);
    }

    private static OperatorRundownRow? FindPointerRundownRow(PointerPressedEventArgs args)
    {
        if (args.Source is not Visual visual) return null;
        var container = visual.FindAncestorOfType<ListBoxItem>(includeSelf: true);
        return container?.Content as OperatorRundownRow ?? container?.DataContext as OperatorRundownRow;
    }

    private static Control HeaderHint()
    {
        var hint = new Border {
            Background = SurfaceRaised,
            CornerRadius = new CornerRadius(999),
            Padding = new Thickness(12, 7),
            VerticalAlignment = VerticalAlignment.Center,
            Child = Label("F6 PREVIEW   F8 TAKE   F7 CLEAR", 10, FontWeight.Bold, Muted)
        };
        Grid.SetColumn(hint, 1);
        return hint;
    }

    private static Control TransitionHint()
    {
        var hint = Label("Preview is safe · Take is explicit · Clear never stops Edge", 10, FontWeight.SemiBold, Muted);
        hint.VerticalAlignment = VerticalAlignment.Center;
        hint.HorizontalAlignment = HorizontalAlignment.Center;
        return hint;
    }

    private static Control StatusLine(string label, string value)
    {
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), ColumnSpacing = 8 };
        grid.Children.Add(Label(label.ToUpperInvariant(), 9, FontWeight.Bold, Muted));
        var v = Label(value, 11, FontWeight.SemiBold);
        v.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(v, 1);
        grid.Children.Add(v);
        return grid;
    }

    private static Control BuildStage(
        string label,
        TextBlock title,
        TextBlock body,
        TextBlock footer,
        IBrush accent)
    {
        title.TextAlignment = TextAlignment.Center;
        title.FontSize = 28;
        body.TextAlignment = TextAlignment.Center;
        body.TextWrapping = TextWrapping.Wrap;
        body.FontSize = 18;
        footer.TextAlignment = TextAlignment.Center;
        footer.FontSize = 12;

        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        grid.RowDefinitions.Add(new RowDefinition(new GridLength(1, GridUnitType.Star)));
        var stageLabel = Label(label, 12, FontWeight.Bold, accent);
        Grid.SetRow(stageLabel, 0);
        grid.Children.Add(stageLabel);
        var content = new StackPanel {
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            MaxWidth = 520,
            Children = { title, body, footer }
        };
        Grid.SetRow(content, 1);
        grid.Children.Add(content);

        var frame = new Border {
            Width = 640,
            Height = 360,
            Background = Brush("#06090E"),
            BorderBrush = accent,
            BorderThickness = new Thickness(2),
            CornerRadius = new CornerRadius(18),
            Padding = new Thickness(18),
            Child = grid
        };

        return new Viewbox {
            MaxWidth = 340,
            MaxHeight = 191,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Top,
            Child = frame
        };
    }

    private Control BuildSetupContent()
    {
        var root = new Grid { Margin = new Thickness(24), MinWidth = 900 };
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(330)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(18)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));

        var sidebar = new StackPanel { Spacing = 16 };
        sidebar.Children.Add(new Border {
            Background = Surface,
            CornerRadius = new CornerRadius(22),
            Padding = new Thickness(20),
            Child = new StackPanel {
                Spacing = 6,
                Children = {
                    Label("IPRESENTERPLUX", 10, FontWeight.Bold, Gold),
                    Label("Church Edge", 26, FontWeight.Bold),
                    Label("Local presentation, audio, recording and resilient broadcast runtime.", 12, FontWeight.Normal, Muted)
                }
            }
        });

        _statusDetail.TextWrapping = TextWrapping.Wrap;
        sidebar.Children.Add(Card("Runtime status", new StackPanel {
            Spacing = 12,
            Children = {
                new StackPanel {
                    Orientation = Orientation.Horizontal,
                    Spacing = 10,
                    VerticalAlignment = VerticalAlignment.Center,
                    Children = { _statusDot, _statusTitle }
                },
                _statusDetail,
                Separator(),
                _cloudStatus,
                _programStatus
            }
        }));

        var quickLinks = new WrapPanel { Orientation = Orientation.Horizontal, ItemWidth = 138, ItemHeight = 44 };
        quickLinks.Children.Add(LocalOutputButton("Preview", "preview"));
        quickLinks.Children.Add(LocalOutputButton("Program", "program"));
        quickLinks.Children.Add(LinkButton("Control Room", () => CloudUri("/")));
        quickLinks.Children.Add(LinkButton("Streaming Studio", () => CloudUri("/streaming")));
        sidebar.Children.Add(Card("Quick access", quickLinks));

        var sidebarScroll = new ScrollViewer {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            Content = sidebar
        };
        Grid.SetColumn(sidebarScroll, 0);
        root.Children.Add(sidebarScroll);

        var main = new StackPanel { Spacing = 18 };
        main.Children.Add(new StackPanel {
            Spacing = 4,
            Children = {
                Label("Edge setup", 30, FontWeight.Bold),
                Label("Configure this production computer once. Pairing is write-only and never saved by the desktop shell.", 13, FontWeight.Normal, Muted)
            }
        });

        var setupGrid = new Grid { ColumnSpacing = 14, RowSpacing = 12 };
        setupGrid.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        setupGrid.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        setupGrid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        setupGrid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        setupGrid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        setupGrid.Children.Add(Field("Control Plane URL", _controlUrl, 0, 0));
        setupGrid.Children.Add(Field("One-time pairing code", _pairingCode, 0, 1));
        setupGrid.Children.Add(Field("Device name", _deviceName, 1, 0));
        _programDisplayHint.TextWrapping = TextWrapping.Wrap;
        var displayPicker = new StackPanel {
            Spacing = 6,
            Children = { _programDisplay, _programDisplayHint }
        };
        setupGrid.Children.Add(Field("Program output display", displayPicker, 1, 1));

        var actions = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var button in new[] { _save, _start, _restart, _stop })
        {
            button.Margin = new Thickness(0, 0, 10, 0);
            actions.Children.Add(button);
        }
        Grid.SetRow(actions, 2);
        Grid.SetColumnSpan(actions, 2);
        setupGrid.Children.Add(actions);
        main.Children.Add(Card("Connection & enrollment", setupGrid));

        main.Children.Add(Card("Platform capabilities", BuildCapabilities()));
        main.Children.Add(Card("Safety & offline behavior", new StackPanel {
            Spacing = 9,
            Children = {
                Bullet("Projector/Program output and local recording continue when the Control Plane or Internet is unavailable."),
                Bullet("The shell never receives RTMPS keys, provider OAuth tokens, device bearer credentials or recording contents."),
                Bullet("Stopping requests a graceful local runtime shutdown first; force termination is only a timeout fallback."),
                Bullet("Closing this shell cleanly stops the runtime for this first desktop release; background/tray mode is a later release gate.")
            }
        }));
        _feedback.TextWrapping = TextWrapping.Wrap;
        main.Children.Add(_feedback);

        var mainScroll = new ScrollViewer {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            Content = main
        };
        Grid.SetColumn(mainScroll, 2);
        root.Children.Add(mainScroll);
        return root;
    }

    private Control BuildCapabilities()
    {
        var platform = OperatingSystem.IsWindows() ? "Windows" : OperatingSystem.IsMacOS() ? "macOS" : "Unsupported OS";
        var capture = OperatingSystem.IsWindows() ? "WASAPI / Media Foundation" : "CoreAudio / AVFoundation";
        var vault = OperatingSystem.IsWindows() ? "Windows Credential Manager" : "macOS Keychain";
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        grid.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        var items = new[] {
            ("Platform", platform),
            ("Mixer & media", capture),
            ("Credential vault", vault),
            ("Program output", "Local loopback renderer"),
            ("Recording", "Offline WAV with recovery checkpoints"),
            ("Broadcast contribution", "SRT master transport")
        };
        for (var i = 0; i < items.Length; i++)
        {
            var box = new Border {
                Background = SurfaceRaised,
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(14),
                Child = new StackPanel {
                    Spacing = 4,
                    Children = {
                        Label(items[i].Item1.ToUpperInvariant(), 9, FontWeight.Bold, Muted),
                        Label(items[i].Item2, 13, FontWeight.SemiBold)
                    }
                }
            };
            Grid.SetRow(box, i / 2);
            Grid.SetColumn(box, i % 2);
            if (grid.RowDefinitions.Count <= i / 2) grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
            grid.Children.Add(box);
        }
        return grid;
    }

    private OperatorRundownNavigator LibraryNavigator() => new(_workspace.Items);

    private OperatorRundownNavigator ScheduleNavigator() => new(_localSchedule);

    private void RefreshRundown()
    {
        var libraryItems = _workspace.Items;
        var visibleItems = OperatorWorkspaceCatalog.Filter(libraryItems, _activeCategory, _operatorSearch.Text);
        var libraryNavigator = new OperatorRundownNavigator(libraryItems);
        var libraryState = libraryNavigator.BuildState(_operatorSnapshot, visibleItems.Select(item => item.Id));

        if (_selectedRundownItemId is null || !libraryItems.Any(item => item.Id.Equals(_selectedRundownItemId, StringComparison.Ordinal)))
            _selectedRundownItemId = visibleItems.FirstOrDefault()?.Id ?? libraryItems.FirstOrDefault()?.Id;

        var scheduleState = ScheduleNavigator().BuildState(_operatorSnapshot);
        if (_selectedScheduleItemId is null || !_localSchedule.Any(item => item.Id.Equals(_selectedScheduleItemId, StringComparison.Ordinal)))
            _selectedScheduleItemId = _localSchedule.FirstOrDefault()?.Id;

        _rebuildingOperatorCollections = true;
        try
        {
            _rundown.ItemsSource = libraryState.Rows;
            _rundown.SelectedItem = libraryState.Rows.FirstOrDefault(row => row.Item.Id.Equals(_selectedRundownItemId, StringComparison.Ordinal));
            _schedule.ItemsSource = scheduleState.Rows;
            _schedule.SelectedItem = scheduleState.Rows.FirstOrDefault(row => row.Item.Id.Equals(_selectedScheduleItemId, StringComparison.Ordinal));
        }
        finally
        {
            _rebuildingOperatorCollections = false;
        }

        _prepare.IsEnabled = _rundown.SelectedItem is OperatorRundownRow;
        _addSelectedToSchedule.IsEnabled = _selectedDetailItem is not null || _rundown.SelectedItem is OperatorRundownRow;
        _rundownCurrent.Text = $"CURRENT · {scheduleState.CurrentLabel}";
        _rundownCurrent.Foreground = scheduleState.ProgramIsAdHoc ? Warning : scheduleState.CurrentItemId is null ? Muted : Good;
        RefreshScheduleActionState();
    }

    private void MoveRundownSelection(int delta)
    {
        if (_operatorBusy) return;
        if (_activeSelectionSurface == "schedule" && _localSchedule.Count > 0)
            _selectedScheduleItemId = ScheduleNavigator().MoveSelection(_selectedScheduleItemId, delta);
        else if (_workspace.Items.Count > 0)
        {
            _selectedRundownItemId = LibraryNavigator().MoveSelection(_selectedRundownItemId, delta);
            _activeSelectionSurface = "library";
        }
        RefreshRundown();
    }

    private async Task RefreshOperatorAsync()
    {
        if (_operatorBusy) return;
        _operatorBusy = true;
        try
        {
            var response = await _operatorClient.QueryAsync(CancellationToken.None);
            RenderOperatorSnapshot(response.Snapshot);

            var catalogResponse = await _operatorClient.QueryCatalogAsync(CancellationToken.None);
            ApplyCatalogResponse(catalogResponse);

            RefreshOperatorFeedback(response.Snapshot);
        }
        catch
        {
            SetOperatorUnavailable();
        }
        finally
        {
            _operatorBusy = false;
        }
    }

    private void ApplyCatalogResponse(LocalOperatorResponse response)
    {
        if (!response.Ok)
        {
            _catalogStatus.Text = "CATALOG WAITING";
            _catalogStatus.Foreground = Warning;
            _catalogService.Text = SafeOperatorError(response.ErrorCode);
            return;
        }

        var revision = response.Catalog?.CatalogRevision;
        var hasCatalog = response.Catalog is not null;
        var changed = !string.Equals(_catalogRevision, revision, StringComparison.Ordinal) ||
            _catalogStale != response.CatalogStale ||
            _workspace.HasSyncedCatalog != hasCatalog;

        if (changed)
        {
            var selectedVersion = _bibleVersion.SelectedItem as string;
            _workspace = OperatorWorkspaceCatalog.FromCatalog(response.Catalog, response.CatalogStale);
            _catalogRevision = revision;
            _catalogStale = response.CatalogStale;
            if (_selectedRundownItemId is not null &&
                !_workspace.Items.Any(item => item.Id.Equals(_selectedRundownItemId, StringComparison.Ordinal)))
                _selectedRundownItemId = null;

            RefreshBibleVersionChoices(selectedVersion);
            RefreshRundown();
        }

        _rundownEyebrow.Text = "LIBRARY";
        _rundownTitle.Text = "Search & browse";
        _catalogStatus.Text = _workspace.StatusLabel;
        _catalogStatus.Foreground = _workspace.IsRehearsal || _workspace.IsStale ? Warning : Good;
        _catalogService.Text = _workspace.ServiceTitle is { Length: > 0 } title
            ? $"{title} · {_workspace.ServiceStatus ?? "service"}"
            : _workspace.IsRehearsal
                ? _workspace.HasSyncedCatalog
                    ? "Cloud library available · no service assigned"
                    : "Demo content · no synced service yet"
                : "No active service assigned to this Edge.";

        _operatorService.Text = _workspace.ServiceTitle is { Length: > 0 } serviceTitle
            ? $"{serviceTitle.ToUpperInvariant()} · {_workspace.StatusLabel}"
            : _workspace.StatusLabel;
        _operatorService.Foreground = _workspace.IsRehearsal || _workspace.IsStale ? Warning : Good;
    }

    private void RefreshBibleVersionChoices(string? preferredSelection = null)
    {
        preferredSelection ??= _bibleVersion.SelectedItem as string;
        var syncedVersions = _workspace.BibleVersions
            .Select(version => string.IsNullOrWhiteSpace(version.Abbreviation) ? version.Id : version.Abbreviation)
            .Where(version => !string.IsNullOrWhiteSpace(version));
        var localVersions = _desktopBibleLibrary.InstalledVersions().Select(package => package.Abbreviation);
        var versions = syncedVersions
            .Concat(localVersions)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(version => version, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        _bibleVersion.ItemsSource = versions;
        var activeVersion = _workspace.ActiveBibleVersion;
        var activePackage = DesktopBibleLibrary.Downloadable.FirstOrDefault(package =>
            string.Equals(package.Id, activeVersion, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(package.Abbreviation, activeVersion, StringComparison.OrdinalIgnoreCase));
        if (activePackage is not null) activeVersion = activePackage.Abbreviation;

        var preferred = preferredSelection is not null && versions.Contains(preferredSelection, StringComparer.OrdinalIgnoreCase)
            ? versions.First(version => version.Equals(preferredSelection, StringComparison.OrdinalIgnoreCase))
            : activeVersion is not null && versions.Contains(activeVersion, StringComparer.OrdinalIgnoreCase)
                ? versions.First(version => version.Equals(activeVersion, StringComparison.OrdinalIgnoreCase))
                : versions.FirstOrDefault();
        _bibleVersion.SelectedItem = preferred;

        var hasVersion = preferred is not null;
        var localReady = preferred is not null && _desktopBibleLibrary.IsInstalled(preferred);
        var syncedServiceReady = _workspace.HasSyncedCatalog && _workspace.ServiceTitle is { Length: > 0 };
        _scriptureReference.IsEnabled = true;
        _bibleVersion.IsEnabled = hasVersion;
        _resolveScripture.IsEnabled = hasVersion && (localReady || syncedServiceReady);
        _manageBibleVersions.IsEnabled = true;
    }

    private async Task OpenBibleVersionsAsync()
    {
        var manager = new BibleVersionManagerWindow(_desktopBibleLibrary);
        await manager.ShowDialog(this);
        RefreshBibleVersionChoices();
        if (_selectedDetailItem is { Category: "Scripture" } selected)
            RenderSelectedDetails(selected);
    }

    private void RenderSelectedDetails(OperatorWorkspaceItem item)
    {
        _selectedDetailItem = item;
        _detailsTitle.Text = item.Title;
        _detailsMeta.Text = $"{item.Category.ToUpperInvariant()} · {item.Footer ?? item.Accent}";
        _detailsBody.Text = item.Body;
        _addSelectedToSchedule.IsEnabled = true;

        var version = item.Footer ?? _bibleVersion.SelectedItem as string;
        var canBrowseScripture = item.Category.Equals("Scripture", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(version) &&
            _desktopBibleLibrary.IsInstalled(version);
        _scriptureBrowserPanel.IsVisible = canBrowseScripture;
        if (canBrowseScripture)
            _ = PopulateBibleBrowserAsync(item.Title, version!);
    }

    private async Task PopulateBibleBrowserAsync(string reference, string version)
    {
        if (_browserBusy || !_desktopBibleLibrary.IsInstalled(version) ||
            !DesktopBibleLibrary.TryDescribeReference(reference, out var described)) return;
        _browserBusy = true;
        try
        {
            var books = _desktopBibleLibrary.ListBooks();
            _browserBook.ItemsSource = books;
            _browserBook.SelectedItem = books.FirstOrDefault(book => book.Code.Equals(described.BookCode, StringComparison.OrdinalIgnoreCase));
            var chapters = await _desktopBibleLibrary.ListChaptersAsync(version, described.BookCode, CancellationToken.None);
            _browserChapter.ItemsSource = chapters;
            _browserChapter.SelectedItem = chapters.Contains(described.Chapter) ? described.Chapter : chapters.FirstOrDefault();
            _visibleBibleVerses = await _desktopBibleLibrary.LoadChapterAsync(version, described.BookCode, described.Chapter, CancellationToken.None);
            ApplyBibleVersesToBrowser(described.VerseStart, described.VerseEnd);
        }
        catch
        {
            _scriptureBrowserPanel.IsVisible = false;
        }
        finally
        {
            _browserBusy = false;
        }
    }

    private async Task LoadBibleBookChaptersAsync()
    {
        if (_browserBusy || _browserBook.SelectedItem is not DesktopBibleBookDescriptor book) return;
        var version = BrowserBibleVersion();
        if (version is null) return;
        _browserBusy = true;
        try
        {
            var chapters = await _desktopBibleLibrary.ListChaptersAsync(version, book.Code, CancellationToken.None);
            _browserChapter.ItemsSource = chapters;
            _browserChapter.SelectedItem = chapters.FirstOrDefault();
        }
        finally
        {
            _browserBusy = false;
        }
        await LoadBibleChapterAsync();
    }

    private async Task LoadBibleChapterAsync()
    {
        if (_browserBusy || _browserBook.SelectedItem is not DesktopBibleBookDescriptor book ||
            _browserChapter.SelectedItem is not int chapter) return;
        var version = BrowserBibleVersion();
        if (version is null) return;
        _browserBusy = true;
        try
        {
            _visibleBibleVerses = await _desktopBibleLibrary.LoadChapterAsync(version, book.Code, chapter, CancellationToken.None);
            ApplyBibleVersesToBrowser(null, null);
        }
        finally
        {
            _browserBusy = false;
        }
    }

    private void ApplyBibleVersesToBrowser(int? verseStart, int? verseEnd)
    {
        _browserVerses.ItemsSource = _visibleBibleVerses;
        var verseNumbers = _visibleBibleVerses.Select(item => item.Verse).ToArray();
        _browserFromVerse.ItemsSource = verseNumbers;
        _browserToVerse.ItemsSource = verseNumbers;
        if (verseNumbers.Length == 0)
        {
            _browserFromVerse.SelectedItem = null;
            _browserToVerse.SelectedItem = null;
            _browserPreviewRange.IsEnabled = false;
            return;
        }
        var from = verseStart is { } requestedStart && verseNumbers.Contains(requestedStart) ? requestedStart : verseNumbers[0];
        var to = verseEnd is { } requestedEnd && verseNumbers.Contains(requestedEnd) ? requestedEnd : from;
        _browserFromVerse.SelectedItem = from;
        _browserToVerse.SelectedItem = to;
        _browserPreviewRange.IsEnabled = true;
    }

    private void NormalizeBrowserVerseRange()
    {
        if (_browserBusy || _browserFromVerse.SelectedItem is not int from || _browserToVerse.SelectedItem is not int to) return;
        if (to < from) _browserToVerse.SelectedItem = from;
    }

    private string? BrowserBibleVersion()
    {
        var detailVersion = _selectedDetailItem?.Footer;
        if (!string.IsNullOrWhiteSpace(detailVersion) && _desktopBibleLibrary.IsInstalled(detailVersion)) return detailVersion;
        var selected = _bibleVersion.SelectedItem as string;
        return !string.IsNullOrWhiteSpace(selected) && _desktopBibleLibrary.IsInstalled(selected) ? selected : null;
    }

    private async Task PreviewBrowserVerseRangeAsync()
    {
        if (_browserBook.SelectedItem is not DesktopBibleBookDescriptor book ||
            _browserChapter.SelectedItem is not int chapter ||
            _browserFromVerse.SelectedItem is not int from ||
            _browserToVerse.SelectedItem is not int to)
        {
            SetOperatorFeedback("Choose a Bible book, chapter and verse range first.", true);
            return;
        }
        var version = BrowserBibleVersion();
        if (version is null)
        {
            SetOperatorFeedback("Download the selected Bible version before browsing verses offline.", true);
            return;
        }
        var passage = await _desktopBibleLibrary.ResolveRangeAsync(version, book.Code, chapter, from, to, CancellationToken.None);
        if (passage is null)
        {
            SetOperatorFeedback("That verse range is not available in the downloaded Bible.", true);
            return;
        }
        var item = LocalScriptureItem(passage);
        _activeSelectionSurface = "library";
        RenderSelectedDetails(item);
        await PreviewItemAsync(item);
    }

    private async Task AddSelectedToScheduleAsync()
    {
        var item = _selectedDetailItem ?? SelectedOperatorItem();
        if (item is null)
        {
            SetOperatorFeedback("Select a Library item before adding it to the service schedule.", true);
            return;
        }
        if (_localSchedule.Any(candidate => candidate.Id.Equals(item.Id, StringComparison.Ordinal)))
        {
            _selectedScheduleItemId = item.Id;
            RefreshRundown();
            SetOperatorFeedback($"{item.Title} is already in the local service schedule.", false);
            return;
        }
        _localSchedule.Add(item);
        _selectedScheduleItemId = item.Id;
        await _scheduleStore.SaveAsync(_localSchedule, CancellationToken.None);
        RefreshRundown();
        SetOperatorFeedback($"Added to service schedule: {item.Title}", false);
    }

    private async Task RemoveScheduledAsync()
    {
        var item = SelectedScheduleItem();
        if (item is null) return;
        var index = _localSchedule.FindIndex(candidate => candidate.Id.Equals(item.Id, StringComparison.Ordinal));
        if (index < 0) return;
        _localSchedule.RemoveAt(index);
        _selectedScheduleItemId = _localSchedule.Count == 0 ? null : _localSchedule[Math.Min(index, _localSchedule.Count - 1)].Id;
        await _scheduleStore.SaveAsync(_localSchedule, CancellationToken.None);
        RefreshRundown();
        SetOperatorFeedback($"Removed from service schedule: {item.Title}", false);
    }

    private async Task MoveScheduledAsync(int direction)
    {
        var item = SelectedScheduleItem();
        if (item is null || direction == 0) return;
        var index = _localSchedule.FindIndex(candidate => candidate.Id.Equals(item.Id, StringComparison.Ordinal));
        if (index < 0) return;
        var target = Math.Clamp(index + Math.Sign(direction), 0, _localSchedule.Count - 1);
        if (target == index) return;
        (_localSchedule[index], _localSchedule[target]) = (_localSchedule[target], _localSchedule[index]);
        _selectedScheduleItemId = item.Id;
        await _scheduleStore.SaveAsync(_localSchedule, CancellationToken.None);
        RefreshRundown();
    }

    private void RefreshScheduleActionState()
    {
        var item = SelectedScheduleItem();
        var index = item is null ? -1 : _localSchedule.FindIndex(candidate => candidate.Id.Equals(item.Id, StringComparison.Ordinal));
        _removeScheduled.IsEnabled = index >= 0;
        _moveScheduledUp.IsEnabled = index > 0;
        _moveScheduledDown.IsEnabled = index >= 0 && index < _localSchedule.Count - 1;
    }

    private async Task ResolveAndPreviewScriptureAsync()
    {
        var reference = _scriptureReference.Text?.Trim() ?? string.Empty;
        if (reference.Length < 3)
        {
            SetOperatorFeedback("Enter a scripture reference such as John 3:16 or Psalm 23.", true);
            return;
        }
        if (_operatorBusy) return;

        _operatorBusy = true;
        try
        {
            var version = _bibleVersion.SelectedItem as string;
            if (string.IsNullOrWhiteSpace(version))
            {
                SetOperatorFeedback("No Bible version is ready. Open Bible Versions and download one for offline use.", true);
                return;
            }

            if (_desktopBibleLibrary.IsInstalled(version))
            {
                var passage = await _desktopBibleLibrary.ResolveAsync(reference, version, CancellationToken.None);
                if (passage is null)
                {
                    SetOperatorFeedback($"Passage not found in the downloaded {version} Bible. Check the reference and try again.", true);
                    return;
                }

                var localItem = LocalScriptureItem(passage);
                _activeSelectionSurface = "library";
                RenderSelectedDetails(localItem);
                var localPreview = await _operatorClient.SendAsync(
                    LocalOperatorCommands.PreviewRender,
                    localItem.ToPresentation(),
                    CancellationToken.None);
                RenderOperatorSnapshot(localPreview.Snapshot);
                if (localPreview.Ok)
                    SetOperatorFeedback($"Scripture prepared in Preview: {localItem.Title} · {passage.VersionAbbreviation} · offline Bible.", false);
                else
                    SetOperatorFeedback(SafeOperatorError(localPreview.ErrorCode), true);
                return;
            }

            if (!_workspace.HasSyncedCatalog || _workspace.ServiceTitle is not { Length: > 0 })
            {
                SetOperatorFeedback($"{version} is not downloaded on this PC. Open Bible Versions to install an offline edition, or sync/start a service for cloud Scripture.", true);
                return;
            }

            var resolved = await _operatorClient.ResolveScriptureAsync(reference, version, CancellationToken.None);
            RenderOperatorSnapshot(resolved.Snapshot);
            if (!resolved.Ok)
            {
                SetOperatorFeedback(SafeOperatorError(resolved.ErrorCode), true);
                return;
            }
            if (resolved.ResolvedPresentation is null)
            {
                SetOperatorFeedback("The Edge runtime returned no scripture passage for that reference.", true);
                return;
            }

            var item = OperatorWorkspaceCatalog.FromResolved(resolved.ResolvedPresentation);
            _activeSelectionSurface = "library";
            RenderSelectedDetails(item);
            var preview = await _operatorClient.SendAsync(
                LocalOperatorCommands.PreviewRender,
                item.ToPresentation(),
                CancellationToken.None);
            RenderOperatorSnapshot(preview.Snapshot);
            if (preview.Ok)
                SetOperatorFeedback($"Scripture prepared in Preview: {item.Title} · {item.Footer ?? version}.", false);
            else
                SetOperatorFeedback(SafeOperatorError(preview.ErrorCode), true);
        }
        catch (ArgumentException)
        {
            SetOperatorFeedback("Enter a valid scripture reference and Bible version.", true);
        }
        catch
        {
            SetOperatorUnavailable();
        }
        finally
        {
            _operatorBusy = false;
        }
    }

    private static OperatorWorkspaceItem LocalScriptureItem(DesktopBiblePassage passage)
    {
        var identity = Encoding.UTF8.GetBytes($"{passage.VersionId}:{passage.Reference}");
        var hash = Convert.ToHexString(SHA256.HashData(identity)).ToLowerInvariant()[..16];
        return new OperatorWorkspaceItem(
            $"local-scripture-{hash}",
            "Scripture",
            passage.Reference,
            passage.Text,
            passage.VersionAbbreviation,
            "SCRIPTURE",
            "scripture",
            IsSynced: false);
    }

    private OperatorWorkspaceItem? SelectedLibraryItem() =>
        _rundown.SelectedItem is OperatorRundownRow row ? row.Item : null;

    private OperatorWorkspaceItem? SelectedScheduleItem() =>
        _schedule.SelectedItem is OperatorRundownRow row ? row.Item : null;

    private OperatorWorkspaceItem? SelectedOperatorItem() =>
        _activeSelectionSurface == "schedule" ? SelectedScheduleItem() : SelectedLibraryItem();

    private Task PreviewSelectedAsync()
    {
        var item = SelectedOperatorItem();
        if (item is null)
        {
            SetOperatorFeedback("Select a Library or Schedule item first.", true);
            return Task.CompletedTask;
        }
        return PreviewItemAsync(item);
    }

    private async Task PreviewItemAsync(OperatorWorkspaceItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (_operatorBusy) return;
        if (_activeSelectionSurface == "schedule") _selectedScheduleItemId = item.Id;
        else _selectedRundownItemId = item.Id;

        var canPrepareByIdentity = item.IsSynced &&
            (_workspace.RundownItems.Any(candidate => candidate.Id.Equals(item.Id, StringComparison.Ordinal)) ||
             item.Category.Equals("Media", StringComparison.OrdinalIgnoreCase));
        if (canPrepareByIdentity)
        {
            _operatorBusy = true;
            try
            {
                var response = await _operatorClient.PreparePreviewItemAsync(item.Id, CancellationToken.None);
                RenderOperatorSnapshot(response.Snapshot);
                SetOperatorFeedback(response.Ok ? $"Preview prepared: {item.Title}" : SafeOperatorError(response.ErrorCode), !response.Ok);
            }
            catch
            {
                SetOperatorUnavailable();
            }
            finally
            {
                _operatorBusy = false;
            }
            return;
        }

        await SendOperatorAsync(LocalOperatorCommands.PreviewRender, item.ToPresentation(), $"Preview prepared: {item.Title}");
    }

    private async Task PreviewSelectedAndTakeAsync()
    {
        var selected = SelectedOperatorItem();
        if (selected is null) return;
        await PreviewItemAndTakeAsync(selected);
    }

    private async Task PreviewScheduleSelectedAsync()
    {
        var item = SelectedScheduleItem();
        if (item is null) return;
        _activeSelectionSurface = "schedule";
        await PreviewItemAsync(item);
    }

    private async Task PreviewScheduleSelectedAndTakeAsync()
    {
        var item = SelectedScheduleItem();
        if (item is null) return;
        _activeSelectionSurface = "schedule";
        await PreviewItemAndTakeAsync(item);
    }

    private async Task PreviewItemAndTakeAsync(OperatorWorkspaceItem selected)
    {
        var itemId = selected.Id;
        var deadline = DateTimeOffset.UtcNow.AddSeconds(5);
        while (_operatorBusy && DateTimeOffset.UtcNow < deadline)
            await Task.Delay(25);
        if (_operatorBusy)
        {
            SetOperatorFeedback("The previous operator action is still finishing. Try the item again.", true);
            return;
        }

        if (!string.Equals(_operatorSnapshot.Preview?.ItemId, itemId, StringComparison.Ordinal))
        {
            await PreviewItemAsync(selected);
            if (!string.Equals(_operatorSnapshot.Preview?.ItemId, itemId, StringComparison.Ordinal)) return;
        }
        await TakeAsync();
    }

    private async Task TakeAsync()
    {
        if (_operatorBusy) return;
        var scheduleSelectionBeforeTake = _selectedScheduleItemId;
        _operatorBusy = true;
        try
        {
            var response = await _operatorClient.SendAsync(LocalOperatorCommands.ProgramTake, null, CancellationToken.None);
            RenderOperatorSnapshot(response.Snapshot);
            if (response.Ok)
            {
                if (_activeSelectionSurface == "schedule")
                {
                    _selectedScheduleItemId = ScheduleNavigator().AdvanceAfterTake(
                        scheduleSelectionBeforeTake,
                        response.Snapshot.Program?.ItemId,
                        response.Ok);
                }
                RefreshRundown();
                SetOperatorFeedback("Preview taken to Program.", false);
            }
            else
            {
                SetOperatorFeedback(SafeOperatorError(response.ErrorCode), true);
            }
        }
        catch
        {
            SetOperatorUnavailable();
        }
        finally
        {
            _operatorBusy = false;
        }
    }

    private Task ClearProgramAsync() => SendOperatorAsync(
        LocalOperatorCommands.ProgramClear,
        null,
        "Program cleared.");

    private Task PauseProgramMediaAsync() => SendOperatorAsync(
        LocalOperatorCommands.MediaPause,
        null,
        "Program media paused.");

    private Task ResumeProgramMediaAsync() => SendOperatorAsync(
        LocalOperatorCommands.MediaResume,
        null,
        "Program media resumed.");

    private async Task SeekProgramMediaAsync()
    {
        var text = _mediaSeek.Text?.Trim() ?? string.Empty;
        if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds) ||
            !double.IsFinite(seconds))
        {
            SetOperatorFeedback("Enter a valid media position in seconds.", true);
            return;
        }

        if (_operatorBusy) return;
        _operatorBusy = true;
        try
        {
            var response = await _operatorClient.SeekMediaAsync(seconds, CancellationToken.None);
            RenderOperatorSnapshot(response.Snapshot);
            SetOperatorFeedback(
                response.Ok ? "Program media seek updated." : SafeOperatorError(response.ErrorCode),
                !response.Ok);
        }
        catch
        {
            SetOperatorUnavailable();
        }
        finally
        {
            _operatorBusy = false;
        }
    }

    private Task ToggleRecordingAsync() => SendOperatorAsync(
        _recordingActive ? LocalOperatorCommands.RecordingStop : LocalOperatorCommands.RecordingStart,
        null,
        _recordingActive ? "Recording stopped." : "Recording started.");

    private async Task SendOperatorAsync(
        string command,
        LocalOperatorPresentation? presentation,
        string successMessage)
    {
        if (_operatorBusy) return;
        _operatorBusy = true;
        try
        {
            var response = await _operatorClient.SendAsync(command, presentation, CancellationToken.None);
            RenderOperatorSnapshot(response.Snapshot);
            if (response.Ok)
                SetOperatorFeedback(successMessage, false);
            else
                SetOperatorFeedback(SafeOperatorError(response.ErrorCode), true);
        }
        catch
        {
            SetOperatorUnavailable();
        }
        finally
        {
            _operatorBusy = false;
        }
    }

    private void RenderOperatorSnapshot(LocalOperatorSnapshot snapshot)
    {
        var previousSnapshot = _operatorSnapshot;
        _operatorSnapshot = snapshot;
        RenderStage(snapshot.Preview, _previewTitle, _previewBody, _previewFooter, "Preview is clear", "Select a cue and press Preview Selected.", "PREVIEW", Gold);
        RenderStage(snapshot.Program, _programTitle, _programBody, _programFooter, "Program is clear", "Nothing is currently live on Program.", "PROGRAM", Good);

        _operatorRuntime.Text = snapshot.OutputRunning ? "EDGE OUTPUT READY" : "EDGE ACTIVE · OUTPUT STOPPED";
        _operatorRuntime.Foreground = snapshot.OutputRunning ? Good : Warning;
        _operatorService.Text = snapshot.ActiveServiceId is { } serviceId
            ? $"SERVICE · {serviceId.ToString("N")[..8].ToUpperInvariant()}"
            : "LOCAL REHEARSAL";
        _operatorService.Foreground = snapshot.ActiveServiceId is null ? Warning : Good;
        _recordingActive = snapshot.IsRecording;
        _operatorRecording.Text = snapshot.IsRecording ? "RECORDING ACTIVE" : "RECORDING OFF";
        _operatorRecording.Foreground = snapshot.IsRecording ? Danger : Muted;
        _microphoneStatus.Text = string.Equals(snapshot.AudioStatus, "Capturing", StringComparison.OrdinalIgnoreCase)
            ? $"MIC · {snapshot.ActiveAudioInput ?? "LISTENING"}"
            : $"MIC · {(snapshot.AudioStatus ?? "WAITING").ToUpperInvariant()}";
        _microphoneStatus.Foreground = string.Equals(snapshot.AudioStatus, "Capturing", StringComparison.OrdinalIgnoreCase) ? Good : Warning;
        _asrStatus.Text = $"ASR · {(snapshot.AsrStatus ?? "CHECKING").ToUpperInvariant()}";
        _asrStatus.Foreground = string.Equals(snapshot.AsrStatus, "ready", StringComparison.OrdinalIgnoreCase) ? Good : Warning;
        var voiceReady = string.Equals(snapshot.AudioStatus, "Capturing", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(snapshot.AsrStatus, "ready", StringComparison.OrdinalIgnoreCase);
        _voiceScriptureStatus.Text = voiceReady ? "VOICE SCRIPTURE · LISTENING" : "VOICE SCRIPTURE · WAITING";
        _voiceScriptureStatus.Foreground = voiceReady ? Good : Gold;
        _record.Content = snapshot.IsRecording ? "Stop Recording" : "Start Recording";
        _record.IsEnabled = snapshot.ActiveServiceId is not null;
        _take.IsEnabled = OperatorWorkspaceCatalog.CanTakePreview(snapshot);
        _clear.IsEnabled = snapshot.Program is not null;
        var dynamicProgram = IsDynamicProgramMedia(snapshot.Program);
        var playback = snapshot.MediaPlayback is { } current &&
            snapshot.Program is { } program &&
            string.Equals(current.ItemId, program.ItemId, StringComparison.Ordinal) &&
            current.ServiceId == program.ServiceId ? current : null;
        _mediaPause.IsVisible = dynamicProgram;
        _mediaResume.IsVisible = dynamicProgram;
        _mediaSeek.IsVisible = dynamicProgram;
        _mediaSeekApply.IsVisible = dynamicProgram;
        _mediaPause.IsEnabled = dynamicProgram && playback?.State == "playing";
        _mediaResume.IsEnabled = dynamicProgram && playback?.State is "paused" or "recovery_required" or "ended" or "error";
        _mediaSeek.IsEnabled = dynamicProgram && playback is not null;
        _mediaSeekApply.IsEnabled = dynamicProgram && playback is not null;
        if (playback is not null && !_mediaSeek.IsFocused)
            _mediaSeek.Text = playback.EffectivePositionSeconds.ToString("0.###", CultureInfo.InvariantCulture);
        if (OperatorPresentationChanged(previousSnapshot, snapshot))
            RefreshRundown();
    }

    private void RefreshOperatorFeedback(LocalOperatorSnapshot snapshot)
    {
        var connected = snapshot.ConnectionStatus.Equals("Online", StringComparison.OrdinalIgnoreCase) ||
            snapshot.ConnectionStatus.Equals("Connected", StringComparison.OrdinalIgnoreCase);
        var text = connected
            ? _workspace.IsStale
                ? "Local control is connected; the displayed service catalog is an offline cache."
                : "Local control and Control Plane are connected."
            : "Local control is available; cloud connectivity may be degraded.";
        var foreground = connected && !_workspace.IsStale ? Good : Warning;
        if (!string.Equals(_operatorFeedback.Text, text, StringComparison.Ordinal))
            _operatorFeedback.Text = text;
        if (!ReferenceEquals(_operatorFeedback.Foreground, foreground))
            _operatorFeedback.Foreground = foreground;
    }

    private static bool OperatorPresentationChanged(LocalOperatorSnapshot previous, LocalOperatorSnapshot current)
    {
        if (!string.Equals(previous.Preview?.ItemId, current.Preview?.ItemId, StringComparison.Ordinal) ||
            !string.Equals(previous.Program?.ItemId, current.Program?.ItemId, StringComparison.Ordinal) ||
            previous.ActiveServiceId != current.ActiveServiceId)
            return true;

        var previousPlayback = previous.MediaPlayback?.State;
        var currentPlayback = current.MediaPlayback?.State;
        if (!string.Equals(previousPlayback, currentPlayback, StringComparison.Ordinal)) return true;

        static string PreparationKey(LocalOperatorSnapshot snapshot) => string.Join('|',
            (snapshot.MediaPreparations ?? Array.Empty<LocalOperatorMediaPreparation>())
                .OrderBy(item => item.ItemId, StringComparer.Ordinal)
                .Select(item => $"{item.ItemId}:{item.State}:{item.ErrorCode}"));
        return !string.Equals(PreparationKey(previous), PreparationKey(current), StringComparison.Ordinal);
    }

    private static bool IsDynamicProgramMedia(PresentationRenderItem? item) =>
        item?.Media is { } media &&
        (string.Equals(media.MediaKind, "video", StringComparison.OrdinalIgnoreCase) ||
         string.Equals(media.MediaKind, "audio", StringComparison.OrdinalIgnoreCase));

    private static void RenderStage(
        iPresenterPlux.Edge.Core.Contracts.PresentationRenderItem? item,
        TextBlock title,
        TextBlock body,
        TextBlock footer,
        string emptyTitle,
        string emptyBody,
        string emptyFooter,
        IBrush accent)
    {
        if (item is null)
        {
            title.Text = emptyTitle;
            body.Text = emptyBody;
            body.Foreground = Muted;
            footer.Text = emptyFooter;
            footer.Foreground = accent;
            return;
        }
        title.Text = item.Title;
        body.Text = item.Body;
        body.Foreground = Brushes.White;
        footer.Text = string.IsNullOrWhiteSpace(item.Footer) ? item.ItemType.ToUpperInvariant() : item.Footer;
        footer.Foreground = accent;
    }

    private void SetOperatorUnavailable()
    {
        _operatorSnapshot = new LocalOperatorSnapshot(
            false, null, null, false, null, "Offline", null, "rehearsal", DateTimeOffset.UtcNow);
        _operatorRuntime.Text = "EDGE OFFLINE";
        _operatorRuntime.Foreground = Muted;
        _operatorService.Text = "LOCAL CONTROL WAITING";
        _operatorService.Foreground = Warning;
        _operatorRecording.Text = "RECORDING OFF";
        _operatorRecording.Foreground = Muted;
        _operatorFeedback.Text = "Start Edge to enable local Preview, Program and recording controls.";
        _operatorFeedback.Foreground = Muted;
        _recordingActive = false;
        _record.Content = "Start Recording";
        _record.IsEnabled = false;
        _take.IsEnabled = false;
        _clear.IsEnabled = false;
        _mediaPause.IsVisible = false;
        _mediaResume.IsVisible = false;
        _mediaSeek.IsVisible = false;
        _mediaSeekApply.IsVisible = false;
        _mediaPause.IsEnabled = false;
        _mediaResume.IsEnabled = false;
        _mediaSeek.IsEnabled = false;
        _mediaSeekApply.IsEnabled = false;
        RefreshRundown();
    }

    private void SetOperatorFeedback(string message, bool failed)
    {
        _operatorFeedback.Text = message;
        _operatorFeedback.Foreground = failed ? Danger : Good;
    }

    private static string SafeOperatorError(string? code) => code switch
    {
        "preview_required" => "Prepare a cue in Preview before taking it to Program.",
        "service_required" => "This action requires an active service assignment. Preview and Program still work in rehearsal mode.",
        "recording_unavailable" => "Local recording is not available on this runtime.",
        "invalid_runtime_state" => "The local runtime is not ready for that action yet.",
        "media_control_unavailable" => "Program does not currently contain controllable video or audio.",
        "media_seek_invalid" => "Enter a valid media position in seconds.",
        "media_download_failed" => "Media download failed. Check the connection, then Preview again.",
        "media_remote_unsafe" => "This media source was blocked for safety. Choose an approved HTTPS media source and Preview again.",
        "media_too_large" => "This media file is too large for the Edge cache. Use a smaller supported file and Preview again.",
        "media_type_unsupported" => "This media format is not supported. Use PNG/JPEG/WebP, H.264/AAC MP4, MP3/M4A or WAV and Preview again.",
        "media_corrupt" => "This media file could not be validated. Replace the source with a supported file and Preview again.",
        "media_cache_full" => "Edge media cache is full. Free disk space, then Preview again.",
        "media_scope_mismatch" => "This media cue belongs to a different service. Refresh the service rundown and Preview again.",
        "media_browser_playback_blocked" => "Program media playback was blocked by the local renderer. Clear Program and Preview again.",
        "media_video_decode_failed" or "media_audio_decode_failed" => "Edge could not decode this media file. Use a supported media file and Preview again.",
        "scripture_query_required" or "scripture_reference_invalid" => "Enter a scripture reference such as John 3:16 or Psalm 23.",
        "bible_version_invalid" => "Choose a valid Bible version for this service.",
        "scripture_unavailable_offline" => "That passage is not in the offline cache. Reconnect the Control Plane or choose a cached passage.",
        "scripture_resolve_failed" => "Scripture lookup could not be completed. Check the reference and try again.",
        "catalog_unavailable" or "catalog_scope_mismatch" => "The service catalog is still synchronizing with this Edge runtime.",
        "presentation_required" or "body_invalid" or "item_id_invalid" or "item_type_invalid" => "That cue is not valid for local presentation.",
        _ => "The Edge runtime rejected that local operator action."
    };

    private void RefreshProgramDisplays(bool topologyChanged = false)
    {
        var screens = Screens.All;
        var targets = screens.Select((screen, index) =>
        {
            var bounds = screen.Bounds;
            var displayName = screen.DisplayName?.Trim();
            var label = string.IsNullOrWhiteSpace(displayName) ? $"Display {index + 1}" : displayName;
            var id = string.IsNullOrWhiteSpace(displayName)
                ? $"display:{bounds.X},{bounds.Y}:{bounds.Width}x{bounds.Height}"
                : displayName;
            return new ProgramDisplayTarget(id, label, bounds.X, bounds.Y, bounds.Width, bounds.Height, screen.IsPrimary);
        }).ToArray();

        var preferredId = (_programDisplay.SelectedItem as ProgramDisplayTarget)?.Id ?? _settings.ProgramDisplayId;
        _programDisplay.ItemsSource = targets;
        if (string.IsNullOrWhiteSpace(preferredId))
        {
            _programDisplay.SelectedItem = null;
            _programDisplayHint.Text = targets.Length == 0
                ? "No connected display was detected. Program kiosk output will stay closed until a display is available."
                : "Choose the projector or secondary display. Program kiosk output stays closed until a display is selected.";
            _programDisplayHint.Foreground = targets.Length == 0 ? Warning : Muted;
            return;
        }

        var selection = ProgramDisplaySelector.Resolve(preferredId, targets);
        _programDisplay.SelectedItem = selection.Target;
        RenderProgramDisplayHint(selection.Target, selection.UsedFallback, topologyChanged);
    }

    private void RenderProgramDisplayHint(
        ProgramDisplayTarget? target,
        bool usedFallback,
        bool topologyChanged)
    {
        if (target is null)
        {
            _programDisplayHint.Text = "No connected display was detected. Program kiosk output will stay closed until a display is available.";
            _programDisplayHint.Foreground = Warning;
            return;
        }

        if (usedFallback)
        {
            _programDisplayHint.Text = $"The saved Program display is unavailable. {target.Label} will be used on the next Edge start.";
            _programDisplayHint.Foreground = Warning;
            return;
        }

        _programDisplayHint.Text = topologyChanged
            ? $"Display topology changed. Program will use {target.Label} · {target.Width}×{target.Height} on the next Edge start."
            : $"Program opens full-screen on {target.Label} · {target.Width}×{target.Height} when Edge starts.";
        _programDisplayHint.Foreground = Muted;
    }

    private async Task LoadAsync()
    {
        _settings = await _settingsStore.LoadAsync(CancellationToken.None);
        if (string.IsNullOrWhiteSpace(_settings.InstallationId))
            _settings = _settings with { InstallationId = Guid.NewGuid().ToString("N") };
        _controlUrl.Text = _settings.ControlPlaneUrl;
        _activationControlUrl.Text = _settings.ControlPlaneUrl;
        _deviceName.Text = _settings.DeviceName;
        RefreshProgramDisplays();
        _localSchedule = (await _scheduleStore.LoadAsync(CancellationToken.None)).ToList();
        _selectedScheduleItemId = _localSchedule.FirstOrDefault()?.Id;
        RefreshRundown();

        var validation = await LoadEntitlementAsync();
        _tabs.SelectedIndex = validation?.IsUsable == true ? OperatorTabIndex : ActivationTabIndex;
        if (string.IsNullOrWhiteSpace(_settings.ControlPlaneUrl))
        {
            _statusTitle.Text = "Setup required";
            _statusDetail.Text = "Enter the secure Control Plane URL and device name, then pair this computer.";
            _statusDot.Background = Warning;
        }

        SetOperatorUnavailable();
        _operatorTimer.Start();
        await RefreshOperatorAsync();
        if (!File.Exists(_paths.RuntimeHostPath))
            SetFeedback("The packaged Edge runtime is not beside the shell yet. CI packaging must stage it before field use.", true);
    }

    private DesktopSettings ReadSettings()
    {
        var display = _programDisplay.SelectedItem as ProgramDisplayTarget;
        return new DesktopSettings(
            _controlUrl.Text?.Trim() ?? "",
            _deviceName.Text?.Trim() ?? "",
            _settings.ProgramPort,
            _settings.InstallationId,
            _settings.UpdateChannel,
            _settings.UpdateHubUrl,
            display?.Id,
            display?.X,
            display?.Y,
            display?.Width,
            display?.Height).Normalize();
    }

    private async Task SaveAsync()
    {
        try
        {
            _settings = ReadSettings();
            await _settingsStore.SaveAsync(_settings, CancellationToken.None);
            _activationControlUrl.Text = _settings.ControlPlaneUrl;
            SetFeedback("Settings saved. Pairing code was not persisted.", false);
        }
        catch (Exception error)
        {
            SetFeedback(error.Message, true);
        }
    }

    private async Task StartAsync()
    {
        try
        {
            if (!await EnsureEntitlementForStartAsync()) return;
            _settings = ReadSettings();
            await _settingsStore.SaveAsync(_settings, CancellationToken.None);
            var pairing = _pairingCode.Text;
            _pairingCode.Text = "";
            await _supervisor.StartAsync(_settings, pairing, CancellationToken.None);
            SetFeedback("Start request sent. Pairing input was cleared from the shell.", false);
        }
        catch (Exception error) { SetFeedback(error.Message, true); }
    }

    private async Task StopAsync()
    {
        try
        {
            await _supervisor.StopAsync(CancellationToken.None);
            SetFeedback("Edge runtime stopped.", false);
        }
        catch (Exception error) { SetFeedback(error.Message, true); }
    }

    private async Task RestartAsync()
    {
        try
        {
            if (!await EnsureEntitlementForStartAsync()) return;
            _settings = ReadSettings();
            await _settingsStore.SaveAsync(_settings, CancellationToken.None);
            var pairing = _pairingCode.Text;
            _pairingCode.Text = "";
            await _supervisor.RestartAsync(_settings, pairing, CancellationToken.None);
            SetFeedback("Edge runtime restart requested.", false);
        }
        catch (Exception error) { SetFeedback(error.Message, true); }
    }

    private async Task<EntitlementValidation?> LoadEntitlementAsync()
    {
        DesktopEntitlementCache? cache;
        try
        {
            cache = await _entitlementStore.ReadAsync(CancellationToken.None);
        }
        catch (InvalidDataException)
        {
            await _entitlementStore.ClearAsync(CancellationToken.None);
            RenderEntitlement(null, null, "Saved activation data was corrupted and has been cleared.");
            return null;
        }

        if (cache is null)
        {
            RenderEntitlement(null, null, "Activation required.");
            return null;
        }
        if (_entitlementPublicKeys.Count == 0)
        {
            RenderEntitlement(null, cache, "Activation verification is not configured in this desktop release.");
            return null;
        }

        var validation = EntitlementVerifier.Verify(cache.Envelope, _entitlementPublicKeys, DateTimeOffset.UtcNow, cache.LastTrustedNow);
        if (validation.Payload is not null && validation.TrustedNow > cache.LastTrustedNow)
            await _entitlementStore.SaveAsync(cache with { LastTrustedNow = validation.TrustedNow }, CancellationToken.None);
        RenderEntitlement(validation, cache);
        return validation;
    }

    private async Task ActivateLicenseAsync()
    {
        if (_entitlementPublicKeys.Count == 0)
        {
            SetEntitlementFeedback("This desktop build does not contain an entitlement verification public key. Install an official signed release or contact Lightworld support.", true);
            return;
        }

        var productKey = _productKey.Text?.Trim() ?? string.Empty;
        _productKey.Text = string.Empty;
        try
        {
            var controlPlane = ValidateActivationControlPlane();
            _controlUrl.Text = controlPlane.ToString().TrimEnd('/');
            _settings = (_settings with
            {
                ControlPlaneUrl = _controlUrl.Text,
                DeviceName = _deviceName.Text?.Trim() ?? Environment.MachineName
            }).Normalize();
            await _settingsStore.SaveAsync(_settings, CancellationToken.None);

            var validation = await _entitlementClient.ActivateAsync(
                controlPlane,
                productKey,
                _settings.InstallationId,
                OperatingSystem.IsWindows() ? "windows" : OperatingSystem.IsMacOS() ? "macos" : "desktop",
                typeof(MainWindow).Assembly.GetName().Version?.ToString() ?? "1.0.0",
                _settings.DeviceName,
                CancellationToken.None);
            var cache = await _entitlementStore.ReadAsync(CancellationToken.None);
            RenderEntitlement(validation, cache, "Activation succeeded. Pair this computer with the church Control Plane to continue.");
            _tabs.SelectedIndex = SetupTabIndex;
        }
        catch (Exception error)
        {
            SetEntitlementFeedback(SafeLicensingError(error), true);
            _tabs.SelectedIndex = ActivationTabIndex;
        }
    }

    private async Task RenewEntitlementAsync()
    {
        if (_entitlementPublicKeys.Count == 0)
        {
            SetEntitlementFeedback("This desktop build does not contain an entitlement verification public key.", true);
            return;
        }
        try
        {
            var validation = await _entitlementClient.RenewAsync(ValidateActivationControlPlane(), CancellationToken.None);
            var cache = await _entitlementStore.ReadAsync(CancellationToken.None);
            RenderEntitlement(validation, cache, "Subscription validation refreshed.");
            if (validation.IsUsable) _tabs.SelectedIndex = OperatorTabIndex;
        }
        catch (Exception error)
        {
            SetEntitlementFeedback(SafeLicensingError(error), true);
        }
    }

    private async Task<bool> EnsureEntitlementForStartAsync()
    {
        var validation = await LoadEntitlementAsync();
        if (validation?.IsUsable == true) return true;

        if (!string.IsNullOrWhiteSpace(_settings.ControlPlaneUrl) && _entitlementPublicKeys.Count > 0)
        {
            try
            {
                validation = await _entitlementClient.RenewAsync(_settings.ValidateControlPlaneUri(), CancellationToken.None);
                var cache = await _entitlementStore.ReadAsync(CancellationToken.None);
                RenderEntitlement(validation, cache, "Subscription validation refreshed before starting Edge.");
                if (validation.IsUsable) return true;
            }
            catch
            {
                // A failed online refresh must not terminate an already-running service. This gate only blocks a new start/restart.
            }
        }

        _tabs.SelectedIndex = ActivationTabIndex;
        SetEntitlementFeedback("A valid subscription is required before starting or restarting Edge. Settings remain available.", true);
        return false;
    }

    private Uri ValidateActivationControlPlane()
    {
        var value = _activationControlUrl.Text?.Trim() ?? _settings.ControlPlaneUrl;
        var candidate = new DesktopSettings(value, _deviceName.Text?.Trim() ?? Environment.MachineName, 49321, _settings.InstallationId);
        return candidate.ValidateControlPlaneUri();
    }

    private void RenderEntitlement(EntitlementValidation? validation, DesktopEntitlementCache? cache, string? message = null)
    {
        _entitlementValidation = validation;
        _entitlementUsable = validation?.IsUsable == true;
        if (validation?.State == EntitlementLeaseState.ValidOnline && validation.Payload is { } online)
        {
            _entitlementStatus.Text = "Subscription active";
            _entitlementStatus.Foreground = Good;
            _entitlementDetail.Text = $"{online.PlanCode} · online validation through {online.OnlineValidUntil.LocalDateTime:g} · offline grace through {online.OfflineGraceUntil.LocalDateTime:g}.";
        }
        else if (validation?.State == EntitlementLeaseState.OfflineGrace && validation.Payload is { } grace)
        {
            _entitlementStatus.Text = "Offline grace active";
            _entitlementStatus.Foreground = Warning;
            _entitlementDetail.Text = $"The last online lease expired, but this installation may continue offline until {grace.OfflineGraceUntil.LocalDateTime:g}. Reconnect before the grace deadline.";
        }
        else if (validation?.State == EntitlementLeaseState.Expired && validation.Payload is { } expired)
        {
            _entitlementStatus.Text = "Subscription expired";
            _entitlementStatus.Foreground = Danger;
            _entitlementDetail.Text = $"Offline grace ended {expired.OfflineGraceUntil.LocalDateTime:g}. Renew the subscription, then retry validation.";
        }
        else
        {
            _entitlementStatus.Text = "Activation required";
            _entitlementStatus.Foreground = Warning;
            _entitlementDetail.Text = "Enter the Control Plane URL and product key supplied with your subscription.";
        }

        _entitlementDevice.Text = cache is null
            ? $"Installation · {_settings.InstallationId}"
            : $"Installation · {cache.InstallationId} · last trusted validation {cache.LastTrustedNow.LocalDateTime:g}";
        if (!string.IsNullOrWhiteSpace(message)) SetEntitlementFeedback(message, validation?.IsUsable != true && validation is not null);
    }

    private void SetEntitlementFeedback(string message, bool failed)
    {
        _entitlementFeedback.Text = message;
        _entitlementFeedback.Foreground = failed ? Danger : Good;
    }

    private static string SafeLicensingError(Exception error) => error switch
    {
        InvalidOperationException => "Activation or validation was rejected. Check the subscription, Control Plane URL, and network connection.",
        InvalidDataException => "The signed subscription response could not be verified. Install an official release or contact Lightworld support.",
        HttpRequestException => "The Control Plane could not be reached. Check the Internet connection and try again.",
        TaskCanceledException => "Subscription validation timed out. Check the network connection and try again.",
        _ => "Subscription activation could not be completed."
    };

    private void RenderSnapshot(EdgeDesktopSnapshot snapshot)
    {
        _statusTitle.Text = snapshot.State switch {
            EdgeDesktopRuntimeState.Active => "Edge active",
            EdgeDesktopRuntimeState.Degraded => "Offline / degraded",
            EdgeDesktopRuntimeState.Starting => "Starting Edge",
            EdgeDesktopRuntimeState.Stopping => "Stopping Edge",
            EdgeDesktopRuntimeState.EnrollmentRequired => "Pairing required",
            EdgeDesktopRuntimeState.AlreadyRunning => "Edge already running",
            EdgeDesktopRuntimeState.ConfigurationError => "Setup problem",
            EdgeDesktopRuntimeState.Crashed => "Runtime stopped unexpectedly",
            _ => "Stopped"
        };
        _statusDot.Background = snapshot.State switch {
            EdgeDesktopRuntimeState.Active => Good,
            EdgeDesktopRuntimeState.Degraded or EdgeDesktopRuntimeState.EnrollmentRequired or EdgeDesktopRuntimeState.AlreadyRunning or EdgeDesktopRuntimeState.Starting or EdgeDesktopRuntimeState.Stopping => Warning,
            EdgeDesktopRuntimeState.Crashed or EdgeDesktopRuntimeState.ConfigurationError => Danger,
            _ => Muted
        };
        var statusDetail = snapshot.ErrorCode is null
            ? snapshot.ProcessId is { } pid ? $"Runtime process {pid}." : "The local Edge runtime is not running."
            : SafeErrorText(snapshot.ErrorCode);
        _statusDetail.Text = string.IsNullOrWhiteSpace(snapshot.DiagnosticMessage)
            ? statusDetail
            : $"{statusDetail}\nRuntime detail · {snapshot.DiagnosticMessage}";
        _cloudStatus.Text = $"Control Plane · {(snapshot.ControlPlaneHealthy ? "connected" : "offline")}";
        _cloudStatus.Foreground = snapshot.ControlPlaneHealthy ? Good : Muted;
        var localOutputAvailable = LocalOutputLinkPolicy.CanOpen(snapshot);
        foreach (var button in _localOutputButtons) button.IsEnabled = localOutputAvailable;
        _programStatus.Text = localOutputAvailable
            ? "Local Program · available"
            : snapshot.State switch
            {
                EdgeDesktopRuntimeState.Starting => "Local Program · starting",
                EdgeDesktopRuntimeState.Active or EdgeDesktopRuntimeState.Degraded => "Local Program · unavailable",
                _ => "Local Program · waiting — start Edge first"
            };
        _programStatus.Foreground = localOutputAvailable ? Good : Muted;

        var running = snapshot.State is EdgeDesktopRuntimeState.Starting or EdgeDesktopRuntimeState.Active or EdgeDesktopRuntimeState.Degraded or EdgeDesktopRuntimeState.Stopping;
        _start.IsEnabled = !running;
        _stop.IsEnabled = running && snapshot.State != EdgeDesktopRuntimeState.Stopping;
        _restart.IsEnabled = running && snapshot.State != EdgeDesktopRuntimeState.Stopping;
        _controlUrl.IsEnabled = !running;
        _deviceName.IsEnabled = !running;
        _pairingCode.IsEnabled = !running;
        _programDisplay.IsEnabled = !running;
        _save.IsEnabled = !running;
    }

    private static string SafeErrorText(string code) => code switch {
        "control_plane_unreachable" => "The local runtime is alive, but the Control Plane cannot currently be reached. Local service continuity remains available.",
        "enrollment_required" => "This computer needs a fresh one-time pairing code.",
        "runtime_already_running" => "Another Edge runtime is already active for this user. Stop the existing runtime before starting a second one.",
        "runtime_configuration_error" or "configuration_invalid" => "Check the Control Plane URL and local desktop settings.",
        "runtime_missing" => "The packaged Edge runtime was not found beside the desktop shell.",
        "forced_shutdown" => "The runtime did not stop within the grace period and was force-terminated.",
        _ => "The Edge runtime stopped unexpectedly. Restart it or review administrator diagnostics."
    };

    private async void OnClosing(object? sender, WindowClosingEventArgs args)
    {
        if (_allowClose) return;
        args.Cancel = true;
        _operatorTimer.Stop();
        _start.IsEnabled = _stop.IsEnabled = _restart.IsEnabled = false;
        try { await _supervisor.DisposeAsync(); } catch { }
        _licensingHttpClient.Dispose();
        _allowClose = true;
        Close();
    }

    private Uri LocalUri(string page) => new($"http://127.0.0.1:{_settings.ProgramPort}/{page}");

    private Uri CloudUri(string path)
    {
        var baseUri = ReadSettings().ValidateControlPlaneUri();
        return new Uri(baseUri, path);
    }

    private Button LocalOutputButton(string text, string page)
    {
        var button = ActionButton(text, false);
        button.Margin = new Thickness(0, 0, 8, 8);
        button.IsEnabled = false;
        _localOutputButtons.Add(button);
        button.Click += async (_, _) =>
        {
            if (!LocalOutputLinkPolicy.CanOpen(_supervisor.Snapshot))
            {
                const string message = "Start Edge and wait for ‘Local Program · available’ before opening Preview or Program.";
                SetFeedback(message, true);
                SetOperatorFeedback(message, true);
                return;
            }

            try
            {
                var launcher = TopLevel.GetTopLevel(this)?.Launcher;
                if (launcher is null || !await launcher.LaunchUriAsync(LocalUri(page)))
                    SetFeedback("The operating system could not open that local output.", true);
            }
            catch (Exception error) { SetFeedback(error.Message, true); }
        };
        return button;
    }

    private Button LinkButton(string text, Func<Uri> uriFactory)
    {
        var button = ActionButton(text, false);
        button.Margin = new Thickness(0, 0, 8, 8);
        button.Click += async (_, _) =>
        {
            try
            {
                var launcher = TopLevel.GetTopLevel(this)?.Launcher;
                if (launcher is null || !await launcher.LaunchUriAsync(uriFactory()))
                    SetFeedback("The operating system could not open that destination.", true);
            }
            catch (Exception error) { SetFeedback(error.Message, true); }
        };
        return button;
    }

    private void SetFeedback(string message, bool failed)
    {
        _feedback.Text = message;
        _feedback.Foreground = failed ? Danger : Good;
    }

    private static Border Card(string title, Control content) => new() {
        Background = Surface,
        CornerRadius = new CornerRadius(18),
        Padding = new Thickness(18),
        Child = new StackPanel {
            Spacing = 12,
            Children = { Label(title, 14, FontWeight.Bold), content }
        }
    };

    private static Border Field(string title, Control input, int row, int column, int columnSpan = 1)
    {
        var panel = new StackPanel {
            Spacing = 6,
            Children = { Label(title, 11, FontWeight.SemiBold, Muted), input }
        };
        var border = new Border { Child = panel };
        Grid.SetRow(border, row);
        Grid.SetColumn(border, column);
        Grid.SetColumnSpan(border, columnSpan);
        return border;
    }

    private static TextBox Input(string placeholder, bool secret) => new() {
        PlaceholderText = placeholder,
        MinHeight = 42,
        PasswordChar = secret ? '●' : '\0'
    };

    private static Button ActionButton(string text, bool primary) => new() {
        Content = text,
        MinHeight = 40,
        MinWidth = 105,
        Padding = new Thickness(14, 8),
        Background = primary ? Gold : SurfaceRaised,
        Foreground = primary ? Brush("#17120A") : Brushes.White,
        FontWeight = FontWeight.SemiBold
    };

    private static TextBlock Bullet(string text)
    {
        var block = Label("• " + text, 12, FontWeight.Normal, Muted);
        block.TextWrapping = TextWrapping.Wrap;
        return block;
    }

    private static Border Separator() => new() { Height = 1, Background = Brush("#222B39"), Margin = new Thickness(0, 2) };

    private static TextBlock Label(string text, double size, FontWeight weight, IBrush? foreground = null) => new() {
        Text = text,
        FontSize = size,
        FontWeight = weight,
        Foreground = foreground ?? Brushes.White,
        TextWrapping = TextWrapping.Wrap
    };

    private static SolidColorBrush Brush(string hex) => new(Color.Parse(hex));
}
