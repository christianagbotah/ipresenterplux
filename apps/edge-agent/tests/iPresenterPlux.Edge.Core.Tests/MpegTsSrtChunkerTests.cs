using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class MpegTsSrtChunkerTests
{
    [Fact]
    public void SevenTransportPacketsBecomeOne1316ByteMessage()
    {
        var chunker = new MpegTsSrtChunker();
        var packets = Enumerable.Range(0, 7).Select(Packet).ToArray();

        var message = Assert.Single(chunker.Append(packets));

        Assert.Equal(1316, message.Length);
        for (var index = 0; index < 7; index++)
            Assert.Equal((byte)index, message[index * 188 + 1]);
        Assert.Equal(0, chunker.BufferedPacketCount);
    }

    [Fact]
    public void PartialPacketsCarryAcrossMuxCallbacks()
    {
        var chunker = new MpegTsSrtChunker();

        Assert.Empty(chunker.Append(Enumerable.Range(0, 3).Select(Packet)));
        Assert.Equal(3, chunker.BufferedPacketCount);

        var message = Assert.Single(chunker.Append(Enumerable.Range(3, 4).Select(Packet)));
        Assert.Equal(1316, message.Length);
        Assert.Equal(0, chunker.BufferedPacketCount);
    }

    [Fact]
    public void FlushReturnsOnlyBufferedWholeTransportPackets()
    {
        var chunker = new MpegTsSrtChunker();
        _ = chunker.Append(new[] { Packet(1), Packet(2) });

        var tail = Assert.IsType<byte[]>(chunker.Flush());

        Assert.Equal(376, tail.Length);
        Assert.Equal(0x47, tail[0]);
        Assert.Equal(0x47, tail[188]);
        Assert.Equal(0, chunker.BufferedPacketCount);
        Assert.Null(chunker.Flush());
    }

    [Fact]
    public void ResetDropsBufferedTail()
    {
        var chunker = new MpegTsSrtChunker();
        _ = chunker.Append(new[] { Packet(1), Packet(2), Packet(3) });

        chunker.Reset();

        Assert.Equal(0, chunker.BufferedPacketCount);
        Assert.Null(chunker.Flush());
    }

    [Fact]
    public void RejectsMalformedTransportPackets()
    {
        var chunker = new MpegTsSrtChunker();
        Assert.Throws<ArgumentException>(() => chunker.Append(new[] { new byte[187] }));

        var wrongSync = new byte[188];
        Assert.Throws<ArgumentException>(() => chunker.Append(new[] { wrongSync }));
    }

    private static byte[] Packet(int marker)
    {
        var packet = new byte[188];
        packet[0] = 0x47;
        packet[1] = (byte)marker;
        return packet;
    }
}
