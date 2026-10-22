using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class MediaPreparationCoordinatorTests
{
    [Fact]
    public async Task MediaPreparationPublishesQueuedDownloadingValidatingReadyInOrder()
    {
        using var fixture = new Fixture();
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        var states = new List<MediaPreparationState>();
        fixture.Coordinator.StatusChanged += (_, snapshot) => states.Add(snapshot.State);
        fixture.Cache.EnqueueReady();

        var result = await fixture.Coordinator.PrepareAsync(fixture.MediaItem(), CancellationToken.None);

        Assert.Equal(MediaPreparationState.Ready, result.State);
        Assert.NotNull(result.Asset);
        Assert.Equal(
            [MediaPreparationState.Queued, MediaPreparationState.Downloading, MediaPreparationState.Validating, MediaPreparationState.Ready],
            states);
        Assert.Equal(1, fixture.Cache.PrepareCalls);
    }

    [Fact]
    public async Task TransientFailureRetriesButPermanentUnsupportedDoesNotAutoRetry()
    {
        using var fixture = new Fixture();
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        fixture.Cache.EnqueueFailure("media_download_failed");
        fixture.Cache.EnqueueReady();

        var failed = await fixture.Coordinator.PrepareAsync(fixture.MediaItem("media-transient"), CancellationToken.None);
        var retried = await fixture.Coordinator.PrepareAsync(fixture.MediaItem("media-transient"), CancellationToken.None);

        Assert.Equal(MediaPreparationState.Failed, failed.State);
        Assert.Equal("media_download_failed", failed.ErrorCode);
        Assert.Equal(MediaPreparationState.Ready, retried.State);
        Assert.Equal(2, fixture.Cache.PrepareCalls);

        fixture.Cache.EnqueueFailure("media_type_invalid");
        var unsupported = await fixture.Coordinator.PrepareAsync(fixture.MediaItem("media-unsupported"), CancellationToken.None);
        var repeated = await fixture.Coordinator.PrepareAsync(fixture.MediaItem("media-unsupported"), CancellationToken.None);

        Assert.Equal(MediaPreparationState.Unsupported, unsupported.State);
        Assert.Equal("media_type_invalid", unsupported.ErrorCode);
        Assert.Equal(MediaPreparationState.Unsupported, repeated.State);
        Assert.Equal(3, fixture.Cache.PrepareCalls);
    }

    [Fact]
    public async Task NonMediaIsNotRequiredAndWrongServiceIsRejectedBeforeCache()
    {
        using var fixture = new Fixture();
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);

        var slide = await fixture.Coordinator.PrepareAsync(
            new PresentationRenderItem("slide-1", fixture.ServiceId, "slide", "Welcome", "Hello", null, new Dictionary<string,string>()),
            CancellationToken.None);
        var wrongService = await fixture.Coordinator.PrepareAsync(
            fixture.MediaItem("media-wrong", Guid.NewGuid()), CancellationToken.None);

        Assert.Equal(MediaPreparationState.NotRequired, slide.State);
        Assert.Equal(MediaPreparationState.Failed, wrongService.State);
        Assert.Equal("media_scope_mismatch", wrongService.ErrorCode);
        Assert.Equal(0, fixture.Cache.PrepareCalls);
    }

    [Fact]
    public async Task PrefetchAndOperatorPrepareShareOneItemPreparationJob()
    {
        using var fixture = new Fixture();
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        var itemId = Guid.NewGuid().ToString("D");
        var render = fixture.MediaItem(itemId);
        fixture.Provider.Result = render;
        fixture.Catalog.BindPresentationProvider(fixture.Provider);
        fixture.Cache.EnqueueBlockedReady();
        var catalogItems = new[]
        {
            new OperatorCatalogItem(itemId, "media", "Worship Video", "", null, new Dictionary<string,string>())
        };

        var prefetch = fixture.Coordinator.PrefetchAsync(fixture.ServiceId, catalogItems, CancellationToken.None);
        await fixture.Cache.Started.Task.WaitAsync(TimeSpan.FromSeconds(2));
        var selected = fixture.Coordinator.PrepareAsync(render, CancellationToken.None);
        fixture.Cache.ReleaseBlocked();
        await prefetch;
        var ready = await selected;

        Assert.Equal(MediaPreparationState.Ready, ready.State);
        Assert.Equal(1, fixture.Provider.Calls);
        Assert.Equal(1, fixture.Cache.PrepareCalls);
    }

    [Fact]
    public async Task ServiceSwitchCancelsOldPrefetchAndKeepsValidatedCacheEntryInactive()
    {
        using var fixture = new Fixture();
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        var readyItem = fixture.MediaItem("ready-before-switch");
        fixture.Cache.EnqueueReady();
        var ready = await fixture.Coordinator.PrepareAsync(readyItem, CancellationToken.None);
        Assert.Equal(MediaPreparationState.Ready, ready.State);
        var cacheKey = Assert.IsType<PreparedMediaAsset>(ready.Asset).CacheKey;

        var blockedId = Guid.NewGuid().ToString("D");
        fixture.Provider.Result = fixture.MediaItem(blockedId);
        fixture.Catalog.BindPresentationProvider(fixture.Provider);
        fixture.Cache.EnqueueBlockedReady();
        var prefetch = fixture.Coordinator.PrefetchAsync(
            fixture.ServiceId,
            [new OperatorCatalogItem(blockedId, "media", "Later", "", null, new Dictionary<string,string>())],
            CancellationToken.None);
        await fixture.Cache.Started.Task.WaitAsync(TimeSpan.FromSeconds(2));

        await fixture.Coordinator.SetActiveServiceAsync(Guid.NewGuid(), CancellationToken.None);
        await prefetch;

        Assert.True(fixture.Cache.BlockedCancellationObserved);
        Assert.Null(fixture.Coordinator.TryGet(readyItem.ItemId));
        Assert.True(fixture.Cache.TryGetReady(cacheKey, out _));
    }

    [Fact]
    public async Task AcquireReadyLeaseDelegatesOnlyForReadyItem()
    {
        using var fixture = new Fixture();
        await fixture.Coordinator.SetActiveServiceAsync(fixture.ServiceId, CancellationToken.None);
        fixture.Cache.EnqueueReady();
        var item = fixture.MediaItem("lease-ready");
        await fixture.Coordinator.PrepareAsync(item, CancellationToken.None);

        using var lease = fixture.Coordinator.AcquireReadyLease(item.ItemId);
        Assert.Equal(1, fixture.Cache.ActiveLeases);
        lease.Dispose();
        Assert.Equal(0, fixture.Cache.ActiveLeases);

        Assert.Throws<MediaAssetCacheException>(() => fixture.Coordinator.AcquireReadyLease("missing"));
    }

    private sealed class Fixture : IDisposable
    {
        public Guid ServiceId { get; } = Guid.NewGuid();
        public Guid OrganizationId { get; } = Guid.NewGuid();
        public string Directory { get; } = Path.Combine(Path.GetTempPath(), "ipresenter-preparation-tests", Guid.NewGuid().ToString("N"));
        public FakeCache Cache { get; } = new();
        public FakePresentationProvider Provider { get; } = new();
        public OperatorCatalogCoordinator Catalog { get; }
        public MediaPreparationCoordinator Coordinator { get; }

        public Fixture()
        {
            System.IO.Directory.CreateDirectory(Directory);
            Catalog = new OperatorCatalogCoordinator(new OperatorCatalogStore(Directory));
            Coordinator = new MediaPreparationCoordinator(Cache, Catalog);
            Coordinator.BindOrganization(OrganizationId);
        }

        public PresentationRenderItem MediaItem(string? itemId = null, Guid? serviceId = null)
        {
            var id = itemId ?? Guid.NewGuid().ToString("D");
            var descriptor = new PresentationMediaDescriptor(
                Guid.NewGuid(), "video", new Uri("https://cdn.example.test/worship.mp4"),
                "asset-v1", "video/mp4", "Worship Video", 0, null, false, 1, "contain").Validate();
            return new PresentationRenderItem(id, serviceId ?? ServiceId, "media", "Worship Video", "", null,
                new Dictionary<string,string>(), descriptor);
        }

        public void Dispose()
        {
            if (System.IO.Directory.Exists(Directory)) System.IO.Directory.Delete(Directory, true);
        }
    }

    private sealed class FakePresentationProvider : IPresentationContentProvider
    {
        public PresentationRenderItem? Result { get; set; }
        public int Calls { get; private set; }
        public Task<PresentationRenderItem> GetAsync(string itemId, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(Result ?? throw new InvalidOperationException("No media item configured."));
        }
    }

    private sealed class FakeCache : IMediaAssetCache
    {
        private readonly Queue<Func<PresentationMediaDescriptor, CancellationToken, Task<MediaAssetCacheEntry>>> _outcomes = new();
        private readonly Dictionary<string, MediaAssetCacheEntry> _ready = new(StringComparer.Ordinal);
        private TaskCompletionSource _release = NewSignal();
        public TaskCompletionSource Started { get; private set; } = NewSignal();
        public int PrepareCalls { get; private set; }
        public int ActiveLeases { get; private set; }
        public bool BlockedCancellationObserved { get; private set; }

        public void EnqueueReady() => _outcomes.Enqueue((descriptor, cancellationToken) =>
            Task.FromResult(Ready(descriptor)));

        public void EnqueueFailure(string code) => _outcomes.Enqueue((descriptor, cancellationToken) =>
            Task.FromException<MediaAssetCacheEntry>(new MediaAssetCacheException(code, code)));

        public void EnqueueBlockedReady()
        {
            Started = NewSignal();
            _release = NewSignal();
            _outcomes.Enqueue(async (descriptor, cancellationToken) =>
            {
                Started.TrySetResult();
                try { await _release.Task.WaitAsync(cancellationToken); }
                catch (OperationCanceledException) { BlockedCancellationObserved = true; throw; }
                return Ready(descriptor);
            });
        }

        public void ReleaseBlocked() => _release.TrySetResult();

        public async Task<MediaAssetCacheEntry> PrepareAsync(Guid organizationId, PresentationMediaDescriptor descriptor, CancellationToken cancellationToken)
        {
            PrepareCalls++;
            if (_outcomes.Count == 0) throw new InvalidOperationException("No cache outcome configured.");
            var entry = await _outcomes.Dequeue()(descriptor, cancellationToken);
            _ready[entry.CacheKey] = entry;
            return entry;
        }

        public bool TryGetReady(string cacheKey, out MediaAssetCacheEntry entry) => _ready.TryGetValue(cacheKey, out entry!);

        public IDisposable AcquireLease(string cacheKey)
        {
            if (!_ready.ContainsKey(cacheKey)) throw new MediaAssetCacheException("media_not_ready", "not ready");
            ActiveLeases++;
            return new Lease(this);
        }

        private MediaAssetCacheEntry Ready(PresentationMediaDescriptor descriptor)
        {
            var key = $"cache-{descriptor.SourceId:N}-{descriptor.AssetVersion}";
            return new MediaAssetCacheEntry(key, $"/cache/{key}.media", descriptor.ContentTypeHint ?? "video/mp4",
                descriptor.MediaKind, new string('a', 64), 1024, DateTimeOffset.UtcNow);
        }

        private sealed class Lease(FakeCache owner) : IDisposable
        {
            private FakeCache? _owner = owner;
            public void Dispose()
            {
                var current = Interlocked.Exchange(ref _owner, null);
                if (current is not null) current.ActiveLeases--;
            }
        }

        private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    }
}
