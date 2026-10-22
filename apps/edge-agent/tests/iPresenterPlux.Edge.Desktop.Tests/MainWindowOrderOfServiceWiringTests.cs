using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class MainWindowOrderOfServiceWiringTests
{
    [Fact]
    public void MainWindowWiresCanonicalOrderOfServiceNavigation()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("ORDER OF SERVICE", source, StringComparison.Ordinal);
        Assert.Contains("OperatorRundownNavigator", source, StringComparison.Ordinal);
        Assert.Contains("RundownItems", source, StringComparison.Ordinal);
        Assert.Contains("AdvanceAfterTake", source, StringComparison.Ordinal);
        Assert.Contains("response.Ok", source, StringComparison.Ordinal);
        Assert.Contains("MoveRundownSelection", source, StringComparison.Ordinal);
        Assert.Contains("args.Source is not TextBox", source, StringComparison.Ordinal);
        Assert.Contains("CURRENT", source, StringComparison.Ordinal);
        Assert.Contains("PREVIEW", source, StringComparison.Ordinal);
        Assert.Contains("NEXT", source, StringComparison.Ordinal);
    }

    [Fact]
    public void MainWindowProvidesActionableMediaRecoveryCopy()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        foreach (var code in new[]
        {
            "media_download_failed", "media_remote_unsafe", "media_too_large", "media_type_unsupported",
            "media_corrupt", "media_cache_full", "media_scope_mismatch", "media_browser_playback_blocked",
            "media_video_decode_failed", "media_audio_decode_failed"
        })
        {
            Assert.Contains($"\"{code}\"", source, StringComparison.Ordinal);
        }
        Assert.Contains("Preview again", source, StringComparison.Ordinal);
        Assert.Contains("approved HTTPS", source, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("supported", source, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("disk space", source, StringComparison.OrdinalIgnoreCase);
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

        throw new FileNotFoundException("Could not locate MainWindow.cs from the desktop test output directory.");
    }
}
