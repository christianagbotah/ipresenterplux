using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;

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
        _supervisor.SnapshotChanged += (_, snapshot) => Dispatcher.UIThread.Post(() => RenderSnapshot(snapshot));

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
            if (args.Key == Key.F5 && !_restart.IsEnabled) return;
            if (args.Key == Key.F5) _ = RestartAsync();
        };

        _save.Click += async (_, _) => await SaveAsync();
        _start.Click += async (_, _) => await StartAsync();
        _stop.Click += async (_, _) => await StopAsync();
        _restart.Click += async (_, _) => await RestartAsync();
    }

    private Control BuildContent()
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
        quickLinks.Children.Add(LinkButton("Preview", () => LocalUri("preview")));
        quickLinks.Children.Add(LinkButton("Program", () => LocalUri("program")));
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
        }
        if (!File.Exists(_paths.RuntimeHostPath))
            SetFeedback("The packaged Edge runtime is not beside the shell yet. CI packaging must stage it before field use.", true);
    }

    private DesktopSettings ReadSettings() => new(
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
        _programStatus.Text = $"Local Program · {(snapshot.LocalProgramHealthy ? "available" : "waiting")}";
        _programStatus.Foreground = snapshot.LocalProgramHealthy ? Good : Muted;

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
