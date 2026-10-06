namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class MpegTsSrtChunker(int packetsPerMessage = 7)
{
    public const int TransportPacketSize = 188;
    private readonly int _packetsPerMessage = packetsPerMessage > 0
        ? packetsPerMessage
        : throw new ArgumentOutOfRangeException(nameof(packetsPerMessage));
    private readonly byte[] _buffer = packetsPerMessage > 0
        ? new byte[checked(packetsPerMessage * TransportPacketSize)]
        : throw new ArgumentOutOfRangeException(nameof(packetsPerMessage));
    private int _length;

    public int TargetMessageSize => _buffer.Length;
    public int BufferedPacketCount => _length / TransportPacketSize;

    public IReadOnlyList<byte[]> Append(IEnumerable<byte[]> packets)
    {
        ArgumentNullException.ThrowIfNull(packets);
        List<byte[]>? messages = null;

        foreach (var packet in packets)
        {
            ArgumentNullException.ThrowIfNull(packet);
            if (packet.Length != TransportPacketSize)
                throw new ArgumentException($"Every MPEG-TS packet must be exactly {TransportPacketSize} bytes.", nameof(packets));
            if (packet[0] != 0x47)
                throw new ArgumentException("Every MPEG-TS packet must begin with the sync byte 0x47.", nameof(packets));

            packet.CopyTo(_buffer.AsSpan(_length, TransportPacketSize));
            _length += TransportPacketSize;
            if (_length != _buffer.Length) continue;

            messages ??= new List<byte[]>();
            messages.Add((byte[])_buffer.Clone());
            _length = 0;
        }

        return messages is null ? Array.Empty<byte[]>() : messages;
    }

    public byte[]? Flush()
    {
        if (_length == 0) return null;
        var message = new byte[_length];
        _buffer.AsSpan(0, _length).CopyTo(message);
        _length = 0;
        return message;
    }

    public void Reset()
    {
        Array.Clear(_buffer);
        _length = 0;
    }
}
