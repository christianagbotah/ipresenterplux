using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Windows.Tests;

public sealed class WindowsMediaVideoFrameProviderTests
{
    [Fact]
    public void DecodesRequestedMp4PositionsIntoDistinctBgraFrames()
    {
        var path = FixturePath("h264-aac-2s.mp4");
        var asset = Asset(path);
        var provider = new WindowsMediaFoundationMediaVideoFrameProvider();

        var early = provider.GetFrame(asset, .2, 96, 54);
        var late = provider.GetFrame(asset, 1.2, 96, 54);

        Assert.Equal(96, early.Width);
        Assert.Equal(54, early.Height);
        Assert.Equal(96 * 4, early.Stride);
        Assert.Equal("bgra32", early.PixelFormat);
        Assert.Equal(96 * 54 * 4, early.Buffer.Length);
        Assert.Equal(asset.ItemId, early.ItemId);
        Assert.False(early.Buffer.Span.SequenceEqual(late.Buffer.Span));
    }

    [Fact]
    public void CorruptInputFailsStructurallyAndDoesNotPoisonLaterReads()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenter-video-provider", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var corrupt = Path.Combine(directory, "corrupt.mp4");
            File.WriteAllText(corrupt, "not an mp4");
            var provider = new WindowsMediaFoundationMediaVideoFrameProvider();

            var failure = Assert.Throws<MediaVideoFrameProviderException>(() =>
                provider.GetFrame(Asset(corrupt), .1, 96, 54));
            Assert.Equal("media_video_decode_failed", failure.ErrorCode);

            var recovered = provider.GetFrame(Asset(FixturePath("h264-aac-2s.mp4")), .4, 96, 54);
            Assert.Equal(96 * 54 * 4, recovered.Buffer.Length);
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Fact]
    public void ProviderRejectsNonLocalAssetPathBeforeDecode()
    {
        var provider = new WindowsMediaFoundationMediaVideoFrameProvider();
        var failure = Assert.Throws<MediaVideoFrameProviderException>(() =>
            provider.GetFrame(Asset("https://cdn.example.test/video.mp4"), .2, 96, 54));

        Assert.Equal("media_video_local_file_required", failure.ErrorCode);
    }

    private static PreparedMediaAsset Asset(string localPath)
    {
        var serviceId = Guid.NewGuid();
        var itemId = Guid.NewGuid().ToString("D");
        var descriptor = new PresentationMediaDescriptor(
            Guid.NewGuid(), "video", new Uri("https://cdn.example.test/video.mp4"), "fixture-v1",
            "video/mp4", "Generated test video", 0, 2, false, 1, "contain").Validate();
        return new PreparedMediaAsset(
            itemId, serviceId, new string('f', 64), localPath, "video/mp4", "video",
            TimeSpan.FromSeconds(2), descriptor);
    }

    private static string FixturePath(string name, [System.Runtime.CompilerServices.CallerFilePath] string testFile = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(testFile)!, "..", "fixtures", "media", name));
}
