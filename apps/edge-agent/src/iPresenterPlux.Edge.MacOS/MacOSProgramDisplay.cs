using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.MacOS;

public static class MacOSProgramDisplay
{
    public static ChromiumKioskLauncher Create(string dataDirectory, string? explicitBrowserPath = null)
    {
        var paths = new List<string>();
        if (!string.IsNullOrWhiteSpace(explicitBrowserPath)) paths.Add(explicitBrowserPath);
        paths.Add("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
        paths.Add("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
        paths.Add("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser");
        paths.Add("/Applications/Chromium.app/Contents/MacOS/Chromium");

        return new ChromiumKioskLauncher(paths, Path.Combine(dataDirectory, "program-browser-profile"));
    }
}
