using System.Runtime.CompilerServices;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class ProgramAudioMixCoordinatorTests
{
    [Fact]
    public async Task MediaSoundtrackFlowsWithoutMicrophoneInput()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T16:00:00Z"));
        var fixture = await Fixture.CreateAsync(clock, trimEnd: 5);
        fixture.Provider.SampleValue = 2400;

        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);

        var frame = Assert.Single(fixture.Output.Frames);
        Assert.Contains(Samples(frame), sample => sample != 0);
        Assert.Single(fixture.Provider.Requests);
    }

    [Fact]
    public async Task PausedMediaDoesNotAdvanceOrEmitSoundtrack()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T16:00:00Z"));
        var fixture = await Fixture.CreateAsync(clock, trimEnd: 5);
        await fixture.Playback.PauseAsync(CancellationToken.None);

        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);

        Assert.Empty(fixture.Provider.Requests);
        Assert.All(Samples(Assert.Single(fixture.Output.Frames)), sample => Assert.Equal((short)0, sample));
    }

    [Fact]
    public async Task PausedMediaResetsActiveProviderSessionOnce()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T16:00:00Z"));
        var fixture = await Fixture.CreateAsync(clock, trimEnd: 5);

        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);
        Assert.Single(fixture.Provider.Requests);
        Assert.Equal(0, fixture.Provider.ResetCalls);

        await fixture.Playback.PauseAsync(CancellationToken.None);
        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);
        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);

        Assert.Equal(1, fixture.Provider.ResetCalls);
    }

    [Fact]
    public async Task ClearAndServiceMismatchResetActiveProviderSession()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T16:00:00Z"));
        var fixture = await Fixture.CreateAsync(clock, trimEnd: 5);

        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);
        await fixture.Playback.ClearAsync(CancellationToken.None);
        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);
        Assert.Equal(1, fixture.Provider.ResetCalls);

        var second = await Fixture.CreateAsync(clock, trimEnd: 5);
        await second.Coordinator.ProcessOnceAsync(CancellationToken.None);
        second.Preparation.OverrideServiceId = Guid.NewGuid();
        await second.Coordinator.ProcessOnceAsync(CancellationToken.None);
        Assert.Equal(1, second.Provider.ResetCalls);
    }

    [Fact]
    public async Task SeekChangesRevisionAndRequestedMediaPosition()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T16:00:00Z"));
        var fixture = await Fixture.CreateAsync(clock, trimEnd: 5);

        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);
        var before = Assert.Single(fixture.Provider.Requests);
        await fixture.Playback.SeekAsync(1.25, CancellationToken.None);
        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);
        var after = fixture.Provider.Requests[^1];

        Assert.NotEqual(before.Revision, after.Revision);
        Assert.InRange(after.PositionSeconds, 1.249, 1.251);
    }

    [Fact]
    public async Task EndedMediaBecomesContributionSilence()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T16:00:00Z"));
        var fixture = await Fixture.CreateAsync(clock, trimEnd: .03);
        clock.Advance(TimeSpan.FromMilliseconds(50));
        Assert.Equal("ended", fixture.Playback.Snapshot!.State);

        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);

        Assert.Empty(fixture.Provider.Requests);
        Assert.All(Samples(Assert.Single(fixture.Output.Frames)), sample => Assert.Equal((short)0, sample));
    }

    [Fact]
    public async Task LiveInputIsQueuedForContributionWithoutChangingPlaybackAuthority()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T16:00:00Z"));
        var fixture = await Fixture.CreateAsync(clock, trimEnd: 5);
        await fixture.Playback.ClearAsync(CancellationToken.None);
        var live = Frame(1800);

        Assert.True(fixture.Coordinator.TrySubmitLive(live));
        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);

        Assert.Empty(fixture.Provider.Requests);
        Assert.Contains(Samples(Assert.Single(fixture.Output.Frames)), sample => sample == 1800);
        Assert.Null(fixture.Playback.Snapshot);
    }

    [Fact]
    public async Task StalePreparedAssetCannotEnterCurrentServiceMix()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T16:00:00Z"));
        var fixture = await Fixture.CreateAsync(clock, trimEnd: 5);
        fixture.Preparation.OverrideServiceId = Guid.NewGuid();

        await fixture.Coordinator.ProcessOnceAsync(CancellationToken.None);

        Assert.Empty(fixture.Provider.Requests);
        Assert.All(Samples(Assert.Single(fixture.Output.Frames)), sample => Assert.Equal((short)0, sample));
    }

    private static AudioFrame Frame(short sample)
    {
        var samples = Enumerable.Repeat(sample, 960 * 2).ToArray();
        var bytes = new byte[samples.Length * sizeof(short)];
        Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
        return new AudioFrame(bytes, bytes.Length, 48_000, 2, 16, DateTimeOffset.Parse("2026-10-22T16:00:00Z"));
    }

    private static short[] Samples(AudioFrame frame)
    {
        var result = new short[frame.BytesRecorded / sizeof(short)];
        Buffer.BlockCopy(frame.Buffer[..frame.BytesRecorded].ToArray(), 0, result, 0, frame.BytesRecorded);
        return result;
    }

    private sealed class Fixture
    {
        private Fixture(
            RecordingContributionBuffer output,
            FakeMediaAudioFrameProvider provider,
            MediaPlaybackCoordinator playback,
            ReadyPreparation preparation,
            ProgramAudioMixCoordinator coordinator)
        {
            Output = output;
            Provider = provider;
            Playback = playback;
            Preparation = preparation;
            Coordinator = coordinator;
        }

        public RecordingContributionBuffer Output { get; }
        public FakeMediaAudioFrameProvider Provider { get; }
        public MediaPlaybackCoordinator Playback { get; }
        public ReadyPreparation Preparation { get; }
        public ProgramAudioMixCoordinator Coordinator { get; }

        public static async Task<Fixture> CreateAsync(ManualTimeProvider clock, double trimEnd)
        {
            var serviceId = Guid.NewGuid();
            var itemId = Guid.NewGuid().ToString("D");
            var descriptor = new PresentationMediaDescriptor(
                Guid.NewGuid(), "video", new Uri("https://cdn.example.test/program.mp4"), "v1",
                "video/mp4", "Program media", 0, trimEnd, false, 1, "contain").Validate();
            var asset = new PreparedMediaAsset(
                itemId, serviceId, new string('a', 64), "/tmp/program.mp4", "video/mp4", "video",
                TimeSpan.FromSeconds(trimEnd), descriptor);
            var playback = new MediaPlaybackCoordinator(clock);
            await playback.SetActiveServiceAsync(serviceId, CancellationToken.None);
            await playback.TakeAsync(asset, CancellationToken.None);
            var output = new RecordingContributionBuffer();
            output.Enable(serviceId);
            var provider = new FakeMediaAudioFrameProvider();
            var preparation = new ReadyPreparation(asset);
            var coordinator = new ProgramAudioMixCoordinator(output, provider, playback, preparation);
            return new Fixture(output, provider, playback, preparation, coordinator);
        }
    }

    private sealed class FakeMediaAudioFrameProvider : IMediaAudioFrameProvider
    {
        public short SampleValue { get; set; } = 1000;
        public int ResetCalls { get; private set; }
        public List<(long Revision, double PositionSeconds)> Requests { get; } = [];

        public void Reset() => ResetCalls++;

        public Task<AudioFrame?> ReadPcmAsync(
            PreparedMediaAsset asset,
            MediaPlaybackSnapshot playback,
            int sampleRate,
            int channels,
            int frameSamples,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Requests.Add((playback.Revision, playback.EffectivePositionSeconds));
            var samples = Enumerable.Repeat(SampleValue, checked(frameSamples * channels)).ToArray();
            var bytes = new byte[samples.Length * sizeof(short)];
            Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
            return Task.FromResult<AudioFrame?>(new AudioFrame(
                bytes, bytes.Length, sampleRate, channels, 16,
                DateTimeOffset.UnixEpoch.AddSeconds(playback.EffectivePositionSeconds)));
        }
    }

    private sealed class ReadyPreparation(PreparedMediaAsset asset) : IMediaPreparationCoordinator
    {
        public Guid? OverrideServiceId { get; set; }
        public event EventHandler<MediaPreparationSnapshot>? StatusChanged { add { } remove { } }

        public Task<MediaPreparationSnapshot> PrepareAsync(PresentationRenderItem item, CancellationToken cancellationToken) =>
            Task.FromResult(Snapshot());

        public MediaPreparationSnapshot? TryGet(string itemId) =>
            string.Equals(itemId, asset.ItemId, StringComparison.Ordinal) ? Snapshot() : null;

        public Task PrefetchAsync(Guid serviceId, IReadOnlyList<OperatorCatalogItem> items, CancellationToken cancellationToken) => Task.CompletedTask;
        public IDisposable AcquireReadyLease(string itemId) => new Lease();
        public Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken) => Task.CompletedTask;

        private MediaPreparationSnapshot Snapshot() => new(
            asset.ItemId, OverrideServiceId ?? asset.ServiceId, MediaPreparationState.Ready, asset, null);

        private sealed class Lease : IDisposable { public void Dispose() { } }
    }

    private sealed class RecordingContributionBuffer : IContributionAudioBuffer
    {
        private Guid? _serviceId;
        public List<AudioFrame> Frames { get; } = [];
        public ContributionAudioBufferStatus Status => new(_serviceId is not null, _serviceId, Frames.Count, 0);
        public void Enable(Guid serviceId) => _serviceId = serviceId;
        public void Disable() => _serviceId = null;
        public bool TrySubmit(AudioFrame frame)
        {
            if (_serviceId is null) return false;
            Frames.Add(frame);
            return true;
        }
        public async IAsyncEnumerable<AudioFrame> ReadAllAsync([EnumeratorCancellation] CancellationToken cancellationToken)
        {
            await Task.CompletedTask;
            yield break;
        }
    }

    private sealed class ManualTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan delta) => _now += delta;
    }
}
