using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class OperatorCatalogStoreTests
{
    [Fact]
    public async Task CatalogRoundTripsAndAtomicReplacementKeepsOnlyNewestRevision()
    {
        using var fixture = new CatalogFixture();
        var store = new OperatorCatalogStore(fixture.Directory);
        var first = fixture.Snapshot("rev-1");
        var second = fixture.Snapshot("rev-2");

        await store.WriteAsync(first, CancellationToken.None);
        Assert.Equal(first, await store.ReadAsync(CancellationToken.None));
        await store.WriteAsync(second, CancellationToken.None);

        var loaded = await store.ReadAsync(CancellationToken.None);
        Assert.Equal("rev-2", loaded?.CatalogRevision);
        Assert.False(File.Exists(Path.Combine(fixture.Directory, "operator-catalog.json.tmp")));
    }

    [Fact]
    public async Task CorruptAndUnsupportedCacheAreIgnoredSafely()
    {
        using var fixture = new CatalogFixture();
        var path = Path.Combine(fixture.Directory, "operator-catalog.json");
        await File.WriteAllTextAsync(path, "{ definitely-not-json", CancellationToken.None);
        var store = new OperatorCatalogStore(fixture.Directory);
        Assert.Null(await store.ReadAsync(CancellationToken.None));

        await File.WriteAllTextAsync(path, "{\"schemaVersion\":99}", CancellationToken.None);
        Assert.Null(await store.ReadAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ServiceChangePurgesOldServiceCatalogBeforeNextSync()
    {
        using var fixture = new CatalogFixture();
        var store = new OperatorCatalogStore(fixture.Directory);
        await store.WriteAsync(fixture.Snapshot("rev-1"), CancellationToken.None);

        Assert.False(await store.ClearServiceAsync(fixture.ServiceId, CancellationToken.None));
        Assert.NotNull(await store.ReadAsync(CancellationToken.None));

        Assert.True(await store.ClearServiceAsync(Guid.NewGuid(), CancellationToken.None));
        Assert.Null(await store.ReadAsync(CancellationToken.None));
    }

    [Fact]
    public async Task WriteBoundsCollectionsAndDropsSensitiveMetadata()
    {
        using var fixture = new CatalogFixture();
        var versions = Enumerable.Range(0, 40)
            .Select(i => new OperatorBibleVersion($"V{i}", $"Version {i}", $"V{i}", "en"))
            .ToArray();
        var items = Enumerable.Range(0, 220)
            .Select(i => fixture.Item($"item-{i}", new Dictionary<string, string> {
                ["artist"] = "Choir",
                ["accessToken"] = "super-secret-value",
            }))
            .ToArray();
        var snapshot = fixture.Snapshot("rev-bounded") with {
            BibleVersions = versions,
            Items = items,
            ScriptureQueue = items,
        };
        var store = new OperatorCatalogStore(fixture.Directory);

        await store.WriteAsync(snapshot, CancellationToken.None);
        var loaded = await store.ReadAsync(CancellationToken.None);
        Assert.NotNull(loaded);
        Assert.Equal(32, loaded.BibleVersions.Count);
        Assert.Equal(200, loaded.Items.Count);
        Assert.Equal(200, loaded.ScriptureQueue.Count);
        Assert.Equal("Choir", loaded.Items[0].Metadata["artist"]);
        Assert.False(loaded.Items[0].Metadata.ContainsKey("accessToken"));

        var json = await File.ReadAllTextAsync(Path.Combine(fixture.Directory, "operator-catalog.json"));
        Assert.DoesNotContain("super-secret-value", json, StringComparison.Ordinal);
        Assert.DoesNotContain("accessToken", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void StaleStateUsesSyncAgeWithoutMutatingSnapshot()
    {
        using var fixture = new CatalogFixture();
        var syncedAt = DateTimeOffset.Parse("2026-10-06T12:00:00Z");
        var snapshot = fixture.Snapshot("rev-1", syncedAt);

        Assert.False(snapshot.IsStale(syncedAt.AddMinutes(2), TimeSpan.FromMinutes(5)));
        Assert.True(snapshot.IsStale(syncedAt.AddMinutes(6), TimeSpan.FromMinutes(5)));
        Assert.Equal(syncedAt, snapshot.SyncedAt);
    }

    private sealed class CatalogFixture : IDisposable
    {
        public string Directory { get; } = Path.Combine(Path.GetTempPath(), "ipresenterplux-catalog-tests", Guid.NewGuid().ToString("N"));
        public Guid ServiceId { get; } = Guid.NewGuid();

        public CatalogFixture() => System.IO.Directory.CreateDirectory(Directory);

        public OperatorCatalogSnapshot Snapshot(string revision, DateTimeOffset? syncedAt = null) => new(
            OperatorCatalogSnapshot.CurrentSchemaVersion,
            syncedAt ?? DateTimeOffset.Parse("2026-10-06T12:00:00Z"),
            DateTimeOffset.Parse("2026-10-06T11:59:58Z"),
            revision,
            new OperatorCatalogService(ServiceId, "Sunday Service", "live", "KJV", null, null),
            [new OperatorBibleVersion("KJV", "King James Version", "KJV", "en")],
            [Item("opening")],
            [Item("john-3-16")]);

        public OperatorCatalogItem Item(string id, IReadOnlyDictionary<string, string>? metadata = null) => new(
            id,
            "scripture",
            "John 3:16",
            "For God so loved the world...",
            "KJV",
            metadata ?? new Dictionary<string, string>());

        public void Dispose()
        {
            if (System.IO.Directory.Exists(Directory)) System.IO.Directory.Delete(Directory, recursive: true);
        }
    }
}
