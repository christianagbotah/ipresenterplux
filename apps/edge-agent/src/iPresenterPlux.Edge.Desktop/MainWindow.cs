using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
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
    private readonly TextBlock _rundownEyebrow = Label("SERVICE RUNDOWN", 10, FontWeight.Bold, Gold);
    private readonly TextBlock _rundownTitle = Label("Content & cues", 19, FontWeight.Bold);
    private readonly TextBlock _rundownCurrent = Label("CURRENT · Program clear", 10, FontWeight.SemiBold, Muted);
    private readonly TextBlock _catalogStatus = Label("LOCAL REHEARSAL", 10, FontWeight.Bold, Warning);
    private readonly TextBlock _catalogService = Label("Demo content · no synced service yet", 11, FontWeight.Normal, Muted);
    private readonly ListBox _rundown = new();
    private readonly TextBlock _previewTitle = Label("Preview is clear", 22, FontWeight.Bold);
    private readonly TextBlock _previewBody = Label("Select a cue and press Preview Selected.", 16, FontWeight.Normal, Muted);
    private readonly TextBlock _previewFooter = Label("PREVIEW", 11, FontWeight.Bold, Gold);
    private readonly TextBlock _programTitle = Label("Program is clear", 22, FontWeight.Bold);
    private readonly TextBlock _programBody = Label("Nothing is currently live on Program.", 16, FontWeight.Normal, Muted);
    private readonly TextBlock _programFooter = Label("PROGRAM", 11, FontWeight.Bold, Good);
    private readonly TextBlock _operatorRuntime = Label("EDGE OFFLINE", 11, FontWeight.Bold, Muted);
    private readonly TextBlock _operatorService = Label("LOCAL REHEARSAL", 11, FontWeight.Bold, Warning);
    private readonly TextBlock _operatorRecording = Label("RECORDING OFF", 11, FontWeight.Bold, Muted);
    private readonly TextBlock _operatorFeedback = Label("Local operator channel is waiting for Edge.", 12, FontWeight.Normal, Muted);
    private readonly Button _prepare = ActionButton("Preview Selected", false);
    private readonly Button _take = ActionButton("TAKE → PROGRAM", true);
    private readonly Button _clear = ActionButton("Clear Program", false);
    private readonly Button _record = ActionButton("Start Recording", false);
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
        _entitlementStore = DesktopEntitlementStore.CreateDefault();
        _entitlementPublicKeys = EntitlementPublicKeyCatalog.Load();
        _entitlementClient = new EntitlementClient(_licensingHttpClient, _entitlementStore, _entitlementPublicKeys);
        _supervisor.SnapshotChanged += (_, snapshot) => Dispatcher.UIThread.Post(() => RenderSnapshot(snapshot));
        _operatorTimer.Tick += async (_, _) => await RefreshOperatorAsync();

        Title = "iPresenterPlux Edge";
        Width = 1180;
        Height = 760;
        MinWidth = 900;
        MinHeight = 620;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = Brush("#070A0F");
        var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "icon.png");
        if (File.Exists(icon)) Icon = new WindowIcon(icon);

        Content = BuildContent();
        Opened += async (_, _) => await LoadAsync();
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
        _resolveScripture.Click += async (_, _) => await ResolveAndPreviewScriptureAsync();
        _scriptureReference.KeyDown += (_, args) =>
        {
            if (args.Key == Key.Enter) _ = ResolveAndPreviewScriptureAsync();
        };
        _operatorSearch.TextChanged += (_, _) => RefreshRundown();
        _tabs.SelectionChanged += (_, _) =>
        {
            if (_tabs.SelectedIndex == OperatorTabIndex && !_entitlementUsable)
                _tabs.SelectedIndex = ActivationTabIndex;
        };
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
        var root = new Grid { Margin = new Thickness(18) };
        root.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        root.RowDefinitions.Add(new RowDefinition(new GridLength(14)));
        root.RowDefinitions.Add(new RowDefinition(new GridLength(1, GridUnitType.Star)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(292)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(14)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(14)));
        root.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(300)));

        var header = new Border {
            Background = Surface,
            CornerRadius = new CornerRadius(18),
            Padding = new Thickness(18, 13),
            Child = new Grid {
                ColumnDefinitions = new ColumnDefinitions("*,Auto"),
                Children = {
                    new StackPanel {
                        Spacing = 2,
                        Children = {
                            Label("IPRESENTERPLUX", 10, FontWeight.Bold, Gold),
                            Label("Production Operator", 24, FontWeight.Bold),
                            Label("Service rundown · Preview · Program · local resilient control", 11, FontWeight.Normal, Muted)
                        }
                    },
                    HeaderHint()
                }
            }
        };
        Grid.SetColumnSpan(header, 5);
        root.Children.Add(header);

        var leftGrid = new Grid();
        leftGrid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        leftGrid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        leftGrid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        leftGrid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        leftGrid.RowDefinitions.Add(new RowDefinition(new GridLength(1, GridUnitType.Star)));
        leftGrid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        leftGrid.RowSpacing = 10;

        var leftTitle = new StackPanel {
            Spacing = 3,
            Children = {
                _rundownEyebrow,
                _rundownTitle,
                _rundownCurrent,
                Label("Rows track CURRENT · PREVIEW · NEXT from Edge truth", 9, FontWeight.SemiBold, Muted),
                _catalogStatus,
                _catalogService
            }
        };
        Grid.SetRow(leftTitle, 0);
        leftGrid.Children.Add(leftTitle);

        _scriptureReference.MinHeight = 38;
        _scriptureReference.IsEnabled = false;
        _bibleVersion.IsEnabled = false;
        _resolveScripture.IsEnabled = false;
        _bibleVersion.Background = SurfaceRaised;
        _bibleVersion.Foreground = Brushes.White;
        _resolveScripture.MinWidth = 112;
        _resolveScripture.MinHeight = 38;
        _resolveScripture.Padding = new Thickness(10, 6);
        var scriptureRow = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), ColumnSpacing = 8 };
        scriptureRow.Children.Add(_bibleVersion);
        Grid.SetColumn(_resolveScripture, 1);
        scriptureRow.Children.Add(_resolveScripture);
        var scriptureTools = new StackPanel {
            Spacing = 6,
            Children = {
                Label("SCRIPTURE LOOKUP", 9, FontWeight.Bold, Muted),
                _scriptureReference,
                scriptureRow
            }
        };
        Grid.SetRow(scriptureTools, 1);
        leftGrid.Children.Add(scriptureTools);

        _operatorSearch.MinHeight = 40;
        Grid.SetRow(_operatorSearch, 2);
        leftGrid.Children.Add(_operatorSearch);

        var categories = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var category in OperatorWorkspaceCatalog.Categories)
        {
            var button = ActionButton(category, false);
            button.MinWidth = 0;
            button.MinHeight = 32;
            button.Padding = new Thickness(10, 5);
            button.Margin = new Thickness(0, 0, 6, 6);
            var captured = category;
            button.Click += (_, _) => { _activeCategory = captured; RefreshRundown(); };
            categories.Children.Add(button);
        }
        Grid.SetRow(categories, 3);
        leftGrid.Children.Add(categories);

        _rundown.Background = SurfaceRaised;
        _rundown.MinHeight = 260;
        _rundown.SelectionChanged += (_, _) =>
        {
            if (_rundown.SelectedItem is OperatorRundownRow row)
                _selectedRundownItemId = row.Item.Id;
            _prepare.IsEnabled = _rundown.SelectedItem is OperatorRundownRow;
        };
        Grid.SetRow(_rundown, 4);
        leftGrid.Children.Add(_rundown);

        var leftActions = new StackPanel {
            Spacing = 8,
            Children = {
                _prepare,
                Label("Ctrl+↑/↓ Select · F6 Preview · F8 Take · F7 Clear", 10, FontWeight.SemiBold, Muted)
            }
        };
        Grid.SetRow(leftActions, 5);
        leftGrid.Children.Add(leftActions);

        var left = new Border {
            Background = Surface,
            CornerRadius = new CornerRadius(18),
            Padding = new Thickness(16),
            Child = leftGrid
        };
        Grid.SetRow(left, 2);
        Grid.SetColumn(left, 0);
        root.Children.Add(left);

        var center = new Grid();
        center.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        center.RowDefinitions.Add(new RowDefinition(new GridLength(12)));
        center.RowDefinitions.Add(new RowDefinition(new GridLength(1, GridUnitType.Star)));
        center.RowDefinitions.Add(new RowDefinition(new GridLength(12)));
        center.RowDefinitions.Add(new RowDefinition(GridLength.Auto));

        var centerHeader = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        centerHeader.Children.Add(new StackPanel {
            Spacing = 3,
            Children = {
                Label("LIVE WORKSPACE", 10, FontWeight.Bold, Gold),
                Label("Preview & Program", 22, FontWeight.Bold),
                Label("The runtime is authoritative. The shell changes state only after Edge acknowledges each command.", 11, FontWeight.Normal, Muted)
            }
        });
        var mode = Label("CUT MODE", 10, FontWeight.Bold, Good);
        mode.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(mode, 1);
        centerHeader.Children.Add(mode);
        Grid.SetRow(centerHeader, 0);
        center.Children.Add(centerHeader);

        var stages = new Grid { ColumnSpacing = 12 };
        stages.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        stages.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        var previewStage = BuildStage("PREVIEW", _previewTitle, _previewBody, _previewFooter, Gold);
        var programStage = BuildStage("PROGRAM", _programTitle, _programBody, _programFooter, Good);
        Grid.SetColumn(previewStage, 0);
        Grid.SetColumn(programStage, 1);
        stages.Children.Add(previewStage);
        stages.Children.Add(programStage);
        Grid.SetRow(stages, 2);
        center.Children.Add(stages);

        var transitionBar = new Border {
            Background = Surface,
            CornerRadius = new CornerRadius(16),
            Padding = new Thickness(14),
            Child = new Grid {
                ColumnDefinitions = new ColumnDefinitions("Auto,Auto,*,Auto"),
                ColumnSpacing = 10,
                Children = {
                    _take,
                    _clear,
                    TransitionHint(),
                    LocalOutputButton("Open Program", "program")
                }
            }
        };
        Grid.SetColumn(_clear, 1);
        var transitionHint = ((Grid)transitionBar.Child).Children[2];
        Grid.SetColumn(transitionHint, 2);
        var openProgram = ((Grid)transitionBar.Child).Children[3];
        Grid.SetColumn(openProgram, 3);
        Grid.SetRow(transitionBar, 4);
        center.Children.Add(transitionBar);

        Grid.SetRow(center, 2);
        Grid.SetColumn(center, 2);
        root.Children.Add(center);

        var rightStack = new StackPanel { Spacing = 12 };
        var runtimeStart = ActionButton("Start Edge", true);
        var runtimeRestart = ActionButton("Restart", false);
        var runtimeStop = ActionButton("Stop", false);
        runtimeStart.Click += async (_, _) => await StartAsync();
        runtimeRestart.Click += async (_, _) => await RestartAsync();
        runtimeStop.Click += async (_, _) => await StopAsync();
        rightStack.Children.Add(Card("Runtime truth", new StackPanel {
            Spacing = 9,
            Children = {
                _operatorRuntime,
                _operatorService,
                _operatorRecording,
                Separator(),
                _operatorFeedback,
                new WrapPanel { Children = { runtimeStart, runtimeRestart, runtimeStop } }
            }
        }));

        var outputStart = ActionButton("Start Output", false);
        var outputStop = ActionButton("Stop Output", false);
        outputStart.Click += async (_, _) => await SendOperatorAsync(LocalOperatorCommands.OutputStart, null, "Local output started.");
        outputStop.Click += async (_, _) => await SendOperatorAsync(LocalOperatorCommands.OutputStop, null, "Local output stopped.");
        _record.MinWidth = 132;
        rightStack.Children.Add(Card("Output & recording", new StackPanel {
            Spacing = 8,
            Children = {
                new WrapPanel { Children = { LocalOutputButton("Open Preview", "preview"), LocalOutputButton("Open Program", "program") } },
                new WrapPanel { Children = { outputStart, outputStop } },
                _record,
                Label("Recording is service-scoped. In local rehearsal mode, Preview/Program remain available but recording stays disabled.", 10, FontWeight.Normal, Muted)
            }
        }));

        rightStack.Children.Add(Card("AI & language", new StackPanel {
            Spacing = 7,
            Children = {
                StatusLine("Transcript", "Runtime-managed ASR"),
                StatusLine("Interpretation", "Cloud workflow foundation"),
                StatusLine("Audience audio", "Mobile playback foundation"),
                Label("No AI/provider secret is exposed to this desktop workspace.", 10, FontWeight.Normal, Muted)
            }
        }));

        rightStack.Children.Add(Card("Cloud rooms", new WrapPanel {
            Children = {
                LinkButton("Control Room", () => CloudUri("/")),
                LinkButton("Streaming Studio", () => CloudUri("/streaming"))
            }
        }));

        var right = new ScrollViewer {
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            Content = rightStack
        };
        Grid.SetRow(right, 2);
        Grid.SetColumn(right, 4);
        root.Children.Add(right);

        RefreshRundown();
        return root;
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

    private static Border BuildStage(
        string label,
        TextBlock title,
        TextBlock body,
        TextBlock footer,
        IBrush accent)
    {
        title.TextAlignment = TextAlignment.Center;
        body.TextAlignment = TextAlignment.Center;
        body.TextWrapping = TextWrapping.Wrap;
        footer.TextAlignment = TextAlignment.Center;

        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        grid.RowDefinitions.Add(new RowDefinition(new GridLength(1, GridUnitType.Star)));
        var stageLabel = Label(label, 10, FontWeight.Bold, accent);
        Grid.SetRow(stageLabel, 0);
        grid.Children.Add(stageLabel);
        var content = new StackPanel {
            Spacing = 14,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            MaxWidth = 560,
            Children = { title, body, footer }
        };
        Grid.SetRow(content, 1);
        grid.Children.Add(content);

        return new Border {
            Background = Brush("#06090E"),
            BorderBrush = accent,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(18),
            Padding = new Thickness(18),
            MinHeight = 330,
            Child = grid
        };
    }

    private Control BuildSetupContent()
    {
        var root = new Grid { Margin = new Thickness(24) };
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

        Grid.SetColumn(sidebar, 0);
        root.Children.Add(sidebar);

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
        setupGrid.Children.Add(Field("Control Plane URL", _controlUrl, 0, 0, 2));
        setupGrid.Children.Add(Field("Device name", _deviceName, 1, 0));
        setupGrid.Children.Add(Field("One-time pairing code", _pairingCode, 1, 1));

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

        var scroll = new ScrollViewer {
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            Content = main
        };
        Grid.SetColumn(scroll, 2);
        root.Children.Add(scroll);
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

    private OperatorRundownNavigator RundownNavigator() => new(_workspace.RundownItems);

    private void RefreshRundown()
    {
        var canonical = _workspace.RundownItems;
        var visibleItems = OperatorWorkspaceCatalog.Filter(canonical, _activeCategory, _operatorSearch.Text);
        var navigator = new OperatorRundownNavigator(canonical);
        var state = navigator.BuildState(_operatorSnapshot, visibleItems.Select(item => item.Id));

        if (_selectedRundownItemId is null || !canonical.Any(item => item.Id.Equals(_selectedRundownItemId, StringComparison.Ordinal)))
            _selectedRundownItemId = visibleItems.FirstOrDefault()?.Id ?? canonical.FirstOrDefault()?.Id;

        _rundown.ItemsSource = state.Rows;
        _rundown.SelectedItem = state.Rows.FirstOrDefault(row => row.Item.Id.Equals(_selectedRundownItemId, StringComparison.Ordinal));
        _prepare.IsEnabled = _rundown.SelectedItem is OperatorRundownRow;
        _rundownCurrent.Text = $"CURRENT · {state.CurrentLabel}";
        _rundownCurrent.Foreground = state.ProgramIsAdHoc ? Warning : state.CurrentItemId is null ? Muted : Good;
    }

    private void MoveRundownSelection(int delta)
    {
        if (_operatorBusy || _workspace.RundownItems.Count == 0) return;
        _selectedRundownItemId = RundownNavigator().MoveSelection(_selectedRundownItemId, delta);
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

            var connected = response.Snapshot.ConnectionStatus.Equals("Online", StringComparison.OrdinalIgnoreCase) ||
                response.Snapshot.ConnectionStatus.Equals("Connected", StringComparison.OrdinalIgnoreCase);
            _operatorFeedback.Text = connected
                ? _workspace.IsStale
                    ? "Local control is connected; the displayed service catalog is an offline cache."
                    : "Local control and Control Plane are connected."
                : "Local control is available; cloud connectivity may be degraded.";
            _operatorFeedback.Foreground = connected && !_workspace.IsStale ? Good : Warning;
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
            _resolveScripture.IsEnabled = false;
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
                !_workspace.RundownItems.Any(item => item.Id.Equals(_selectedRundownItemId, StringComparison.Ordinal)))
                _selectedRundownItemId = null;

            var versions = _workspace.BibleVersions
                .Select(version => string.IsNullOrWhiteSpace(version.Abbreviation) ? version.Id : version.Abbreviation)
                .Where(version => !string.IsNullOrWhiteSpace(version))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            _bibleVersion.ItemsSource = versions;
            var preferred = selectedVersion is not null && versions.Contains(selectedVersion, StringComparer.OrdinalIgnoreCase)
                ? versions.First(version => version.Equals(selectedVersion, StringComparison.OrdinalIgnoreCase))
                : versions.FirstOrDefault(version => version.Equals(_workspace.ActiveBibleVersion, StringComparison.OrdinalIgnoreCase))
                  ?? versions.FirstOrDefault();
            _bibleVersion.SelectedItem = preferred;
            RefreshRundown();
        }

        var hasServiceOrder = _workspace.HasSyncedCatalog && _workspace.ServiceTitle is { Length: > 0 };
        _rundownEyebrow.Text = hasServiceOrder ? "ORDER OF SERVICE" : "SERVICE RUNDOWN";
        _rundownTitle.Text = hasServiceOrder ? "Planned rundown" : "Content & cues";
        _catalogStatus.Text = _workspace.StatusLabel;
        _catalogStatus.Foreground = _workspace.IsRehearsal || _workspace.IsStale ? Warning : Good;
        _catalogService.Text = _workspace.ServiceTitle is { Length: > 0 } title
            ? $"{title} · {_workspace.ServiceStatus ?? "service"}"
            : _workspace.IsRehearsal
                ? "Demo content · no synced service yet"
                : "No active service assigned to this Edge.";

        var hasVersions = (_bibleVersion.ItemsSource as IEnumerable<string>)?.Any() == true;
        var scriptureEnabled = _workspace.HasSyncedCatalog && _workspace.ServiceTitle is not null;
        _bibleVersion.IsEnabled = scriptureEnabled && hasVersions;
        _scriptureReference.IsEnabled = scriptureEnabled;
        _resolveScripture.IsEnabled = scriptureEnabled;

        _operatorService.Text = _workspace.ServiceTitle is { Length: > 0 } serviceTitle
            ? $"{serviceTitle.ToUpperInvariant()} · {_workspace.StatusLabel}"
            : _workspace.StatusLabel;
        _operatorService.Foreground = _workspace.IsRehearsal || _workspace.IsStale ? Warning : Good;
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
            var preview = await _operatorClient.SendAsync(
                LocalOperatorCommands.PreviewRender,
                item.ToPresentation(),
                CancellationToken.None);
            RenderOperatorSnapshot(preview.Snapshot);
            if (preview.Ok)
                SetOperatorFeedback($"Scripture prepared in Preview: {item.Title} · {item.Footer ?? version ?? "default version"}.", false);
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

    private OperatorWorkspaceItem? SelectedRundownItem() =>
        _rundown.SelectedItem is OperatorRundownRow row ? row.Item : null;

    private async Task PreviewSelectedAsync()
    {
        var item = SelectedRundownItem();
        if (item is null)
        {
            SetOperatorFeedback("Select a rundown item first.", true);
            return;
        }
        _selectedRundownItemId = item.Id;
        await SendOperatorAsync(LocalOperatorCommands.PreviewRender, item.ToPresentation(), $"Preview prepared: {item.Title}");
    }

    private async Task TakeAsync()
    {
        if (_operatorBusy) return;
        var selectionBeforeTake = _selectedRundownItemId;
        _operatorBusy = true;
        try
        {
            var response = await _operatorClient.SendAsync(LocalOperatorCommands.ProgramTake, null, CancellationToken.None);
            RenderOperatorSnapshot(response.Snapshot);
            if (response.Ok)
            {
                _selectedRundownItemId = RundownNavigator().AdvanceAfterTake(
                    selectionBeforeTake,
                    response.Snapshot.Program?.ItemId,
                    response.Ok);
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
        _record.Content = snapshot.IsRecording ? "Stop Recording" : "Start Recording";
        _record.IsEnabled = snapshot.ActiveServiceId is not null;
        _take.IsEnabled = snapshot.Preview is not null;
        _clear.IsEnabled = snapshot.Program is not null;
        RefreshRundown();
    }

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
        "scripture_query_required" or "scripture_reference_invalid" => "Enter a scripture reference such as John 3:16 or Psalm 23.",
        "bible_version_invalid" => "Choose a valid Bible version for this service.",
        "scripture_unavailable_offline" => "That passage is not in the offline cache. Reconnect the Control Plane or choose a cached passage.",
        "scripture_resolve_failed" => "Scripture lookup could not be completed. Check the reference and try again.",
        "catalog_unavailable" or "catalog_scope_mismatch" => "The service catalog is still synchronizing with this Edge runtime.",
        "presentation_required" or "body_invalid" or "item_id_invalid" or "item_type_invalid" => "That cue is not valid for local presentation.",
        _ => "The Edge runtime rejected that local operator action."
    };

    private async Task LoadAsync()
    {
        _settings = await _settingsStore.LoadAsync(CancellationToken.None);
        if (string.IsNullOrWhiteSpace(_settings.InstallationId))
            _settings = _settings with { InstallationId = Guid.NewGuid().ToString("N") };
        _controlUrl.Text = _settings.ControlPlaneUrl;
        _activationControlUrl.Text = _settings.ControlPlaneUrl;
        _deviceName.Text = _settings.DeviceName;

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

    private DesktopSettings ReadSettings() => new DesktopSettings(
        _controlUrl.Text?.Trim() ?? "",
        _deviceName.Text?.Trim() ?? "",
        49321,
        _settings.InstallationId).Normalize();

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
            _settings = new DesktopSettings(
                _controlUrl.Text,
                _deviceName.Text?.Trim() ?? Environment.MachineName,
                49321,
                _settings.InstallationId).Normalize();
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
        _statusDetail.Text = snapshot.ErrorCode is null
            ? snapshot.ProcessId is { } pid ? $"Runtime process {pid}." : "The local Edge runtime is not running."
            : SafeErrorText(snapshot.ErrorCode);
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
