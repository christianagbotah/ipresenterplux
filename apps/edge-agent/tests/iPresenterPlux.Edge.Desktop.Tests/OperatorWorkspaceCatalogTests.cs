using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class OperatorWorkspaceCatalogTests
{
    [Fact]
    public void SyncedCatalogKeepsPlannedRundownSeparateFromAdHocScriptureQueue()
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

        Assert.Equal(2, view.RundownItems.Count);
        Assert.Equal(["song-1", "slide-1"], view.RundownItems.Select(item => item.Id).ToArray());
        Assert.DoesNotContain(view.RundownItems, item => item.Id == "scripture-live");
        Assert.DoesNotContain(view.Items, item => item.Id.StartsWith("scripture-john-3-16", StringComparison.Ordinal));
    }

    [Fact]
    public void SyncedMediaKeepsSourceItemTypeAndEmptyBodyForItemBasedPreview()
    {
        var media = Item("media-1", "media", "Worship Video", "", null);
        var view = OperatorWorkspaceCatalog.FromCatalog(
            Snapshot(Guid.NewGuid(), items: [media], scripture: []),
            stale: false);

        var item = Assert.Single(view.RundownItems);
        Assert.Equal("Media", item.Category);
        Assert.Equal("media", item.SourceItemType);
        Assert.True(item.IsSynced);
        Assert.Equal(string.Empty, item.Body);
    }

    [Fact]
    public void MediaStatusUsesAuthoritativePreparationAndPlaybackWithProgramTakingPrecedence()
    {
        var serviceId = Guid.NewGuid();
        var item = new OperatorWorkspaceItem(
            "media-1", "Media", "Worship Video", "", null, "MEDIA", "media", true);

        Assert.Equal("DOWNLOADING", OperatorWorkspaceCatalog.ResolveMediaStatus(
            item, SnapshotWithMedia(serviceId, MediaPreparationState.Downloading)));
        Assert.Equal("READY", OperatorWorkspaceCatalog.ResolveMediaStatus(
            item, SnapshotWithMedia(serviceId, MediaPreparationState.Ready)));
        Assert.Equal("ERROR", OperatorWorkspaceCatalog.ResolveMediaStatus(
            item, SnapshotWithMedia(serviceId, MediaPreparationState.Failed, errorCode: "media_download_failed")));

        var live = SnapshotWithMedia(serviceId, MediaPreparationState.Ready, playbackState: "playing", programItemId: item.Id);
        Assert.Equal("LIVE", OperatorWorkspaceCatalog.ResolveMediaStatus(item, live));
        Assert.Equal("PAUSED", OperatorWorkspaceCatalog.ResolveMediaStatus(
            item, live with { MediaPlayback = live.MediaPlayback! with { State = "paused" } }));
        Assert.Equal("ENDED", OperatorWorkspaceCatalog.ResolveMediaStatus(
            item, live with { MediaPlayback = live.MediaPlayback! with { State = "ended" } }));
        Assert.Equal("ERROR", OperatorWorkspaceCatalog.ResolveMediaStatus(
            item, live with { MediaPlayback = live.MediaPlayback! with { State = "error", ErrorCode = "media_browser_playback_blocked" } }));
    }

    [Fact]
    public void TakeEligibilityBlocksUnreadyMediaButLeavesOrdinaryScriptureUnchanged()
    {
        var serviceId = Guid.NewGuid();
        var media = MediaRender("media-1", serviceId);
        var queued = SnapshotWithMedia(serviceId, MediaPreparationState.Queued) with { Preview = media };
        var ready = SnapshotWithMedia(serviceId, MediaPreparationState.Ready) with { Preview = media };
        var failed = SnapshotWithMedia(serviceId, MediaPreparationState.Failed, "media_corrupt") with { Preview = media };

        Assert.False(OperatorWorkspaceCatalog.CanTakePreview(queued));
        Assert.True(OperatorWorkspaceCatalog.CanTakePreview(ready));
        Assert.False(OperatorWorkspaceCatalog.CanTakePreview(failed));

        var scripture = queued with
        {
            Preview = new PresentationRenderItem(
                "scripture-1", serviceId, "scripture", "John 3:16", "For God so loved...", "KJV", new Dictionary<string, string>())
        };
        Assert.True(OperatorWorkspaceCatalog.CanTakePreview(scripture));
        var scriptureItem = new OperatorWorkspaceItem(
            "scripture-1", "Scripture", "John 3:16", "For God so loved...", "KJV", "SCRIPTURE", "scripture", true);
        Assert.Null(OperatorWorkspaceCatalog.ResolveMediaStatus(scriptureItem, scripture));
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
    public void SyncedNoServiceUsesLocalRehearsalWithoutInventingDemoOrServiceSchedule()
    {
        var rehearsal = OperatorWorkspaceCatalog.FromCatalog(null, stale: false);
        Assert.True(rehearsal.IsRehearsal);
        Assert.False(rehearsal.HasSyncedCatalog);
        Assert.Equal("LOCAL REHEARSAL", rehearsal.StatusLabel);
        Assert.Equal(OperatorWorkspaceCatalog.Seeded.Count, rehearsal.Items.Count);
        Assert.Equal(OperatorWorkspaceCatalog.Seeded.Count, rehearsal.RundownItems.Count);

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

        Assert.True(synced.IsRehearsal);
        Assert.True(synced.HasSyncedCatalog);
        Assert.Empty(synced.Items);
        Assert.Empty(synced.RundownItems);
        Assert.Equal("LOCAL REHEARSAL · CLOUD LIBRARY", synced.StatusLabel);
    }

    [Fact]
    public void CloudLibraryRemainsSearchableDuringLocalRehearsalWithoutBecomingServiceSchedule()
    {
        var now = DateTimeOffset.Parse("2026-10-23T12:00:00Z");
        var catalog = new OperatorCatalogSnapshot(
            OperatorCatalogSnapshot.CurrentSchemaVersion,
            now,
            now,
            "cloud-library-rehearsal",
            null,
            [new OperatorBibleVersion("KJV", "King James Version", "KJV", "en")],
            [],
            []) with
        {
            LibraryItems =
            [
                Item("library-song-1", "song", "Amazing Grace", "Verse 1\nAmazing grace", "John Newton"),
                Item("library-slide-1", "slide", "Welcome", "Welcome home", null),
                Item("library-media-1", "media", "Welcome Loop", "", null),
            ]
        };

        var view = OperatorWorkspaceCatalog.FromCatalog(catalog, stale: false);

        Assert.True(view.IsRehearsal);
        Assert.True(view.HasSyncedCatalog);
        Assert.Equal("LOCAL REHEARSAL · CLOUD LIBRARY", view.StatusLabel);
        Assert.Equal(3, view.Items.Count);
        Assert.Empty(view.RundownItems);
        Assert.Contains(view.Items, item => item.Id == "library-song-1" && item.Category == "Songs" && item.IsSynced);
        Assert.Contains(view.Items, item => item.Id == "library-media-1" && item.Category == "Media" && item.IsSynced);
    }

    [Fact]
    public void ActiveServiceCatalogCombinesCloudLibraryWithServiceAndAdHocItemsWithoutChangingRundown()
    {
        var catalog = Snapshot(
            Guid.NewGuid(),
            items: [Item("service-slide", "slide", "Giving", "Give faithfully", null)],
            scripture: [Item("adhoc-scripture", "scripture", "John 3:16", "For God so loved", "KJV")]) with
        {
            LibraryItems =
            [
                Item("library-song", "song", "Amazing Grace", "Amazing grace", "John Newton"),
                Item("service-slide", "slide", "Giving library copy", "Must be deduplicated by id", null),
            ]
        };

        var view = OperatorWorkspaceCatalog.FromCatalog(catalog, stale: false);

        Assert.Equal(3, view.Items.Count);
        Assert.Contains(view.Items, item => item.Id == "library-song");
        Assert.Contains(view.Items, item => item.Id == "adhoc-scripture");
        Assert.Single(view.Items, item => item.Id == "service-slide");
        Assert.Single(view.RundownItems);
        Assert.Equal("service-slide", view.RundownItems[0].Id);
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
        Assert.Equal("scripture", item.SourceItemType);
        Assert.False(item.IsSynced);
        Assert.Equal("scripture", item.ToPresentation().ItemType);
    }

    private static LocalOperatorSnapshot SnapshotWithMedia(
        Guid serviceId,
        MediaPreparationState state,
        string? errorCode = null,
        string? playbackState = null,
        string? programItemId = null)
    {
        var preparations = new[]
        {
            new LocalOperatorMediaPreparation("media-1", serviceId, state, errorCode)
        };
        var playback = playbackState is null ? null : new MediaPlaybackSnapshot(
            "media-1", serviceId, new string('f', 64), "video", playbackState,
            DateTimeOffset.Parse("2026-10-22T12:00:00Z"), null, 0, 1.2, 0, 20, false, 1, "contain", 9);
        return new LocalOperatorSnapshot(
            true, null, programItemId is null ? null : MediaRender(programItemId, serviceId), false, null,
            "Online", serviceId, "service", DateTimeOffset.Parse("2026-10-22T12:00:00Z"),
            playback, preparations);
    }

    private static PresentationRenderItem MediaRender(string itemId, Guid serviceId) => new(
        itemId, serviceId, "media", "Worship Video", "", null, new Dictionary<string, string>(),
        new PresentationMediaDescriptor(Guid.NewGuid(), "video", new Uri("https://cdn.example.test/video.mp4"), "v1",
            "video/mp4", "Video", 0, 20, false, 1, "contain").Validate());

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
