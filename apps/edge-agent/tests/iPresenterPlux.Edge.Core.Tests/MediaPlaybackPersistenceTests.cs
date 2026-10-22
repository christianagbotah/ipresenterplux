using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class MediaPlaybackPersistenceTests
{
    [Fact]
    public async Task DynamicProgramRestoresAsRecoveryRequiredWithoutAdvancing()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenter-playback-recovery", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var serviceId = Guid.NewGuid();
            var itemId = Guid.NewGuid().ToString("D");
            var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T12:00:00Z"));
            var descriptor = new PresentationMediaDescriptor(
                Guid.NewGuid(), "video", new Uri("https://cdn.example.test/video.mp4"), "v1",
                "video/mp4", "Video", 2, 10, false, 1, "contain").Validate();
            var asset = new PreparedMediaAsset(itemId, serviceId, new string('a', 64), "/tmp/video.mp4",
                "video/mp4", "video", TimeSpan.FromSeconds(12), descriptor);
            var preparation = new ReadyPreparation(asset);
            var firstPlayback = new MediaPlaybackCoordinator(clock);
            await firstPlayback.SetActiveServiceAsync(serviceId, CancellationToken.None);
            var item = new PresentationRenderItem(itemId, serviceId, "media", "Video", "", null,
                new Dictionary<string,string>(), descriptor);

            await using (var first = new LocalWebProgramOutputService(
                49520, new FileProgramStateStore(directory), mediaPreparation: preparation, mediaPlayback: firstPlayback))
            {
                await first.SetPreviewAsync(item, CancellationToken.None);
                await first.TakePreviewToProgramAsync(CancellationToken.None);
                clock.Advance(TimeSpan.FromSeconds(1.75));
            }

            var restoredPlayback = new MediaPlaybackCoordinator(clock);
            await restoredPlayback.SetActiveServiceAsync(serviceId, CancellationToken.None);
            await using var restored = new LocalWebProgramOutputService(
                49521, new FileProgramStateStore(directory), mediaPreparation: preparation, mediaPlayback: restoredPlayback);
            await restored.RestoreAsync(CancellationToken.None);

            Assert.Equal(itemId, restored.Snapshot.Program?.ItemId);
            var recovery = restoredPlayback.Snapshot!;
            Assert.Equal("recovery_required", recovery.State);
            Assert.Equal(3.75, recovery.EffectivePositionSeconds, 3);
            clock.Advance(TimeSpan.FromSeconds(20));
            Assert.Equal(3.75, restoredPlayback.Snapshot!.EffectivePositionSeconds, 3);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task RecoveryWaitsForMatchingServiceConfirmation()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenter-playback-pending-recovery", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var serviceId = Guid.NewGuid();
            var itemId = Guid.NewGuid().ToString("D");
            var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T12:00:00Z"));
            var descriptor = new PresentationMediaDescriptor(
                Guid.NewGuid(), "video", new Uri("https://cdn.example.test/video.mp4"), "v1",
                "video/mp4", "Video", 2, 10, false, 1, "contain").Validate();
            var asset = new PreparedMediaAsset(itemId, serviceId, new string('c', 64), "/tmp/video.mp4",
                "video/mp4", "video", TimeSpan.FromSeconds(12), descriptor);
            var preparation = new ReadyPreparation(asset);
            var firstPlayback = new MediaPlaybackCoordinator(clock);
            await firstPlayback.SetActiveServiceAsync(serviceId, CancellationToken.None);
            var item = new PresentationRenderItem(itemId, serviceId, "media", "Video", "", null,
                new Dictionary<string,string>(), descriptor);

            await using (var first = new LocalWebProgramOutputService(
                49522, new FileProgramStateStore(directory), mediaPreparation: preparation, mediaPlayback: firstPlayback))
            {
                await first.SetPreviewAsync(item, CancellationToken.None);
                await first.TakePreviewToProgramAsync(CancellationToken.None);
                clock.Advance(TimeSpan.FromSeconds(2.5));
            }

            var restartedPlayback = new MediaPlaybackCoordinator(clock);
            await using var restored = new LocalWebProgramOutputService(
                49523, new FileProgramStateStore(directory), mediaPreparation: preparation, mediaPlayback: restartedPlayback);
            await restored.RestoreAsync(CancellationToken.None);

            Assert.Null(restartedPlayback.Snapshot);
            await restored.SetActiveServiceAsync(serviceId, CancellationToken.None);
            var recovery = Assert.IsType<MediaPlaybackSnapshot>(restartedPlayback.Snapshot);
            Assert.Equal("recovery_required", recovery.State);
            Assert.Equal(4.5, recovery.EffectivePositionSeconds, 3);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task TakeCannotClaimAuthorityForAStalePreviewService()
    {
        var activeService = Guid.NewGuid();
        var staleService = Guid.NewGuid();
        var itemId = Guid.NewGuid().ToString("D");
        var descriptor = new PresentationMediaDescriptor(
            Guid.NewGuid(), "video", new Uri("https://cdn.example.test/stale.mp4"), "v1",
            "video/mp4", "Stale Video", 0, 10, false, 1, "contain").Validate();
        var asset = new PreparedMediaAsset(itemId, staleService, new string('d', 64), "/tmp/stale.mp4",
            "video/mp4", "video", TimeSpan.FromSeconds(10), descriptor);
        var preparation = new ReadyPreparation(asset);
        var playback = new MediaPlaybackCoordinator();
        await playback.SetActiveServiceAsync(activeService, CancellationToken.None);
        await using var output = new LocalWebProgramOutputService(
            49524, mediaPreparation: preparation, mediaPlayback: playback);
        await output.SetPreviewAsync(new PresentationRenderItem(
            itemId, staleService, "media", "Stale Video", "", null, new Dictionary<string,string>(), descriptor),
            CancellationToken.None);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            output.TakePreviewToProgramAsync(CancellationToken.None));

        Assert.Null(output.Snapshot.Program);
        Assert.Null(playback.Snapshot);
    }

    private sealed class ReadyPreparation(PreparedMediaAsset asset) : IMediaPreparationCoordinator
    {
        private readonly MediaPreparationSnapshot _snapshot = new(asset.ItemId, asset.ServiceId, MediaPreparationState.Ready, asset, null);
        public event EventHandler<MediaPreparationSnapshot>? StatusChanged { add { } remove { } }
        public Task<MediaPreparationSnapshot> PrepareAsync(PresentationRenderItem item, CancellationToken cancellationToken) => Task.FromResult(_snapshot);
        public MediaPreparationSnapshot? TryGet(string itemId) => itemId == asset.ItemId ? _snapshot : null;
        public Task PrefetchAsync(Guid serviceId, IReadOnlyList<OperatorCatalogItem> items, CancellationToken cancellationToken) => Task.CompletedTask;
        public IDisposable AcquireReadyLease(string itemId) => new Lease();
        public Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken) => Task.CompletedTask;
        private sealed class Lease : IDisposable { public void Dispose() { } }
    }

    private sealed class ManualTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan delta) => _now += delta;
    }
}