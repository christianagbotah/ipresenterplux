using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class OperatorWorkspaceCatalogTests
{
    [Fact]
    public void SyncedCatalogMapsRealRundownAndActiveBibleVersionWithoutDemoSeeds()
    {
        var serviceId = Guid.NewGuid();
        var catalog = Snapshot(
            serviceId,
            items:
            [
                Item("song-1", "song", "Amazing Grace", "Amazing grace...", "Verse 1"),
                Item("slide-1", "slide", "Welcome", "Welcome home", null),
            ],
            scripture:
            [
                Item("scripture-live", "scripture", "John 3:16", "For God so loved the world...", "KJV")
            ]);

        var view = OperatorWorkspaceCatalog.FromCatalog(catalog, stale: false);

        Assert.False(view.IsRehearsal);
        Assert.True(view.HasSyncedCatalog);
        Assert.Equal("LIVE CATALOG", view.StatusLabel);
        Assert.Equal("Sunday Worship", view.ServiceTitle);
        Assert.Equal("live", view.ServiceStatus);
        Assert.Equal("KJV", view.ActiveBibleVersion);
        Assert.Equal(2, view.BibleVersions.Count);
        Assert.Equal(3, view.Items.Count);
        Assert.Contains(view.Items, item => item.Id == "scripture-live" && item.Category == "Scripture");
        Assert.Contains(view.Items, item => item.Id == "song-1" && item.Category == "Songs");
        Assert.Contains(view.Items, item => item.Id == "slide-1" && item.Category == "Slides");
        Assert.DoesNotContain(view.Items, item => item.Id.StartsWith("scripture-john-3-16", StringComparison.Ordinal));
    }

    [Fact]
    public void StaleSyncedCatalogIsOfflineCacheNotRehearsal()
    {
        var catalog = Snapshot(Guid.NewGuid(), items: [], scripture: []);

        var view = OperatorWorkspaceCatalog.FromCatalog(catalog, stale: true);

        Assert.False(view.IsRehearsal);
        Assert.True(view.HasSyncedCatalog);
        Assert.True(view.IsStale);
        Assert.Equal("OFFLINE CACHE", view.StatusLabel);
    }

    [Fact]
    public void MissingCatalogUsesExplicitLocalRehearsalButSyncedNoServiceDoesNot()
    {
        var rehearsal = OperatorWorkspaceCatalog.FromCatalog(null, stale: false);
        Assert.True(rehearsal.IsRehearsal);
        Assert.False(rehearsal.HasSyncedCatalog);
        Assert.Equal("LOCAL REHEARSAL", rehearsal.StatusLabel);
        Assert.Equal(OperatorWorkspaceCatalog.Seeded.Count, rehearsal.Items.Count);

        var now = DateTimeOffset.Parse("2026-10-06T10:00:00Z");
        var noService = new OperatorCatalogSnapshot(
            OperatorCatalogSnapshot.CurrentSchemaVersion,
            now,
            now,
            "no-service-rev",
            null,
            [new OperatorBibleVersion("KJV", "King James Version", "KJV", "en")],
            [],
            []);
        var synced = OperatorWorkspaceCatalog.FromCatalog(noService, stale: false);

        Assert.False(synced.IsRehearsal);
        Assert.True(synced.HasSyncedCatalog);
        Assert.Empty(synced.Items);
        Assert.Equal("NO ACTIVE SERVICE", synced.StatusLabel);
    }

    [Fact]
    public void FilterUsesCategoryTitleBodyAndCategoryText()
    {
        var items = new[]
        {
            new OperatorWorkspaceItem("s1", "Scripture", "John 3:16", "For God so loved", "KJV", "SCRIPTURE"),
            new OperatorWorkspaceItem("m1", "Media", "Welcome Loop", "Lobby video", null, "MEDIA"),
            new OperatorWorkspaceItem("a1", "Announcements", "Midweek", "Prayer meeting Wednesday", null, "NOTICE"),
        };

        Assert.Single(OperatorWorkspaceCatalog.Filter(items, "Scripture", "John"));
        Assert.Equal("m1", Assert.Single(OperatorWorkspaceCatalog.Filter(items, "All", "lobby")).Id);
        Assert.Equal("a1", Assert.Single(OperatorWorkspaceCatalog.Filter(items, "Announcements", "prayer")).Id);
        Assert.Empty(OperatorWorkspaceCatalog.Filter(items, "Media", "John"));
    }

    [Fact]
    public void ResolvedScriptureMapsToPreviewReadyWorkspaceItem()
    {
        var resolved = Item("local-scripture-123", "scripture", "Psalm 23:1", "The Lord is my shepherd.", "KJV");

        var item = OperatorWorkspaceCatalog.FromResolved(resolved);

        Assert.Equal("local-scripture-123", item.Id);
        Assert.Equal("Scripture", item.Category);
        Assert.Equal("SCRIPTURE", item.Accent);
        Assert.Equal("Psalm 23:1", item.Title);
        Assert.Equal("KJV", item.Footer);
        Assert.Equal("scripture", item.ToPresentation().ItemType);
    }

    private static OperatorCatalogSnapshot Snapshot(
        Guid serviceId,
        IReadOnlyList<OperatorCatalogItem> items,
        IReadOnlyList<OperatorCatalogItem> scripture)
    {
        var now = DateTimeOffset.Parse("2026-10-06T10:00:00Z");
        return new OperatorCatalogSnapshot(
            OperatorCatalogSnapshot.CurrentSchemaVersion,
            now,
            now,
            "rev-workspace",
            new OperatorCatalogService(serviceId, "Sunday Worship", "live", "KJV", null, now),
            [
                new OperatorBibleVersion("KJV", "King James Version", "KJV", "en"),
                new OperatorBibleVersion("ASV", "American Standard Version", "ASV", "en"),
            ],
            items,
            scripture);
    }

    private static OperatorCatalogItem Item(
        string id,
        string type,
        string title,
        string body,
        string? footer) => new(
            id,
            type,
            title,
            body,
            footer,
            new Dictionary<string, string>());
}
