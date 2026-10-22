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
