using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.State;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class LocalOperatorCatalogCommandTests
{
    [Fact]
    public async Task CatalogQueryReturnsCachedSnapshotAndStaleState()
    {
        using var fixture = new Fixture();
        var syncedAt = DateTimeOffset.Parse("2026-10-06T10:00:00Z");
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        await fixture.Store.WriteAsync(fixture.Snapshot(syncedAt), CancellationToken.None);
        var state = State(fixture.ServiceId);
        await using var output = new LocalWebProgramOutputService(49405);
        var clock = new FixedTimeProvider(syncedAt.AddMinutes(6));
        var handler = new LocalOperatorCommandHandler(
            state,
            output,
            clock: clock,
            operatorCatalog: fixture.Coordinator,
            catalogMaxAge: TimeSpan.FromMinutes(5));

        var response = await handler.HandleAsync(Request(LocalOperatorCommands.CatalogQuery), CancellationToken.None);

        Assert.True(response.Ok);
        Assert.Equal("catalog_ready", response.State);
        Assert.Equal("rev-catalog", response.Catalog?.CatalogRevision);
        Assert.True(response.CatalogStale);
        Assert.Null(response.ResolvedPresentation);
    }

    [Fact]
    public async Task ScriptureResolveUsesAuthoritativeCoordinatorWithoutDesktopServiceScope()
    {
        using var fixture = new Fixture();
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        fixture.Client.Resolved = new OperatorResolvedScripture(
            fixture.ServiceId,
            fixture.Scripture("john-online"),
            DateTimeOffset.Parse("2026-10-06T10:05:00Z"));
        var state = State(fixture.ServiceId);
        await using var output = new LocalWebProgramOutputService(49406);
        var handler = new LocalOperatorCommandHandler(state, output, operatorCatalog: fixture.Coordinator);
        var request = new LocalOperatorRequest(
            Guid.NewGuid().ToString("D"),
            LocalOperatorCommands.ScriptureResolve,
            Scripture: new LocalOperatorScriptureQuery("John 3:16", "KJV"));

        var json = JsonSerializer.Serialize(request);
        Assert.DoesNotContain("serviceId", json, StringComparison.OrdinalIgnoreCase);
        var response = await handler.HandleAsync(request, CancellationToken.None);

        Assert.True(response.Ok);
        Assert.Equal("scripture_ready", response.State);
        Assert.Equal("john-online", response.ResolvedPresentation?.ItemId);
        Assert.Equal("John 3:16", response.ResolvedPresentation?.Title);
    }

    [Fact]
    public async Task OfflineResolverUsesExactCachedPassageAndRejectsUnknownReference()
    {
        using var fixture = new Fixture();
        fixture.Client.Error = new HttpRequestException("offline");
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        await fixture.Store.WriteAsync(fixture.Snapshot(
            DateTimeOffset.Parse("2026-10-06T10:00:00Z"),
            scripture: [fixture.Scripture("john-cached")]), CancellationToken.None);
        var state = State(fixture.ServiceId);
        await using var output = new LocalWebProgramOutputService(49407);
        var handler = new LocalOperatorCommandHandler(state, output, operatorCatalog: fixture.Coordinator);

        var cached = await handler.HandleAsync(Request(
            LocalOperatorCommands.ScriptureResolve,
            new LocalOperatorScriptureQuery("John 3:16", "KJV")), CancellationToken.None);
        Assert.True(cached.Ok);
        Assert.Equal("john-cached", cached.ResolvedPresentation?.ItemId);

        var missing = await handler.HandleAsync(Request(
            LocalOperatorCommands.ScriptureResolve,
            new LocalOperatorScriptureQuery("Romans 8:28", "KJV")), CancellationToken.None);
        Assert.False(missing.Ok);
        Assert.Equal("scripture_unavailable_offline", missing.ErrorCode);
    }

    [Fact]
    public async Task CatalogQueryRejectsCacheFromDifferentRuntimeService()
    {
        using var fixture = new Fixture();
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        await fixture.Store.WriteAsync(fixture.Snapshot(DateTimeOffset.UtcNow), CancellationToken.None);
        var state = State(Guid.NewGuid());
        await using var output = new LocalWebProgramOutputService(49408);
        var handler = new LocalOperatorCommandHandler(state, output, operatorCatalog: fixture.Coordinator);

        var response = await handler.HandleAsync(Request(LocalOperatorCommands.CatalogQuery), CancellationToken.None);

        Assert.False(response.Ok);
        Assert.Equal("catalog_scope_mismatch", response.ErrorCode);
        Assert.Null(response.Catalog);
    }

    [Fact]
    public async Task PrepareItemHydratesTrustedMediaAfterCatalogScopeCheck()
    {
        using var fixture = new Fixture();
        var itemId = Guid.NewGuid().ToString("D");
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        await fixture.Store.WriteAsync(fixture.Snapshot(
            DateTimeOffset.UtcNow,
            items: [fixture.MediaCatalogItem(itemId)]), CancellationToken.None);
        fixture.PresentationProvider.Result = fixture.MediaPresentation(itemId, fixture.ServiceId);
        fixture.Coordinator.BindPresentationProvider(fixture.PresentationProvider);
        var preparation = new FakePreparationCoordinator(MediaPreparationState.Ready);
        var state = State(fixture.ServiceId);
        await using var output = new LocalWebProgramOutputService(49410);
        var handler = new LocalOperatorCommandHandler(
            state, output, operatorCatalog: fixture.Coordinator, mediaPreparation: preparation);
        var request = new LocalOperatorRequest(
            Guid.NewGuid().ToString("D"),
            LocalOperatorCommands.PreviewPrepareItem,
            Item: new LocalOperatorItemRequest(itemId));

        var response = await handler.HandleAsync(request, CancellationToken.None);

        Assert.True(response.Ok);
        Assert.Equal("preview_ready", response.State);
        Assert.Equal(itemId, response.Snapshot.Preview?.ItemId);
        Assert.Equal(1, fixture.PresentationProvider.Calls);
        Assert.Equal(1, preparation.PrepareCalls);
    }

    [Fact]
    public async Task PrepareItemRejectsHydratedPresentationFromAnotherService()
    {
        using var fixture = new Fixture();
        var itemId = Guid.NewGuid().ToString("D");
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        await fixture.Store.WriteAsync(fixture.Snapshot(
            DateTimeOffset.UtcNow,
            items: [fixture.MediaCatalogItem(itemId)]), CancellationToken.None);
        fixture.PresentationProvider.Result = fixture.MediaPresentation(itemId, Guid.NewGuid());
        fixture.Coordinator.BindPresentationProvider(fixture.PresentationProvider);
        var preparation = new FakePreparationCoordinator(MediaPreparationState.Ready);
        var state = State(fixture.ServiceId);
        await using var output = new LocalWebProgramOutputService(49411);
        var handler = new LocalOperatorCommandHandler(
            state, output, operatorCatalog: fixture.Coordinator, mediaPreparation: preparation);

        var response = await handler.HandleAsync(new LocalOperatorRequest(
            Guid.NewGuid().ToString("D"),
            LocalOperatorCommands.PreviewPrepareItem,
            Item: new LocalOperatorItemRequest(itemId)), CancellationToken.None);

        Assert.False(response.Ok);
        Assert.Equal("catalog_scope_mismatch", response.ErrorCode);
        Assert.Equal(0, preparation.PrepareCalls);
        Assert.Null(response.Snapshot.Preview);
    }

    [Fact]
    public async Task ScriptureQueryBoundsFailBeforeCoordinatorInvocation()
    {
        using var fixture = new Fixture();
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        var state = State(fixture.ServiceId);
        await using var output = new LocalWebProgramOutputService(49409);
        var handler = new LocalOperatorCommandHandler(state, output, operatorCatalog: fixture.Coordinator);

        var longReference = await handler.HandleAsync(Request(
            LocalOperatorCommands.ScriptureResolve,
            new LocalOperatorScriptureQuery(new string('x', 121), "KJV")), CancellationToken.None);
        Assert.Equal("scripture_reference_invalid", longReference.ErrorCode);

        var longVersion = await handler.HandleAsync(Request(
            LocalOperatorCommands.ScriptureResolve,
            new LocalOperatorScriptureQuery("John 3:16", new string('V', 33))), CancellationToken.None);
        Assert.Equal("bible_version_invalid", longVersion.ErrorCode);
        Assert.Equal(0, fixture.Client.ResolveCalls);
    }

    private static AgentRuntimeState State(Guid serviceId)
    {
        var state = new AgentRuntimeState();
        state.Update(snapshot => snapshot with { ActiveServiceId = serviceId, ConnectionStatus = "Connected", ServiceMode = "live" });
        return state;
    }

    private static LocalOperatorRequest Request(string command, LocalOperatorScriptureQuery? scripture = null) =>
        new(Guid.NewGuid().ToString("D"), command, Scripture: scripture);

    private sealed class Fixture : IDisposable
    {
        public string Directory { get; } = Path.Combine(Path.GetTempPath(), "ipresenterplux-local-catalog-tests", Guid.NewGuid().ToString("N"));
        public Guid ServiceId { get; } = Guid.NewGuid();
        public OperatorCatalogStore Store { get; }
        public FakeCatalogClient Client { get; } = new();
        public OperatorCatalogCoordinator Coordinator { get; }

        public Fixture()
        {
            System.IO.Directory.CreateDirectory(Directory);
            Store = new OperatorCatalogStore(Directory);
            Coordinator = new OperatorCatalogCoordinator(Store, Client);
        }

        public OperatorCatalogSnapshot Snapshot(
            DateTimeOffset syncedAt,
            IReadOnlyList<OperatorCatalogItem>? scripture = null,
            IReadOnlyList<OperatorCatalogItem>? items = null) => new(
            OperatorCatalogSnapshot.CurrentSchemaVersion,
            syncedAt,
            syncedAt,
            "rev-catalog",
            new OperatorCatalogService(ServiceId, "Sunday Service", "live", "KJV", null, null),
            [new OperatorBibleVersion("KJV", "King James Version", "KJV", "en")],
            items ?? [],
            scripture ?? []);

        public OperatorCatalogItem Scripture(string id) => new(
            id, "scripture", "John 3:16", "For God so loved the world...", "KJV",
            new Dictionary<string, string> { ["book"] = "John", ["chapter"] = "3", ["verses"] = "16", ["bibleVersion"] = "KJV" });

        public OperatorCatalogItem MediaCatalogItem(string id) => new(
            id, "media", "Worship Video", "", null, new Dictionary<string, string>());

        public PresentationRenderItem MediaPresentation(string id, Guid serviceId)
        {
            var descriptor = new PresentationMediaDescriptor(
                Guid.NewGuid(), "video", new Uri("https://media.example.test/worship.mp4"),
                new string('a', 64), "video/mp4", "Worship Video", 0, null, false, 1, "contain").Validate();
            return new PresentationRenderItem(id, serviceId, "media", "Worship Video", "", null,
                new Dictionary<string, string>(), descriptor);
        }

        public FakePresentationProvider PresentationProvider { get; } = new();

        public void Dispose()
        {
            if (System.IO.Directory.Exists(Directory)) System.IO.Directory.Delete(Directory, recursive: true);
        }
    }

    private sealed class FakeCatalogClient : IOperatorCatalogClient
    {
        public OperatorResolvedScripture? Resolved { get; set; }
        public Exception? Error { get; set; }
        public int ResolveCalls { get; private set; }

        public Task<OperatorCatalogSnapshot> GetCatalogAsync(CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<OperatorResolvedScripture> ResolveScriptureAsync(string reference, string? version, CancellationToken cancellationToken)
        {
            ResolveCalls++;
            if (Error is not null) throw Error;
            return Task.FromResult(Resolved ?? throw new InvalidOperationException("No resolved scripture fixture configured."));
        }
    }

    private sealed class FakePresentationProvider : IPresentationContentProvider
    {
        public PresentationRenderItem? Result { get; set; }
        public int Calls { get; private set; }
        public Task<PresentationRenderItem> GetAsync(string itemId, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(Result ?? throw new InvalidOperationException("No presentation fixture configured."));
        }
    }

    private sealed class FakePreparationCoordinator(MediaPreparationState state) : IMediaPreparationCoordinator
    {
        public event EventHandler<MediaPreparationSnapshot>? StatusChanged;
        public int PrepareCalls { get; private set; }
        public Task<MediaPreparationSnapshot> PrepareAsync(PresentationRenderItem item, CancellationToken cancellationToken)
        {
            PrepareCalls++;
            return Task.FromResult(new MediaPreparationSnapshot(item.ItemId, item.ServiceId, state, null,
                state == MediaPreparationState.Failed ? "media_download_failed" : null));
        }
        public MediaPreparationSnapshot? TryGet(string itemId) => null;
        public Task PrefetchAsync(Guid serviceId, IReadOnlyList<OperatorCatalogItem> items, CancellationToken cancellationToken) => Task.CompletedTask;
        public IDisposable AcquireReadyLease(string itemId) => new Lease();
        public Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken) => Task.CompletedTask;
        private sealed class Lease : IDisposable { public void Dispose() { } }
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
