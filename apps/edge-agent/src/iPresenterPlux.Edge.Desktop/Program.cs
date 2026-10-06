using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;

namespace iPresenterPlux.Edge.Desktop;

internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        var lifetime = new ClassicDesktopStyleApplicationLifetime
        {
            Args = args,
            ShutdownMode = ShutdownMode.OnLastWindowClose
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

        lifetime.MainWindow = new MainWindow();
        lifetime.Start(args);
    }
}
