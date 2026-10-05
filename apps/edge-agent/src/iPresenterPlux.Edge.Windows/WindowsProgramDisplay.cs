using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Windows;

public static class WindowsProgramDisplay
{
    public static ChromiumKioskLauncher Create(string dataDirectory, string? explicitBrowserPath = null)
    {
        var paths = new List<string>();
        if (!string.IsNullOrWhiteSpace(explicitBrowserPath)) paths.Add(explicitBrowserPath);

        Add(paths, Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe");
        Add(paths, Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe");
        Add(paths, Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe");
        Add(paths, Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe");
        Add(paths, Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe");
        Add(paths, Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe");

        return new ChromiumKioskLauncher(paths, Path.Combine(dataDirectory, "program-browser-profile"));
    }

    private static void Add(ICollection<string> paths, string root, string relative)
    {
        if (!string.IsNullOrWhiteSpace(root)) paths.Add(Path.Combine(root, relative));
    }
}
