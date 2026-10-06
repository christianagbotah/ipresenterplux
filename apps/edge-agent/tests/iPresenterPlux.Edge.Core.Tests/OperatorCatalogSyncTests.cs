using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class OperatorCatalogSyncTests
{
    [Fact]
    public async Task InitialRefreshPersistsCatalogForActiveService()
    {
        using var fixture = new SyncFixture();
        var client = new FakeCatalogClient { Catalog = fixture.Snapshot(fixture.ServiceA, "rev-a") };
        var coordinator = new OperatorCatalogCoordinator(fixture.Store, client);

        await coordinator.SetActiveServiceAsync(fixture.ServiceA, CancellationToken.None);
        await coordinator.RefreshAsync(CancellationToken.None);

        var cached = await fixture.Store.ReadAsync(CancellationToken.None);
        Assert.Equal(fixture.ServiceA, cached?.Service?.ServiceId);
        Assert.Equal("rev-a", cached?.CatalogRevision);
    }

    [Fact]
    public async Task NetworkFailurePreservesLastSameServiceCatalog()
    {
        using var fixture = new SyncFixture();
        var client = new FakeCatalogClient { Catalog = fixture.Snapshot(fixture.ServiceA, "rev-a") };
        var coordinator = new OperatorCatalogCoordinator(fixture.Store, client);
        await coordinator.SetActiveServiceAsync(fixture.ServiceA, CancellationToken.None);
        await coordinator.RefreshAsync(CancellationToken.None);
        client.Error = new HttpRequestException("offline");

        await Assert.ThrowsAsync<HttpRequestException>(() => coordinator.RefreshAsync(CancellationToken.None));

        Assert.Equal("rev-a", (await fixture.Store.ReadAsync(CancellationToken.None))?.CatalogRevision);
    }

    [Fact]
    public async Task ServiceChangePurgesOldCatalogBeforeNetworkRefresh()
    {
        using var fixture = new SyncFixture();
        var client = new FakeCatalogClient { Catalog = fixture.Snapshot(fixture.ServiceA, "rev-a") };
        var coordinator = new OperatorCatalogCoordinator(fixture.Store, client);
        await coordinator.SetActiveServiceAsync(fixture.ServiceA, CancellationToken.None);
        await coordinator.RefreshAsync(CancellationToken.None);

        var observedClearedBeforeFetch = false;
        client.BeforeCatalogFetch = async () =>
        {
            observedClearedBeforeFetch = await fixture.Store.ReadAsync(CancellationToken.None) is null;
        };
        client.Catalog = fixture.Snapshot(fixture.ServiceB, "rev-b");

        await coordinator.SetActiveServiceAsync(fixture.ServiceB, CancellationToken.None);
        Assert.Null(await fixture.Store.ReadAsync(CancellationToken.None));
        await coordinator.RefreshAsync(CancellationToken.None);

        Assert.True(observedClearedBeforeFetch);
        Assert.Equal(fixture.ServiceB, (await fixture.Store.ReadAsync(CancellationToken.None))?.Service?.ServiceId);
    }

    [Fact]
    public async Task MismatchedServerServiceNeverOverwritesActiveServiceCache()
    {
        using var fixture = new SyncFixture();
        var client = new FakeCatalogClient { Catalog = fixture.Snapshot(fixture.ServiceB, "wrong") };
        var coordinator = new OperatorCatalogCoordinator(fixture.Store, client);
        await coordinator.SetActiveServiceAsync(fixture.ServiceA, CancellationToken.None);

        await Assert.ThrowsAsync<InvalidDataException>(() => coordinator.RefreshAsync(CancellationToken.None));

        Assert.Null(await fixture.Store.ReadAsync(CancellationToken.None));
    }

    private sealed class SyncFixture : IDisposable
    {
        public string Directory { get; } = Path.Combine(Path.GetTempPath(), "ipresenterplux-sync-tests", Guid.NewGuid().ToString("N"));
        public Guid ServiceA { get; } = Guid.NewGuid();
        public Guid ServiceB { get; } = Guid.NewGuid();
        public OperatorCatalogStore Store { get; }

        public SyncFixture()
        {
            System.IO.Directory.CreateDirectory(Directory);
            Store = new OperatorCatalogStore(Directory);
        }

        public OperatorCatalogSnapshot Snapshot(Guid serviceId, string revision) => new(
            OperatorCatalogSnapshot.CurrentSchemaVersion,
            DateTimeOffset.Parse("2026-10-06T10:01:00Z"),
            DateTimeOffset.Parse("2026-10-06T10:00:59Z"),
            revision,
            new OperatorCatalogService(serviceId, "Service", "live", "KJV", null, null),
            [new OperatorBibleVersion("KJV", "King James Version", "KJV", "en")],
            [],
            []);

        public void Dispose()
        {
            if (System.IO.Directory.Exists(Directory)) System.IO.Directory.Delete(Directory, recursive: true);
        }
    }

    private sealed class FakeCatalogClient : IOperatorCatalogClient
    {
        public OperatorCatalogSnapshot? Catalog { get; set; }
        public Exception? Error { get; set; }
        public Func<Task>? BeforeCatalogFetch { get; set; }

        public async Task<OperatorCatalogSnapshot> GetCatalogAsync(CancellationToken cancellationToken)
        {
            if (BeforeCatalogFetch is not null) await BeforeCatalogFetch();
            if (Error is not null) throw Error;
            return Catalog ?? throw new InvalidOperationException("No catalog fixture configured.");
        }

        public Task<OperatorResolvedScripture> ResolveScriptureAsync(string reference, string? version, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }
}
