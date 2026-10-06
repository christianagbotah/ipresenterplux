using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Desktop;

public sealed class MainWindow : Window
{
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
    private readonly DispatcherTimer _operatorTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly TabControl _tabs = new();
    private readonly TextBox _operatorSearch = Input("Search scripture, songs, slides or media", false);
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
    private bool _operatorBusy;
    private bool _recordingActive;
    private readonly TextBox _controlUrl = Input("https://control.example.com", false);
    private readonly TextBox _deviceName = Input("Church production computer", false);
    private readonly TextBox _pairingCode = Input("One-time pairing code", true);
    private readonly TextBlock _statusTitle = Label("Stopped", 22, FontWeight.Bold);
    private readonly TextBlock _statusDetail = Label("The local Edge runtime is not running.", 12, FontWeight.Normal, Muted);
    private readonly Border _statusDot = new() { Width = 10, Height = 10, CornerRadius = new CornerRadius(99), Background = Muted };
    private readonly TextBlock _cloudStatus = Label("Control Plane · unknown", 12, FontWeight.SemiBold, Muted);
    private readonly TextBlock _programStatus = Label("Local Program · unknown", 12, FontWeight.SemiBold, Muted);
    private readonly TextBlock _feedback = Label("", 12, FontWeight.Normal, Muted);
    private readonly Button _start = ActionButton("Start Edge", true);
    private readonly Button _stop = ActionButton("Stop", false);
    private readonly Button _restart = ActionButton("Restart", false);
    private readonly Button _save = ActionButton("Save settings", false);
    private DesktopSettings _settings = DesktopSettings.CreateDefault();
    private bool _allowClose;

    public MainWindow()
    {
        _settingsStore = new DesktopSettingsStore(_paths.SettingsDirectory);
        _supervisor = new EdgeHostSupervisor(_paths);
        _operatorClient = new LocalOperatorClient(_paths.EdgeDataDirectory);
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
        };

        _save.Click += async (_, _) => await SaveAsync();
        _start.Click += async (_, _) => await StartAsync();
        _stop.Click += async (_, _) => await StopAsync();
        _restart.Click += async (_, _) => await RestartAsync();
        _prepare.Click += async (_, _) => await PreviewSelectedAsync();
        _take.Click += async (_, _) => await TakeAsync();
        _clear.Click += async (_, _) => await ClearProgramAsync();
        _record.Click += async (_, _) => await ToggleRecordingAsync();
        _operatorSearch.TextChanged += (_, _) => RefreshRundown();
    }

    private Control BuildContent()
    {
        _tabs.Background = Brush("#070A0F");
        _tabs.ItemsSource = new object[]
        {
            new TabItem { Header = "Operator", Content = BuildOperatorContent() },
            new TabItem { Header = "Setup & Runtime", Content = BuildSetupContent() }
        };
        _tabs.SelectedIndex = 0;
        return _tabs;
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
        leftGrid.RowDefinitions.Add(new RowDefinition(new GridLength(1, GridUnitType.Star)));
        leftGrid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        leftGrid.RowSpacing = 10;

        var leftTitle = new StackPanel {
            Spacing = 3,
            Children = {
                Label("SERVICE RUNDOWN", 10, FontWeight.Bold, Gold),
                Label("Content & cues", 19, FontWeight.Bold),
                Label("Seed content now; cloud library sync follows this workspace foundation.", 11, FontWeight.Normal, Muted)
            }
        };
        Grid.SetRow(leftTitle, 0);
        leftGrid.Children.Add(leftTitle);

        _operatorSearch.MinHeight = 40;
        Grid.SetRow(_operatorSearch, 1);
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
        Grid.SetRow(categories, 2);
        leftGrid.Children.Add(categories);

        _rundown.Background = SurfaceRaised;
        _rundown.MinHeight = 260;
        _rundown.SelectionChanged += (_, _) => _prepare.IsEnabled = _rundown.SelectedItem is OperatorWorkspaceItem;
        Grid.SetRow(_rundown, 3);
        leftGrid.Children.Add(_rundown);

        var leftActions = new StackPanel {
            Spacing = 8,
            Children = {
                _prepare,
                Label("F6 Preview · F8 Take · F7 Clear", 10, FontWeight.SemiBold, Muted)
            }
        };
        Grid.SetRow(leftActions, 4);
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

    private void RefreshRundown()
    {
        var query = _operatorSearch.Text?.Trim() ?? string.Empty;
        var items = OperatorWorkspaceCatalog.Seeded
            .Where(item => (_activeCategory == "All" || string.Equals(item.Category, _activeCategory, StringComparison.OrdinalIgnoreCase)) &&
                (query.Length == 0 ||
                 item.Title.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                 item.Body.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                 item.Category.Contains(query, StringComparison.OrdinalIgnoreCase)))
            .ToArray();
        _rundown.ItemsSource = items;
        var selected = _rundown.SelectedItem as OperatorWorkspaceItem;
        if (selected is null || !items.Contains(selected))
            _rundown.SelectedIndex = items.Length > 0 ? 0 : -1;
        _prepare.IsEnabled = _rundown.SelectedItem is OperatorWorkspaceItem;
    }

    private async Task RefreshOperatorAsync()
    {
        if (_operatorBusy) return;
        _operatorBusy = true;
        try
        {
            var response = await _operatorClient.QueryAsync(CancellationToken.None);
            RenderOperatorSnapshot(response.Snapshot);
            _operatorFeedback.Text = response.Snapshot.ConnectionStatus.Equals("Online", StringComparison.OrdinalIgnoreCase)
                ? "Local control and Control Plane are connected."
                : "Local control is available; cloud connectivity may be degraded.";
            _operatorFeedback.Foreground = response.Snapshot.ConnectionStatus.Equals("Online", StringComparison.OrdinalIgnoreCase) ? Good : Warning;
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

    private async Task PreviewSelectedAsync()
    {
        if (_rundown.SelectedItem is not OperatorWorkspaceItem item)
        {
            SetOperatorFeedback("Select a rundown item first.", true);
            return;
        }
        await SendOperatorAsync(LocalOperatorCommands.PreviewRender, item.ToPresentation(), $"Preview prepared: {item.Title}");
    }

    private Task TakeAsync() => SendOperatorAsync(
        LocalOperatorCommands.ProgramTake,
        null,
        "Preview taken to Program.");

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
            {
                SetOperatorFeedback(successMessage, false);
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

    private void RenderOperatorSnapshot(LocalOperatorSnapshot snapshot)
    {
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
        foreach (var button in _localOutputButtons) button.IsEnabled = false;
    }

    private void SetOperatorFeedback(string message, bool failed)
    {
        _operatorFeedback.Text = message;
        _operatorFeedback.Foreground = failed ? Danger : Good;
    }

    private static string SafeOperatorError(string? code) => code switch
    {
        "preview_required" => "Prepare a cue in Preview before taking it to Program.",
        "service_required" => "Recording requires an active service assignment. Preview and Program still work in rehearsal mode.",
        "recording_unavailable" => "Local recording is not available on this runtime.",
        "invalid_runtime_state" => "The local runtime is not ready for that action yet.",
        "presentation_required" or "body_invalid" or "item_id_invalid" or "item_type_invalid" => "That cue is not valid for local presentation.",
        _ => "The Edge runtime rejected that local operator action."
    };

    private async Task LoadAsync()
    {
        _settings = await _settingsStore.LoadAsync(CancellationToken.None);
        _controlUrl.Text = _settings.ControlPlaneUrl;
        _deviceName.Text = _settings.DeviceName;
        if (string.IsNullOrWhiteSpace(_settings.ControlPlaneUrl))
        {
            _statusTitle.Text = "Setup required";
            _statusDetail.Text = "Enter the secure Control Plane URL and device name, then pair this computer.";
            _statusDot.Background = Warning;
            _tabs.SelectedIndex = 1;
        }
        else
        {
            _tabs.SelectedIndex = 0;
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
        49321).Normalize();

    private async Task SaveAsync()
    {
        try
        {
            _settings = ReadSettings();
            await _settingsStore.SaveAsync(_settings, CancellationToken.None);
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
            _settings = ReadSettings();
            var pairing = _pairingCode.Text;
            _pairingCode.Text = "";
            await _supervisor.RestartAsync(_settings, pairing, CancellationToken.None);
            SetFeedback("Edge runtime restart requested.", false);
        }
        catch (Exception error) { SetFeedback(error.Message, true); }
    }

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
