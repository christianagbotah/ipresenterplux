using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.MacOS;
using Xunit;

namespace iPresenterPlux.Edge.MacOS.Tests;

public sealed class MacOSMediaAudioFrameProviderTests
{
    [Fact]
    public async Task RevisionChangeSeeksNativeDecoderAndResetClosesHandle()
    {
        var bridge = new FakeMediaAudioBridge();
        using var provider = new MacOSMediaAudioFrameProvider(bridge);
        var path = Path.GetTempFileName();
        try
        {
            var asset = Asset(path);
            var first = Playback(asset, revision: 7, position: .20);
            var second = Playback(asset, revision: 8, position: .90);

            var early = await provider.ReadPcmAsync(asset, first, 48_000, 2, 960, CancellationToken.None);
            var late = await provider.ReadPcmAsync(asset, second, 48_000, 2, 960, CancellationToken.None);

            Assert.NotNull(early);
            Assert.NotNull(late);
            Assert.Equal(48_000, late!.SampleRate);
            Assert.Equal(2, late.Channels);
            Assert.Equal(16, late.BitsPerSample);
            Assert.Equal(3840, late.BytesRecorded);
            Assert.Equal(new long[] { 200_000, 900_000 }, bridge.SeekPositions);

            provider.Reset();
            Assert.Equal(1, bridge.CloseCalls);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task ProviderRequiresBridgeApiFiveAndLocalPreparedFile()
    {
        var path = Path.GetTempFileName();
        try
        {
            var oldBridge = new FakeMediaAudioBridge { ApiVersion = 4 };
            using var provider = new MacOSMediaAudioFrameProvider(oldBridge);
            var asset = Asset(path);
            var failure = await Assert.ThrowsAsync<MediaAudioFrameProviderException>(() =>
                provider.ReadPcmAsync(asset, Playback(asset, 1, 0), 48_000, 2, 960, CancellationToken.None));
            Assert.Equal("native_bridge_outdated", failure.ErrorCode);
        }
        finally
        {
            File.Delete(path);
        }
    }

    private static PreparedMediaAsset Asset(string path)
    {
        var serviceId = Guid.NewGuid();
        var itemId = Guid.NewGuid().ToString("D");
        var descriptor = new PresentationMediaDescriptor(
            Guid.NewGuid(), "audio", new Uri("https://cdn.example.test/audio.m4a"), "fixture-v1",
            "audio/mp4", "Generated audio fixture", 0, 2, false, 1, "contain").Validate();
        return new PreparedMediaAsset(itemId, serviceId, new string('a', 64), path, "audio/mp4", "audio", TimeSpan.FromSeconds(2), descriptor);
    }

    private static MediaPlaybackSnapshot Playback(PreparedMediaAsset asset, long revision, double position) => new(
        asset.ItemId, asset.ServiceId, asset.CacheKey, asset.MediaKind, "playing",
        DateTimeOffset.UtcNow, null, position, position, 0, 2, false, 1, "contain", revision);

    private sealed class FakeMediaAudioBridge : IMacOSMediaAudioNativeBridge
    {
        public int ApiVersion { get; set; } = 5;
        public List<long> SeekPositions { get; } = new();
        public int CloseCalls { get; private set; }
        public int GetApiVersion() => ApiVersion;
        public long OpenMediaAudio(string localPath, int sampleRate, int channels) => 42;
        public void SeekMediaAudio(long handle, long positionMicroseconds) => SeekPositions.Add(positionMicroseconds);
        public MacOSMediaAudioReadResult? ReadMediaAudio(long handle, int frameSamples) =>
            new(new byte[frameSamples * 2 * sizeof(short)], 0);
        public void CloseMediaAudio(long handle) => CloseCalls++;
    }
}
