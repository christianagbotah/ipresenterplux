using iPresenterPlux.Edge.Desktop;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class ProgramDisplaySettingsTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ipresenterplux-program-display-settings", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task SelectedDisplayAndPlacementPersistAcrossRestart()
    {
        var store = new DesktopSettingsStore(_root);
        var settings = new DesktopSettings(
            "https://control.example.test",
            "Sanctuary Edge",
            ProgramDisplayId: "projector",
            ProgramDisplayX: 1920,
            ProgramDisplayY: 0,
            ProgramDisplayWidth: 1920,
            ProgramDisplayHeight: 1080);

        await store.SaveAsync(settings, CancellationToken.None);
        var loaded = await store.LoadAsync(CancellationToken.None);

        Assert.Equal("projector", loaded.ProgramDisplayId);
        Assert.Equal(1920, loaded.ProgramDisplayX);
        Assert.Equal(0, loaded.ProgramDisplayY);
        Assert.Equal(1920, loaded.ProgramDisplayWidth);
        Assert.Equal(1080, loaded.ProgramDisplayHeight);
    }

    [Fact]
    public void PlacementRequiresPositiveDisplayDimensions()
    {
        var settings = new DesktopSettings(
            "https://control.example.test",
            "Sanctuary Edge",
            ProgramDisplayId: "projector",
            ProgramDisplayX: 1920,
            ProgramDisplayY: 0,
            ProgramDisplayWidth: 0,
            ProgramDisplayHeight: 1080);

        Assert.Throws<InvalidOperationException>(() => settings.Normalize());
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
