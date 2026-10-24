using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class DesktopUpdateHostTests
{
    [Fact]
    public void AttachDetachesExistingWindowContentBeforeReparentingIt()
    {
        var source = File.ReadAllText(FindSourceFile(
            "apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "Update", "DesktopUpdateHost.cs"));

        var detach = source.IndexOf("window.Content = null;", StringComparison.Ordinal);
        var reparent = source.IndexOf("root.Children.Add(existingContent);", StringComparison.Ordinal);

        Assert.True(detach >= 0, "DesktopUpdateHost must detach the existing content from the Window before reparenting it.");
        Assert.True(reparent >= 0, "DesktopUpdateHost must add the existing content to the updater root.");
        Assert.True(detach < reparent, "Existing window content must be detached before it is added to the updater root.");
    }

    [Fact]
    public void UpdatesLiveInTopAboutMenuInsteadOfPersistentBottomBar()
    {
        var source = File.ReadAllText(FindSourceFile(
            "apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "Update", "DesktopUpdateHost.cs"));

        Assert.Contains("Header = \"About\"", source, StringComparison.Ordinal);
        Assert.Contains("Header = \"Check for updates\"", source, StringComparison.Ordinal);
        Assert.Contains("VerticalAlignment = VerticalAlignment.Top", source, StringComparison.Ordinal);
        Assert.Contains("HorizontalAlignment = HorizontalAlignment.Right", source, StringComparison.Ordinal);
        Assert.DoesNotContain("DockPanel.SetDock(bar, Dock.Bottom)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Checks use https://updates.lightworldtech.com and never block presentation startup.", source, StringComparison.Ordinal);
    }

    private static string FindSourceFile(params string[] pathParts)
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine([current.FullName, .. pathParts]);
            if (File.Exists(candidate)) return candidate;
            current = current.Parent;
        }

        throw new FileNotFoundException("Could not locate desktop source from the desktop test output directory.");
    }
}
