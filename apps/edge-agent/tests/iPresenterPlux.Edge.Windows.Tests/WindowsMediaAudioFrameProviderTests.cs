using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Windows.Tests;

public sealed class WindowsMediaAudioFrameProviderTests
{
    [Fact]
    public async Task DecodesAacTrackAtRequestedPlaybackPositions()
    {
        var path = FixturePath("h264-aac-2s.mp4");
        var asset = Asset(path);
        using var provider = new WindowsMediaFoundationMediaAudioFrameProvider();

        var early = await provider.ReadPcmAsync(asset, Playback(asset, .20, 1), 48_000, 2, 960, CancellationToken.None);
        var late = await provider.ReadPcmAsync(asset, Playback(asset, 1.20, 2), 48_000, 2, 960, CancellationToken.None);

        Assert.NotNull(early);
        Assert.NotNull(late);
        Assert.Equal(48_000, early!.SampleRate);
        Assert.Equal(2, early.Channels);
        Assert.Equal(16, early.BitsPerSample);
        Assert.Equal(960 * 2 * sizeof(short), early.BytesRecorded);
        Assert.False(early.Buffer.Span.SequenceEqual(late!.Buffer.Span));
        Assert.InRange((early.CapturedAt - DateTimeOffset.UnixEpoch).TotalSeconds, .19, .22);
        Assert.InRange((late.CapturedAt - DateTimeOffset.UnixEpoch).TotalSeconds, 1.19, 1.22);
    }

    [Fact]
    public async Task RevisionChangeCanSeekBackwardsWithoutUsingStaleDecoderPosition()
    {
        var asset = Asset(FixturePath("h264-aac-2s.mp4"));
        using var provider = new WindowsMediaFoundationMediaAudioFrameProvider();

        var late = await provider.ReadPcmAsync(asset, Playback(asset, 1.20, 10), 48_000, 2, 960, CancellationToken.None);
        var early = await provider.ReadPcmAsync(asset, Playback(asset, .20, 11), 48_000, 2, 960, CancellationToken.None);

        Assert.NotNull(late);
        Assert.NotNull(early);
        Assert.False(late!.Buffer.Span.SequenceEqual(early!.Buffer.Span));
        Assert.InRange((early.CapturedAt - DateTimeOffset.UnixEpoch).TotalSeconds, .19, .22);
    }

    [Fact]
    public async Task CorruptInputFailsStructurallyAndDoesNotPoisonLaterReads()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenter-audio-provider", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var corrupt = Path.Combine(directory, "corrupt.mp4");
            File.WriteAllText(corrupt, "not media");
            using var provider = new WindowsMediaFoundationMediaAudioFrameProvider();
            var badAsset = Asset(corrupt);

            var failure = await Assert.ThrowsAsync<MediaAudioFrameProviderException>(() =>
                provider.ReadPcmAsync(badAsset, Playback(badAsset, .1, 1), 48_000, 2, 960, CancellationToken.None));
            Assert.Equal("media_audio_decode_failed", failure.ErrorCode);

            var goodAsset = Asset(FixturePath("h264-aac-2s.mp4"));
            var recovered = await provider.ReadPcmAsync(goodAsset, Playback(goodAsset, .4, 2), 48_000, 2, 960, CancellationToken.None);
            Assert.NotNull(recovered);
            Assert.Equal(960 * 2 * sizeof(short), recovered!.BytesRecorded);
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Fact]
    public async Task ProviderRejectsRemoteAssetPathBeforeDecode()
    {
        using var provider = new WindowsMediaFoundationMediaAudioFrameProvider();
        var asset = Asset("https://cdn.example.test/program.mp4");

        var failure = await Assert.ThrowsAsync<MediaAudioFrameProviderException>(() =>
            provider.ReadPcmAsync(asset, Playback(asset, .2, 1), 48_000, 2, 960, CancellationToken.None));

        Assert.Equal("media_audio_local_file_required", failure.ErrorCode);
    }

    [Fact]
    public async Task CancellationIsObservedBeforeDecoderWork()
    {
        var asset = Asset(FixturePath("h264-aac-2s.mp4"));
        using var provider = new WindowsMediaFoundationMediaAudioFrameProvider();
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            provider.ReadPcmAsync(asset, Playback(asset, .2, 1), 48_000, 2, 960, cts.Token));
    }

    private static MediaPlaybackSnapshot Playback(PreparedMediaAsset asset, double position, long revision) => new(
        asset.ItemId, asset.ServiceId, asset.CacheKey, asset.MediaKind, "playing",
        DateTimeOffset.Parse("2026-10-22T16:00:00Z"), null,
        position, position, 0, 2, false, 1, "contain", revision);

    private static PreparedMediaAsset Asset(string localPath)
    {
        var serviceId = Guid.NewGuid();
        var itemId = Guid.NewGuid().ToString("D");
        var descriptor = new PresentationMediaDescriptor(
            Guid.NewGuid(), "video", new Uri("https://cdn.example.test/program.mp4"), "fixture-v1",
            "video/mp4", "Generated test media", 0, 2, false, 1, "contain").Validate();
        return new PreparedMediaAsset(
            itemId, serviceId, new string('f', 64), localPath, "video/mp4", "video",
            TimeSpan.FromSeconds(2), descriptor);
    }

    private static string FixturePath(string name, [System.Runtime.CompilerServices.CallerFilePath] string testFile = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(testFile)!, "..", "fixtures", "media", name));
}
