using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.State;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class LocalOperatorCatalogClientTests
{
    [Fact]
    public async Task ClientQueriesCatalogAndResolvesScriptureAcrossPlatformIpc()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenterplux-desktop-catalog-ipc", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var serviceId = Guid.NewGuid();
            var store = new OperatorCatalogStore(directory);
            var fake = new FakeCatalogClient(serviceId);
            var coordinator = new OperatorCatalogCoordinator(store, fake);
            await coordinator.SetActiveServiceAsync(serviceId, CancellationToken.None);
            await store.WriteAsync(Snapshot(serviceId), CancellationToken.None);

            var state = new AgentRuntimeState();
            state.Update(snapshot => snapshot with { ActiveServiceId = serviceId, ConnectionStatus = "Connected", ServiceMode = "live" });
            await using var output = new LocalWebProgramOutputService(49502);
            var handler = new LocalOperatorCommandHandler(state, output, operatorCatalog: coordinator);
            await using var server = new LocalOperatorIpcServer(directory, handler);
            await server.StartAsync(CancellationToken.None);
            var client = new LocalOperatorClient(directory, TimeSpan.FromSeconds(5));

            var catalog = await client.QueryCatalogAsync(CancellationToken.None);
            Assert.True(catalog.Ok);
            Assert.Equal("rev-ipc", catalog.Catalog?.CatalogRevision);

            var scripture = await client.ResolveScriptureAsync("John 3:16", "KJV", CancellationToken.None);
            Assert.True(scripture.Ok);
            Assert.Equal("resolved-ipc", scripture.ResolvedPresentation?.ItemId);
            Assert.Equal("John 3:16", scripture.ResolvedPresentation?.Title);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    private static OperatorCatalogSnapshot Snapshot(Guid serviceId)
    {
        var now = DateTimeOffset.UtcNow;
        return new OperatorCatalogSnapshot(
            OperatorCatalogSnapshot.CurrentSchemaVersion,
            now,
            now,
            "rev-ipc",
            new OperatorCatalogService(serviceId, "Sunday Service", "live", "KJV", null, null),
            [new OperatorBibleVersion("KJV", "King James Version", "KJV", "en")],
            [],
            []);
    }

    private sealed class FakeCatalogClient(Guid serviceId) : IOperatorCatalogClient
    {
        public Task<OperatorCatalogSnapshot> GetCatalogAsync(CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<OperatorResolvedScripture> ResolveScriptureAsync(string reference, string? version, CancellationToken cancellationToken) =>
            Task.FromResult(new OperatorResolvedScripture(
                serviceId,
                new OperatorCatalogItem(
                    "resolved-ipc", "scripture", "John 3:16", "For God so loved the world...", "KJV",
                    new Dictionary<string, string> { ["book"] = "John", ["chapter"] = "3", ["verses"] = "16", ["bibleVersion"] = "KJV" }),
                DateTimeOffset.UtcNow));
    }
}
