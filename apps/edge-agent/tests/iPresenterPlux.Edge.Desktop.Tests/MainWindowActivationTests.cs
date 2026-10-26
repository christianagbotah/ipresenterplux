using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class MainWindowActivationTests
{
    [Fact]
    public void MainWindowWiresSubscriptionActivationBeforeOperatorStartup()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));

        Assert.Contains("BuildActivationContent", source, StringComparison.Ordinal);
        Assert.Contains("Header = \"Activation\"", source, StringComparison.Ordinal);
        Assert.Contains("Product key", source, StringComparison.Ordinal);
        Assert.Contains("ActivateAsync", source, StringComparison.Ordinal);
        Assert.Contains("RenewAsync", source, StringComparison.Ordinal);
        Assert.Contains("DesktopEntitlementStore.CreateDefault", source, StringComparison.Ordinal);
        Assert.Contains("EntitlementVerifier.Verify", source, StringComparison.Ordinal);
        Assert.Contains("Offline grace", source, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Subscription expired", source, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("_tabs.SelectedIndex = ActivationTabIndex", source, StringComparison.Ordinal);
        Assert.Contains("_tabs.SelectedIndex = SetupTabIndex", source, StringComparison.Ordinal);
        Assert.Contains("_tabs.SelectedIndex = OperatorTabIndex", source, StringComparison.Ordinal);
        Assert.Contains("Setup & Runtime", source, StringComparison.Ordinal);
        Assert.Contains("EnsureEntitlementForStartAsync", source, StringComparison.Ordinal);
        Assert.Contains("Settings remain available", source, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void OfficialDesktopReleaseBundlesEntitlementVerificationKeys()
    {
        var catalog = FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "entitlement-public-keys.json");
        var json = File.ReadAllText(catalog);
        Assert.Contains("ipresenterplux-prod-", json, StringComparison.Ordinal);

        var project = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "iPresenterPlux.Edge.Desktop.csproj"));
        Assert.Contains("entitlement-public-keys.json", project, StringComparison.Ordinal);
        Assert.Contains("CopyToOutputDirectory", project, StringComparison.Ordinal);
    }

    [Fact]
    public void MainWindowStartsMaximizedAndKeepsLaptopFriendlyRestoreBounds()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));
        Assert.Contains("WindowState = WindowState.Maximized", source, StringComparison.Ordinal);
        Assert.Contains("MinWidth = 760", source, StringComparison.Ordinal);
        Assert.Contains("MinHeight = 520", source, StringComparison.Ordinal);
    }

    [Fact]
    public void DesktopSettingsNeverPersistProductKeysOrActivationTokens()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "DesktopSettings.cs"));
        Assert.DoesNotContain("ProductKey", source, StringComparison.Ordinal);
        Assert.DoesNotContain("ActivationToken", source, StringComparison.Ordinal);
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

        throw new FileNotFoundException("Could not locate desktop source from the test output directory.");
    }
}
