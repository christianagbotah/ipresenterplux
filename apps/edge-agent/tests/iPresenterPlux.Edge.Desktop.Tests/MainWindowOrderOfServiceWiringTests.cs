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
