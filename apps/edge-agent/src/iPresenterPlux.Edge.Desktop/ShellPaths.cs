namespace iPresenterPlux.Edge.Desktop;

public sealed record ShellPaths(
    string SettingsDirectory,
    string EdgeDataDirectory,
    string RuntimeHostPath)
{
    public static ShellPaths CreateDefault()
    {
        var settingsRoot = Environment.GetFolderPath(
            OperatingSystem.IsMacOS() ? Environment.SpecialFolder.ApplicationData : Environment.SpecialFolder.LocalApplicationData);
        var edgeRoot = Environment.GetFolderPath(
            OperatingSystem.IsMacOS() ? Environment.SpecialFolder.ApplicationData : Environment.SpecialFolder.LocalApplicationData);
        var executable = OperatingSystem.IsWindows()
            ? "iPresenterPlux.Edge.Windows.exe"
            : "iPresenterPlux.Edge.MacOS";
        var overridePath = Environment.GetEnvironmentVariable("IPRESENTERPLUX_EDGE_HOST_PATH")?.Trim();
        var runtimePath = !string.IsNullOrWhiteSpace(overridePath)
            ? Path.GetFullPath(overridePath)
            : Path.Combine(AppContext.BaseDirectory, "runtime", executable);
        return new ShellPaths(
            Path.Combine(settingsRoot, "iPresenterPlux", "Desktop"),
            Path.Combine(edgeRoot, "iPresenterPlux", "Edge"),
            runtimePath);
    }
}
