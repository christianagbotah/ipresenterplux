using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class DesktopOperatorScheduleStoreTests
{
    [Fact]
    public async Task PersistsOrderedLocalScheduleAtomically()
    {
        var root = Path.Combine(Path.GetTempPath(), "ipresenterplux-schedule-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var store = new DesktopOperatorScheduleStore(root);
            var first = new OperatorWorkspaceItem("song-1", "Songs", "Amazing Grace", "Verse one", "Verse 1", "SONG");
            var second = new OperatorWorkspaceItem("slide-1", "Slides", "Welcome", "Welcome everyone", null, "SLIDE");

            await store.SaveAsync(new[] { first, second }, CancellationToken.None);
            var loaded = await store.LoadAsync(CancellationToken.None);

            Assert.Equal(new[] { "song-1", "slide-1" }, loaded.Select(item => item.Id));

            await store.SaveAsync(new[] { second, first }, CancellationToken.None);
            var reordered = await store.LoadAsync(CancellationToken.None);
            Assert.Equal(new[] { "slide-1", "song-1" }, reordered.Select(item => item.Id));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task MissingOrCorruptScheduleFailsSafeToEmpty()
    {
        var root = Path.Combine(Path.GetTempPath(), "ipresenterplux-schedule-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var store = new DesktopOperatorScheduleStore(root);
            Assert.Empty(await store.LoadAsync(CancellationToken.None));

            await File.WriteAllTextAsync(Path.Combine(root, "operator-schedule.json"), "{not json");
            Assert.Empty(await store.LoadAsync(CancellationToken.None));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
