using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class MediaPlaybackAuthorityTests
{
    [Fact]
    public async Task RecoveryWaitsForMatchingServiceConfirmation()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenter-playback-authority", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var serviceId = Guid.NewGuid();
            var itemId = Guid.NewGuid().ToString("D");
            var descriptor = Descriptor("video", trimStart: 2, trimEnd: 10);
            var program = new PresentationRenderItem(
                itemId, serviceId, "media", "Video", "", null, new Dictionary<string, string>(), descriptor);
            var persistedPlayback = new MediaPlaybackSnapshot(
                itemId, serviceId, new string('c', 64), "video", "playing",
                DateTimeOffset.Parse("2026-10-22T12:00:00Z"), null,
                2, 4.5, 2, 10, false, 1, "contain", 3, null);
            var store = new FileProgramStateStore(directory);
            await store.SaveAsync(new PersistedProgramState(1, program, program, persistedPlayback), CancellationToken.None);

            var playback = new MediaPlaybackCoordinator();
            await using var output = new LocalWebProgramOutputService(49523, store, mediaPlayback: playback);
            await output.RestoreAsync(CancellationToken.None);

            Assert.Null(playback.Snapshot);
            await output.SetActiveServiceAsync(serviceId, CancellationToken.None);
            var recovery = Assert.IsType<MediaPlaybackSnapshot>(playback.Snapshot);
            Assert.Equal("recovery_required", recovery.State);
            Assert.Equal(4.5, recovery.EffectivePositionSeconds, 3);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }

    [Fact]
    public async Task TakeCannotClaimAuthorityForAStalePreviewService()
    {
        var activeService = Guid.NewGuid();
        var staleService = Guid.NewGuid();
        var itemId = Guid.NewGuid().ToString("D");
        var descriptor = Descriptor("video", trimStart: 0, trimEnd: 10);
        var asset = new PreparedMediaAsset(
            itemId, staleService, new string('d', 64), "/tmp/stale.mp4",
            "video/mp4", "video", TimeSpan.FromSeconds(10), descriptor);
        var preparation = new ReadyPreparation(asset);
        var playback = new MediaPlaybackCoordinator();
        await playback.SetActiveServiceAsync(activeService, CancellationToken.None);
        await using var output = new LocalWebProgramOutputService(
            49524, mediaPreparation: preparation, mediaPlayback: playback);
        await output.SetPreviewAsync(new PresentationRenderItem(
            itemId, staleService, "media", "Stale Video", "", null,
            new Dictionary<string, string>(), descriptor), CancellationToken.None);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            output.TakePreviewToProgramAsync(CancellationToken.None));

        Assert.Null(output.Snapshot.Program);
        Assert.Null(playback.Snapshot);
    }

    private static PresentationMediaDescriptor Descriptor(string kind, double trimStart, double? trimEnd) =>
        new(
            Guid.NewGuid(), kind, new Uri($"https://cdn.example.test/{kind}.bin"), "v1",
            kind == "video" ? "video/mp4" : "audio/mpeg", "Media",
            trimStart, trimEnd, false, 1, "contain").Validate();

    private sealed class ReadyPreparation(PreparedMediaAsset asset) : IMediaPreparationCoordinator
    {
        private readonly MediaPreparationSnapshot _snapshot = new(
            asset.ItemId, asset.ServiceId, MediaPreparationState.Ready, asset, null);
        public event EventHandler<MediaPreparationSnapshot>? StatusChanged { add { } remove { } }
        public Task<MediaPreparationSnapshot> PrepareAsync(PresentationRenderItem item, CancellationToken cancellationToken) =>
            Task.FromResult(_snapshot);
        public MediaPreparationSnapshot? TryGet(string itemId) =>
            string.Equals(itemId, asset.ItemId, StringComparison.Ordinal) ? _snapshot : null;
        public Task PrefetchAsync(Guid serviceId, IReadOnlyList<OperatorCatalogItem> items, CancellationToken cancellationToken) =>
            Task.CompletedTask;
        public IDisposable AcquireReadyLease(string itemId) => new Lease();
        public Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken) => Task.CompletedTask;
        private sealed class Lease : IDisposable { public void Dispose() { } }
    }
}
