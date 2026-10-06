using iPresenterPlux.Edge.Desktop;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class DesktopSettingsStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(
        Path.GetTempPath(), "ipresenterplux-desktop-settings-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task SettingsPersistOnlyNonSecretConfiguration()
    {
        var store = new DesktopSettingsStore(_directory);
        var pairingCode = "PAIR-SECRET-8392";
        var settings = new DesktopSettings("https://control.example.test", "Sanctuary Edge");

        await store.SaveAsync(settings, CancellationToken.None);
        var json = await File.ReadAllTextAsync(store.SettingsPath);
        var loaded = await store.LoadAsync(CancellationToken.None);

        Assert.DoesNotContain(pairingCode, json, StringComparison.Ordinal);
        Assert.DoesNotContain("pairing", json, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(settings.ControlPlaneUrl, loaded.ControlPlaneUrl);
        Assert.Equal(settings.DeviceName, loaded.DeviceName);
    }

    [Theory]
    [InlineData("http://church.example.test")]
    [InlineData("ftp://control.example.test")]
    [InlineData("not-a-url")]
    public void RemoteControlPlaneMustBeHttps(string value)
    {
        var settings = new DesktopSettings(value, "Edge");
        Assert.Throws<InvalidOperationException>(() => settings.Normalize());
    }

    [Fact]
    public void LoopbackHttpIsAllowedForDevelopment()
    {
        var settings = new DesktopSettings("http://127.0.0.1:3011", "Edge");
        Assert.Equal("http://127.0.0.1:3011", settings.Normalize().ControlPlaneUrl);
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
