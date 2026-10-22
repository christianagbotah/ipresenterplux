using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;
using iPresenterPlux.Edge.Desktop.Update;

namespace iPresenterPlux.Edge.Desktop;

internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        var lifetime = new ClassicDesktopStyleApplicationLifetime
        {
            Args = args
        };

        AppBuilder.Configure<Application>()
            .UsePlatformDetect()
            .AfterSetup(builder =>
            {
                if (builder.Instance is not { } app) return;
                app.Styles.Add(new FluentTheme());
                app.RequestedThemeVariant = ThemeVariant.Dark;
            })
            .SetupWithLifetime(lifetime);

        var window = new MainWindow();
        DesktopUpdateHost.Attach(window, ReadUpdateHealthToken(args));
        lifetime.MainWindow = window;
        lifetime.Start(args);
    }

    private static string? ReadUpdateHealthToken(string[] args)
    {
        for (var index = 0; index < args.Length - 1; index++)
        {
            if (string.Equals(args[index], "--update-health-token", StringComparison.Ordinal))
                return args[index + 1];
        }
        return null;
    }
}
