namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class StereoPcm16FrameAccumulator(int sampleFramesPerPacket = 1024)
{
    private const int Channels = 2;
    private readonly short[] _buffer = sampleFramesPerPacket > 0
        ? new short[checked(sampleFramesPerPacket * Channels)]
        : throw new ArgumentOutOfRangeException(nameof(sampleFramesPerPacket));
    private int _count;

    public int SampleFramesPerPacket => _buffer.Length / Channels;
    public int BufferedSampleFrames => _count / Channels;

    public IReadOnlyList<short[]> Append(ReadOnlySpan<short> interleavedStereo)
    {
        if ((interleavedStereo.Length & 1) != 0)
            throw new ArgumentException("Stereo PCM input must contain complete left/right pairs.", nameof(interleavedStereo));
        if (interleavedStereo.IsEmpty) return Array.Empty<short[]>();

        List<short[]>? packets = null;
        var offset = 0;
        while (offset < interleavedStereo.Length)
        {
            var copy = Math.Min(_buffer.Length - _count, interleavedStereo.Length - offset);
            interleavedStereo.Slice(offset, copy).CopyTo(_buffer.AsSpan(_count, copy));
            _count += copy;
            offset += copy;

            if (_count != _buffer.Length) continue;
            packets ??= new List<short[]>();
            packets.Add((short[])_buffer.Clone());
            _count = 0;
        }

        return packets is null ? Array.Empty<short[]>() : packets;
    }

    public void Reset()
    {
        _count = 0;
        Array.Clear(_buffer);
    }
}
