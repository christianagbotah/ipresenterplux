using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class MediaFormatProbeTests
{
    public static TheoryData<byte[], string, string, string> SupportedFixtures => new()
    {
        { [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image", "image/png", "image/png" },
        { [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "image", "image/jpeg", "image/jpeg" },
        { [(byte)'R',(byte)'I',(byte)'F',(byte)'F',0x04,0,0,0,(byte)'W',(byte)'E',(byte)'B',(byte)'P'], "image", "image/webp", "image/webp" },
        { [0,0,0,24,(byte)'f',(byte)'t',(byte)'y',(byte)'p',(byte)'i',(byte)'s',(byte)'o',(byte)'m'], "video", "video/mp4", "video/mp4" },
        { [0,0,0,24,(byte)'f',(byte)'t',(byte)'y',(byte)'p',(byte)'M',(byte)'4',(byte)'A',(byte)' '], "audio", "audio/mp4", "audio/mp4" },
        { [(byte)'R',(byte)'I',(byte)'F',(byte)'F',0x04,0,0,0,(byte)'W',(byte)'A',(byte)'V',(byte)'E'], "audio", "audio/wav", "audio/wav" },
        { [(byte)'I',(byte)'D',(byte)'3',4,0,0,0,0,0,0], "audio", "audio/mpeg", "audio/mpeg" },
        { [0xff,0xf1,0x50,0x80], "audio", "audio/aac", "audio/aac" },
    };

    [Theory]
    [MemberData(nameof(SupportedFixtures))]
    public void DetectsSupportedContent(byte[] bytes, string mediaKind, string declaredContentType, string expected)
    {
        Assert.Equal(expected, MediaFormatProbe.Detect(bytes, mediaKind, declaredContentType));
    }

    [Fact]
    public void RejectsSpoofedOrKindMismatchedContent()
    {
        var spoofed = Assert.Throws<MediaAssetCacheException>(() =>
            MediaFormatProbe.Detect("not a png"u8.ToArray(), "image", "image/png"));
        Assert.Equal("media_type_invalid", spoofed.Code);

        var mismatch = Assert.Throws<MediaAssetCacheException>(() =>
            MediaFormatProbe.Detect([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a], "video", "video/mp4"));
        Assert.Equal("media_type_invalid", mismatch.Code);
    }
}
