using Avalonia;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;

namespace iPresenterPlux.Edge.Desktop;

internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        AppBuilder.Configure<Application>()
            .UsePlatformDetect()
            .Start((app, _) =>
            {
                app.Styles.Add(new FluentTheme());
                app.RequestedThemeVariant = ThemeVariant.Dark;
                var window = new MainWindow();
                window.Show();
                app.Run(window);
            }, args);
    }
}
