using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class MpegTsMuxerTests
{
    [Fact]
    public void KeyFrameEmitsValidProgramTablesAndVideoPes()
    {
        var muxer = new MpegTsMuxer();
        var packets = muxer.MuxVideo(VideoFrame(keyFrame: true, ptsUs: 1_000_000, payloadLength: 700));

        Assert.True(packets.Count >= 6);
        Assert.All(packets, packet =>
        {
            Assert.Equal(MpegTsMuxer.PacketSize, packet.Length);
            Assert.Equal(0x47, packet[0]);
        });
        Assert.Equal(0x0000, Pid(packets[0]));
        Assert.Equal(MpegTsMuxer.PmtPid, Pid(packets[1]));
        Assert.Equal(MpegTsMuxer.VideoPid, Pid(packets[2]));
        Assert.True(PayloadUnitStart(packets[0]));
        Assert.True(PayloadUnitStart(packets[1]));
        Assert.True(PayloadUnitStart(packets[2]));

        AssertPsiCrc(packets[0]);
        AssertPsiCrc(packets[1]);

        var firstVideo = packets[2];
        Assert.Equal(0x30, firstVideo[3] & 0x30);
        Assert.True((firstVideo[5] & 0x10) != 0);
        Assert.Equal(90_000, DecodePcrBase(firstVideo.AsSpan(6, 6)));

        var payloadOffset = PayloadOffset(firstVideo);
        Assert.Equal(new byte[] { 0x00, 0x00, 0x01, 0xE0 }, firstVideo.AsSpan(payloadOffset, 4).ToArray());
        Assert.Equal(90_000, DecodePts(firstVideo.AsSpan(payloadOffset + 9, 5)));
    }

    [Fact]
    public void AudioUsesAacPidAndCarriesAdtsInsidePes()
    {
        var muxer = new MpegTsMuxer();
        _ = muxer.MuxVideo(VideoFrame(keyFrame: true, ptsUs: 0, payloadLength: 50));
        var adts = new byte[] { 0xFF, 0xF1, 0x4C, 0x80, 0x02, 0x9F, 0xFC, 0x11, 0x22, 0x33 };

        var packets = muxer.MuxAudio(new EncodedProgramAudioFrame(
            adts, 48_000, 2, "aac", "adts", 1_000_000, 21_333));

        var firstAudio = Assert.Single(packets);
        Assert.Equal(MpegTsMuxer.AudioPid, Pid(firstAudio));
        Assert.True(PayloadUnitStart(firstAudio));
        var payloadOffset = PayloadOffset(firstAudio);
        Assert.Equal(new byte[] { 0x00, 0x00, 0x01, 0xC0 }, firstAudio.AsSpan(payloadOffset, 4).ToArray());
        Assert.Equal(90_000, DecodePts(firstAudio.AsSpan(payloadOffset + 9, 5)));
        Assert.Equal(adts, firstAudio.AsSpan(payloadOffset + 14, adts.Length).ToArray());
    }

    [Fact]
    public void ContinuityCountersProgressPerElementaryPid()
    {
        var muxer = new MpegTsMuxer();
        var first = muxer.MuxVideo(VideoFrame(keyFrame: true, ptsUs: 0, payloadLength: 500));
        var firstVideoPackets = first.Where(packet => Pid(packet) == MpegTsMuxer.VideoPid).ToArray();
        var second = muxer.MuxVideo(VideoFrame(keyFrame: false, ptsUs: 33_333, payloadLength: 50));
        var secondVideo = Assert.Single(second, packet => Pid(packet) == MpegTsMuxer.VideoPid);

        var expected = (Continuity(firstVideoPackets[^1]) + 1) & 0x0F;
        Assert.Equal(expected, Continuity(secondVideo));
    }

    [Fact]
    public void SubsequentKeyFrameReemitsTablesWithAdvancedContinuity()
    {
        var muxer = new MpegTsMuxer();
        var first = muxer.MuxVideo(VideoFrame(keyFrame: true, ptsUs: 0, payloadLength: 20));
        var second = muxer.MuxVideo(VideoFrame(keyFrame: true, ptsUs: 2_000_000, payloadLength: 20));

        Assert.Equal(0x0000, Pid(second[0]));
        Assert.Equal(MpegTsMuxer.PmtPid, Pid(second[1]));
        Assert.Equal((Continuity(first[0]) + 1) & 0x0F, Continuity(second[0]));
        Assert.Equal((Continuity(first[1]) + 1) & 0x0F, Continuity(second[1]));
    }

    [Fact]
    public void AudioCanOpenTransportAndEmitTablesBeforeVideoArrives()
    {
        var muxer = new MpegTsMuxer();
        var packets = muxer.MuxAudio(new EncodedProgramAudioFrame(
            new byte[] { 0xFF, 0xF1, 0x50, 0x80, 0x01, 0x7F, 0xFC, 0x00 },
            48_000, 2, "aac", "adts", 0, 21_333));

        Assert.Equal(0x0000, Pid(packets[0]));
        Assert.Equal(MpegTsMuxer.PmtPid, Pid(packets[1]));
        Assert.Equal(MpegTsMuxer.AudioPid, Pid(packets[2]));
    }

    [Fact]
    public void ResetRestartsTableAndElementaryContinuity()
    {
        var muxer = new MpegTsMuxer();
        _ = muxer.MuxVideo(VideoFrame(keyFrame: true, ptsUs: 0, payloadLength: 300));
        muxer.Reset();

        var packets = muxer.MuxVideo(VideoFrame(keyFrame: false, ptsUs: 0, payloadLength: 20));

        Assert.Equal(0, Continuity(packets[0]));
        Assert.Equal(0, Continuity(packets[1]));
        Assert.Equal(0, Continuity(packets[2]));
    }

    [Fact]
    public void RejectsWrongCodecContracts()
    {
        var muxer = new MpegTsMuxer();
        Assert.Throws<ArgumentException>(() => muxer.MuxVideo(new EncodedProgramVideoFrame(
            new byte[] { 1 }, 1920, 1080, "vp9", "annexb", false, 0)));
        Assert.Throws<ArgumentException>(() => muxer.MuxAudio(new EncodedProgramAudioFrame(
            new byte[] { 1 }, 48_000, 2, "opus", "adts", 0, 20_000)));
    }

    private static EncodedProgramVideoFrame VideoFrame(bool keyFrame, long ptsUs, int payloadLength)
    {
        var data = new byte[Math.Max(payloadLength, 6)];
        data[0] = 0x00;
        data[1] = 0x00;
        data[2] = 0x00;
        data[3] = 0x01;
        data[4] = keyFrame ? (byte)0x65 : (byte)0x41;
        for (var index = 5; index < data.Length; index++) data[index] = (byte)(index & 0xFF);
        return new EncodedProgramVideoFrame(data, 1920, 1080, "h264", "annexb", keyFrame, ptsUs);
    }

    private static int Pid(byte[] packet) => ((packet[1] & 0x1F) << 8) | packet[2];
    private static int Continuity(byte[] packet) => packet[3] & 0x0F;
    private static bool PayloadUnitStart(byte[] packet) => (packet[1] & 0x40) != 0;

    private static int PayloadOffset(byte[] packet)
    {
        var adaptationFieldControl = (packet[3] >> 4) & 0x03;
        return adaptationFieldControl == 0x03 ? 5 + packet[4] : 4;
    }

    private static long DecodePts(ReadOnlySpan<byte> bytes)
    {
        return ((long)(bytes[0] >> 1 & 0x07) << 30) |
               ((long)bytes[1] << 22) |
               ((long)(bytes[2] >> 1 & 0x7F) << 15) |
               ((long)bytes[3] << 7) |
               (long)(bytes[4] >> 1 & 0x7F);
    }

    private static long DecodePcrBase(ReadOnlySpan<byte> bytes)
    {
        return ((long)bytes[0] << 25) |
               ((long)bytes[1] << 17) |
               ((long)bytes[2] << 9) |
               ((long)bytes[3] << 1) |
               (long)((bytes[4] >> 7) & 0x01);
    }

    private static void AssertPsiCrc(byte[] packet)
    {
        var sectionStart = 5 + packet[4];
        var sectionLength = ((packet[sectionStart + 1] & 0x0F) << 8) | packet[sectionStart + 2];
        var section = packet.AsSpan(sectionStart, 3 + sectionLength);
        Assert.Equal(0u, Crc(section));
    }

    private static uint Crc(ReadOnlySpan<byte> data)
    {
        uint crc = 0xFFFF_FFFF;
        foreach (var value in data)
        {
            crc ^= (uint)value << 24;
            for (var bit = 0; bit < 8; bit++)
                crc = (crc & 0x8000_0000) != 0 ? (crc << 1) ^ 0x04C1_1DB7 : crc << 1;
        }
        return crc;
    }
}
