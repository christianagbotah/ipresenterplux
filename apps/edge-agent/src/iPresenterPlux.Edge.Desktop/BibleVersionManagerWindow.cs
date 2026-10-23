using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace iPresenterPlux.Edge.Desktop;

public sealed class BibleVersionManagerWindow : Window
{
    private static readonly SolidColorBrush Surface = new(Color.Parse("#0D121A"));
    private static readonly SolidColorBrush Raised = new(Color.Parse("#121925"));
    private static readonly SolidColorBrush Muted = new(Color.Parse("#8B95A5"));
    private static readonly SolidColorBrush Gold = new(Color.Parse("#D7A94A"));
    private static readonly SolidColorBrush Good = new(Color.Parse("#55D38A"));
    private static readonly SolidColorBrush Danger = new(Color.Parse("#F47B7B"));

    private readonly DesktopBibleLibrary _library;
    private readonly StackPanel _versionList = new() { Spacing = 10 };
    private readonly TextBox _search = new() { Watermark = "Search Bible versions", MinHeight = 40 };
    private readonly TextBlock _feedback = new() { FontSize = 12, Foreground = Muted, TextWrapping = TextWrapping.Wrap };

    public BibleVersionManagerWindow(DesktopBibleLibrary library)
    {
        _library = library ?? throw new ArgumentNullException(nameof(library));
        Title = "Bible Versions";
        Width = 660;
        Height = 520;
        MinWidth = 520;
        MinHeight = 420;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        Background = new SolidColorBrush(Color.Parse("#070A0F"));

        var heading = new StackPanel
        {
            Spacing = 5,
            Children =
            {
                new TextBlock { Text = "Offline Bible Versions", FontSize = 25, FontWeight = FontWeight.Bold, Foreground = Brushes.White },
                new TextBlock
                {
                    Text = "Download approved editions once and Scripture lookup keeps working during local rehearsal or an Internet outage.",
                    FontSize = 12,
                    Foreground = Muted,
                    TextWrapping = TextWrapping.Wrap
                }
            }
        };

        _search.TextChanged += (_, _) => RenderVersions();

        var scroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            Content = _versionList
        };

        var close = ActionButton("Close");
        close.Click += (_, _) => Close();
        var footer = new Grid { ColumnSpacing = 12 };
        footer.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
        footer.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));
        Grid.SetColumn(_feedback, 0);
        Grid.SetColumn(close, 1);
        footer.Children.Add(_feedback);
        footer.Children.Add(close);

        var layout = new Grid { RowSpacing = 14 };
        layout.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        layout.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        layout.RowDefinitions.Add(new RowDefinition(new GridLength(1, GridUnitType.Star)));
        layout.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        Grid.SetRow(heading, 0);
        Grid.SetRow(_search, 1);
        Grid.SetRow(scroll, 2);
        Grid.SetRow(footer, 3);
        layout.Children.Add(heading);
        layout.Children.Add(_search);
        layout.Children.Add(scroll);
        layout.Children.Add(footer);

        Content = new Border
        {
            Margin = new Thickness(18),
            Padding = new Thickness(18),
            Background = Surface,
            CornerRadius = new CornerRadius(16),
            Child = layout
        };

        RenderVersions();
    }

    private void RenderVersions()
    {
        _versionList.Children.Clear();
        var query = _search.Text?.Trim() ?? string.Empty;
        var packages = DesktopBibleLibrary.Catalog.Where(package =>
            query.Length == 0 ||
            package.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
            package.Abbreviation.Contains(query, StringComparison.OrdinalIgnoreCase) ||
            package.Id.Contains(query, StringComparison.OrdinalIgnoreCase));
        foreach (var package in packages)
        {
            var installed = _library.IsInstalled(package.Id);
            var status = new TextBlock
            {
                Text = installed ? "INSTALLED · OFFLINE READY" : package.CanDownload
                    ? $"{package.LicenseLabel.ToUpperInvariant()} · DOWNLOADABLE"
                    : $"{package.LicenseLabel.ToUpperInvariant()} · License/provider required",
                FontSize = 10,
                FontWeight = FontWeight.SemiBold,
                Foreground = installed ? Good : Gold
            };
            var title = new TextBlock
            {
                Text = $"{package.Name} ({package.Abbreviation})",
                FontSize = 16,
                FontWeight = FontWeight.Bold,
                Foreground = Brushes.White
            };
            var description = new StackPanel { Spacing = 4, Children = { title, status } };
            var action = ActionButton(installed ? "Installed" : package.CanDownload ? "Download" : "License required");
            action.IsEnabled = !installed && package.CanDownload;
            action.MinWidth = 126;
            if (package.CanDownload)
                action.Click += async (_, _) => await DownloadAsync(package, action);

            var row = new Grid { ColumnSpacing = 12 };
            row.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star)));
            row.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));
            Grid.SetColumn(description, 0);
            Grid.SetColumn(action, 1);
            row.Children.Add(description);
            row.Children.Add(action);

            _versionList.Children.Add(new Border
            {
                Background = Raised,
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(14, 12),
                Child = row
            });
        }
    }

    private async Task DownloadAsync(BiblePackageDescriptor package, Button button)
    {
        button.IsEnabled = false;
        button.Content = "Downloading…";
        _feedback.Text = $"Downloading {package.Name}…";
        _feedback.Foreground = Muted;
        try
        {
            await _library.InstallAsync(package.Id, CancellationToken.None);
            _feedback.Text = $"{package.Name} is installed and ready for offline Scripture lookup.";
            _feedback.Foreground = Good;
            RenderVersions();
        }
        catch (Exception ex)
        {
            _feedback.Text = $"Could not install {package.Name}: {SafeMessage(ex)}";
            _feedback.Foreground = Danger;
            button.Content = "Retry";
            button.IsEnabled = true;
        }
    }

    private static string SafeMessage(Exception ex) => ex switch
    {
        HttpRequestException => "the download service could not be reached.",
        TaskCanceledException => "the download timed out.",
        InvalidDataException data => data.Message,
        _ => "the package could not be installed."
    };

    private static Button ActionButton(string text) => new()
    {
        Content = text,
        MinHeight = 40,
        Padding = new Thickness(16, 8),
        Background = Raised,
        Foreground = Brushes.White,
        BorderThickness = new Thickness(0),
        CornerRadius = new CornerRadius(8),
        HorizontalAlignment = HorizontalAlignment.Right
    };
}
