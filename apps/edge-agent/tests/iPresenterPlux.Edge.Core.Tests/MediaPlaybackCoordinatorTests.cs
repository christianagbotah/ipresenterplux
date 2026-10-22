using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class MediaPlaybackCoordinatorTests
{
    [Fact]
    public async Task ImageTakeIsStaticReadyAndDoesNotAdvance()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T14:00:00Z"));
        var serviceId = Guid.NewGuid();
        var coordinator = new MediaPlaybackCoordinator(clock);
        await coordinator.SetActiveServiceAsync(serviceId, CancellationToken.None);

        var taken = await coordinator.TakeAsync(Asset(serviceId, "image", trimStart: 0, trimEnd: null), CancellationToken.None);
        clock.Advance(TimeSpan.FromSeconds(20));
        var later = coordinator.Snapshot;

        Assert.Equal("ready", taken.State);
        Assert.Equal(0, taken.EffectivePositionSeconds, 6);
        Assert.NotNull(later);
        Assert.Equal("ready", later!.State);
        Assert.Equal(0, later.EffectivePositionSeconds, 6);
        Assert.True(later.Revision > 0);
    }

    [Fact]
    public async Task VideoTakeStartsAtTrimStartAndAdvancesFromCoordinatorClock()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T14:00:00Z"));
        var serviceId = Guid.NewGuid();
        var coordinator = new MediaPlaybackCoordinator(clock);
        await coordinator.SetActiveServiceAsync(serviceId, CancellationToken.None);

        var taken = await coordinator.TakeAsync(Asset(serviceId, "video", trimStart: 2, trimEnd: 12), CancellationToken.None);
        clock.Advance(TimeSpan.FromSeconds(3.25));
        var current = coordinator.Snapshot!;

        Assert.Equal("playing", taken.State);
        Assert.Equal(2, taken.EffectivePositionSeconds, 6);
        Assert.Equal(5.25, current.EffectivePositionSeconds, 3);
        Assert.Equal(taken.Revision, current.Revision);
    }

    [Fact]
    public async Task PauseFreezesAndResumeContinuesFromFrozenPosition()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T14:00:00Z"));
        var serviceId = Guid.NewGuid();
        var coordinator = new MediaPlaybackCoordinator(clock);
        await coordinator.SetActiveServiceAsync(serviceId, CancellationToken.None);
        await coordinator.TakeAsync(Asset(serviceId, "audio", trimStart: 1, trimEnd: 20), CancellationToken.None);
        clock.Advance(TimeSpan.FromSeconds(4));

        var paused = await coordinator.PauseAsync(CancellationToken.None);
        clock.Advance(TimeSpan.FromSeconds(10));
        var stillPaused = coordinator.Snapshot!;
        var resumed = await coordinator.ResumeAsync(CancellationToken.None);
        clock.Advance(TimeSpan.FromSeconds(2));
        var later = coordinator.Snapshot!;

        Assert.Equal("paused", paused.State);
        Assert.Equal(5, paused.EffectivePositionSeconds, 3);
        Assert.Equal(5, stillPaused.EffectivePositionSeconds, 3);
        Assert.True(resumed.Revision > paused.Revision);
        Assert.Equal("playing", resumed.State);
        Assert.Equal(7, later.EffectivePositionSeconds, 3);
    }

    [Fact]
    public async Task SeekClampsAndLoopWrapsWithinTrimBounds()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T14:00:00Z"));
        var serviceId = Guid.NewGuid();
        var coordinator = new MediaPlaybackCoordinator(clock);
        await coordinator.SetActiveServiceAsync(serviceId, CancellationToken.None);
        await coordinator.TakeAsync(Asset(serviceId, "video", trimStart: 2, trimEnd: 8, loop: true), CancellationToken.None);

        var low = await coordinator.SeekAsync(-100, CancellationToken.None);
        var high = await coordinator.SeekAsync(100, CancellationToken.None);
        var restarted = await coordinator.SeekAsync(7, CancellationToken.None);
        clock.Advance(TimeSpan.FromSeconds(3));
        var wrapped = coordinator.Snapshot!;

        Assert.Equal(2, low.EffectivePositionSeconds, 6);
        Assert.Equal(8, high.EffectivePositionSeconds, 6);
        Assert.Equal(7, restarted.EffectivePositionSeconds, 6);
        Assert.Equal("playing", wrapped.State);
        Assert.Equal(4, wrapped.EffectivePositionSeconds, 3);
    }

    [Fact]
    public async Task NonLoopMediaEndsAndHoldsFinalFrame()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T14:00:00Z"));
        var serviceId = Guid.NewGuid();
        var coordinator = new MediaPlaybackCoordinator(clock);
        await coordinator.SetActiveServiceAsync(serviceId, CancellationToken.None);
        var taken = await coordinator.TakeAsync(Asset(serviceId, "video", trimStart: 2, trimEnd: 5), CancellationToken.None);

        clock.Advance(TimeSpan.FromSeconds(4));
        var ended = coordinator.Snapshot!;
        clock.Advance(TimeSpan.FromSeconds(30));
        var held = coordinator.Snapshot!;

        Assert.Equal("playing", taken.State);
        Assert.Equal("ended", ended.State);
        Assert.Equal(5, ended.EffectivePositionSeconds, 6);
        Assert.True(ended.Revision > taken.Revision);
        Assert.Equal("ended", held.State);
        Assert.Equal(5, held.EffectivePositionSeconds, 6);
        Assert.Equal(ended.Revision, held.Revision);
    }

    [Fact]
    public async Task ClearAndServiceChangeResetPlaybackAuthority()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T14:00:00Z"));
        var serviceId = Guid.NewGuid();
        var coordinator = new MediaPlaybackCoordinator(clock);
        await coordinator.SetActiveServiceAsync(serviceId, CancellationToken.None);
        await coordinator.TakeAsync(Asset(serviceId, "audio", trimStart: 0, trimEnd: 10), CancellationToken.None);

        await coordinator.ClearAsync(CancellationToken.None);
        Assert.Null(coordinator.Snapshot);
        await Assert.ThrowsAsync<InvalidOperationException>(() => coordinator.ResumeAsync(CancellationToken.None));

        await coordinator.TakeAsync(Asset(serviceId, "audio", trimStart: 0, trimEnd: 10), CancellationToken.None);
        await coordinator.SetActiveServiceAsync(Guid.NewGuid(), CancellationToken.None);
        Assert.Null(coordinator.Snapshot);
        await Assert.ThrowsAsync<InvalidOperationException>(() => coordinator.ResumeAsync(CancellationToken.None));
    }

    [Fact]
    public async Task RestoredDynamicMediaIsRecoveryRequiredUntilDeliberateResume()
    {
        var serviceId = Guid.NewGuid();
        var firstClock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T14:00:00Z"));
        var first = new MediaPlaybackCoordinator(firstClock);
        await first.SetActiveServiceAsync(serviceId, CancellationToken.None);
        await first.TakeAsync(Asset(serviceId, "video", trimStart: 1, trimEnd: 30), CancellationToken.None);
        firstClock.Advance(TimeSpan.FromSeconds(7));
        var persisted = first.Snapshot!;

        var restartClock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T16:00:00Z"));
        var restored = new MediaPlaybackCoordinator(restartClock);
        await restored.SetActiveServiceAsync(serviceId, CancellationToken.None);
        var recovery = await restored.RestoreRecoveryAsync(persisted, CancellationToken.None);
        restartClock.Advance(TimeSpan.FromMinutes(5));

        Assert.Equal("recovery_required", recovery.State);
        Assert.Equal(persisted.EffectivePositionSeconds, restored.Snapshot!.EffectivePositionSeconds, 6);
        var resumed = await restored.ResumeAsync(CancellationToken.None);
        restartClock.Advance(TimeSpan.FromSeconds(2));
        Assert.Equal("playing", resumed.State);
        Assert.Equal(persisted.EffectivePositionSeconds + 2, restored.Snapshot!.EffectivePositionSeconds, 3);
    }

    [Fact]
    public async Task RestoredMediaCannotResumeAfterServiceChanges()
    {
        var oldService = Guid.NewGuid();
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T14:00:00Z"));
        var first = new MediaPlaybackCoordinator(clock);
        await first.SetActiveServiceAsync(oldService, CancellationToken.None);
        await first.TakeAsync(Asset(oldService, "video", trimStart: 0, trimEnd: 10), CancellationToken.None);
        clock.Advance(TimeSpan.FromSeconds(3));
        var persisted = first.Snapshot!;

        var restored = new MediaPlaybackCoordinator(clock);
        await restored.SetActiveServiceAsync(oldService, CancellationToken.None);
        await restored.RestoreRecoveryAsync(persisted, CancellationToken.None);
        await restored.SetActiveServiceAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Null(restored.Snapshot);
        await Assert.ThrowsAsync<InvalidOperationException>(() => restored.ResumeAsync(CancellationToken.None));
    }

    private static PreparedMediaAsset Asset(
        Guid serviceId,
        string mediaKind,
        double trimStart,
        double? trimEnd,
        bool loop = false)
    {
        var itemId = Guid.NewGuid().ToString("D");
        var descriptor = new PresentationMediaDescriptor(
            Guid.NewGuid(), mediaKind, new Uri($"https://cdn.example.test/{itemId}.bin"),
            "v1", mediaKind == "video" ? "video/mp4" : mediaKind == "audio" ? "audio/mpeg" : "image/png",
            "Media", trimStart, trimEnd, loop, 0.75, "contain").Validate();
        return new PreparedMediaAsset(
            itemId, serviceId, new string('a', 64), "/tmp/media.bin", descriptor.ContentTypeHint!, mediaKind,
            trimEnd is { } end ? TimeSpan.FromSeconds(end) : null, descriptor);
    }

    private sealed class ManualTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now += by;
    }
}
