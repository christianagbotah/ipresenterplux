using iPresenterPlux.Edge.Core.Abstractions;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class MpegTsMuxer
{
    public const int PacketSize = 188;
    public const int ProgramNumber = 1;
    public const int PmtPid = 0x1000;
    public const int VideoPid = 0x0100;
    public const int AudioPid = 0x0101;

    private byte _patContinuity;
    private byte _pmtContinuity;
    private byte _videoContinuity;
    private byte _audioContinuity;
    private bool _tablesEmitted;

    public IReadOnlyList<byte[]> MuxVideo(EncodedProgramVideoFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (!string.Equals(frame.Codec, "h264", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(frame.Format, "annexb", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("MPEG-TS video input must be H.264 Annex-B.", nameof(frame));
        if (frame.Data.IsEmpty) throw new ArgumentException("Encoded video frame is empty.", nameof(frame));
        if (frame.PresentationTimestampMicroseconds < 0)
            throw new ArgumentOutOfRangeException(nameof(frame), "Video PTS must be non-negative.");

        var packets = new List<byte[]>();
        if (!_tablesEmitted || frame.IsKeyFrame)
        {
            AppendProgramTables(packets);
            _tablesEmitted = true;
        }

        var pts = To90Khz(frame.PresentationTimestampMicroseconds);
        var pes = BuildPesPacket(0xE0, frame.Data.Span, pts);
        PacketizePes(VideoPid, pes, pts, includePcrOnFirstPacket: true, ref _videoContinuity, packets);
        return packets;
    }

    public IReadOnlyList<byte[]> MuxAudio(EncodedProgramAudioFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (!string.Equals(frame.Codec, "aac", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(frame.Format, "adts", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("MPEG-TS audio input must be ADTS AAC.", nameof(frame));
        if (frame.Data.IsEmpty) throw new ArgumentException("Encoded audio frame is empty.", nameof(frame));
        if (frame.PresentationTimestampMicroseconds < 0)
            throw new ArgumentOutOfRangeException(nameof(frame), "Audio PTS must be non-negative.");

        var packets = new List<byte[]>();
        if (!_tablesEmitted)
        {
            AppendProgramTables(packets);
            _tablesEmitted = true;
        }

        var pts = To90Khz(frame.PresentationTimestampMicroseconds);
        var pes = BuildPesPacket(0xC0, frame.Data.Span, pts);
        PacketizePes(AudioPid, pes, pts, includePcrOnFirstPacket: false, ref _audioContinuity, packets);
        return packets;
    }

    public void Reset()
    {
        _patContinuity = 0;
        _pmtContinuity = 0;
        _videoContinuity = 0;
        _audioContinuity = 0;
        _tablesEmitted = false;
    }

    internal static long To90Khz(long microseconds)
    {
        if (microseconds < 0) throw new ArgumentOutOfRangeException(nameof(microseconds));
        var ticks = (long)((Int128)microseconds * 9 / 100);
        return ticks & 0x1_FFFF_FFFFL;
    }

    private void AppendProgramTables(List<byte[]> packets)
    {
        packets.Add(BuildPsiPacket(0x0000, BuildPatSection(), ref _patContinuity));
        packets.Add(BuildPsiPacket(PmtPid, BuildPmtSection(), ref _pmtContinuity));
    }

    private static byte[] BuildPatSection()
    {
        var section = new byte[]
        {
            0x00, 0xB0, 0x0D,
            0x00, 0x01,
            0xC1, 0x00, 0x00,
            0x00, ProgramNumber,
            (byte)(0xE0 | ((PmtPid >> 8) & 0x1F)), (byte)(PmtPid & 0xFF)
        };
        return AppendCrc(section);
    }

    private static byte[] BuildPmtSection()
    {
        var section = new byte[]
        {
            0x02, 0xB0, 0x17,
            0x00, ProgramNumber,
            0xC1, 0x00, 0x00,
            (byte)(0xE0 | ((VideoPid >> 8) & 0x1F)), (byte)(VideoPid & 0xFF),
            0xF0, 0x00,
            0x1B, (byte)(0xE0 | ((VideoPid >> 8) & 0x1F)), (byte)(VideoPid & 0xFF), 0xF0, 0x00,
            0x0F, (byte)(0xE0 | ((AudioPid >> 8) & 0x1F)), (byte)(AudioPid & 0xFF), 0xF0, 0x00
        };
        return AppendCrc(section);
    }

    private static byte[] AppendCrc(ReadOnlySpan<byte> section)
    {
        var result = new byte[section.Length + 4];
        section.CopyTo(result);
        var crc = Mpeg2Crc32(section);
        result[^4] = (byte)(crc >> 24);
        result[^3] = (byte)(crc >> 16);
        result[^2] = (byte)(crc >> 8);
        result[^1] = (byte)crc;
        return result;
    }

    internal static uint Mpeg2Crc32(ReadOnlySpan<byte> data)
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

    private static byte[] BuildPsiPacket(int pid, ReadOnlySpan<byte> section, ref byte continuity)
    {
        if (section.Length + 1 > 184) throw new InvalidOperationException("PSI section does not fit in one TS packet.");
        var packet = CreateStuffedPacket();
        WriteHeader(packet, pid, payloadUnitStart: true, adaptationAndPayload: false, NextContinuity(ref continuity));
        packet[4] = 0x00;
        section.CopyTo(packet.AsSpan(5));
        return packet;
    }

    private static byte[] BuildPesPacket(byte streamId, ReadOnlySpan<byte> payload, long pts90Khz)
    {
        const int optionalHeaderLength = 8;
        var packetLength = optionalHeaderLength + payload.Length;
        var encodedLength = packetLength <= ushort.MaxValue ? packetLength : 0;
        var pes = new byte[14 + payload.Length];
        pes[0] = 0x00;
        pes[1] = 0x00;
        pes[2] = 0x01;
        pes[3] = streamId;
        pes[4] = (byte)(encodedLength >> 8);
        pes[5] = (byte)encodedLength;
        pes[6] = 0x80;
        pes[7] = 0x80;
        pes[8] = 0x05;
        WritePts(pes.AsSpan(9, 5), pts90Khz);
        payload.CopyTo(pes.AsSpan(14));
        return pes;
    }

    private static void WritePts(Span<byte> destination, long pts)
    {
        pts &= 0x1_FFFF_FFFFL;
        destination[0] = (byte)(0x20 | (((pts >> 30) & 0x07) << 1) | 0x01);
        destination[1] = (byte)(pts >> 22);
        destination[2] = (byte)((((pts >> 15) & 0x7F) << 1) | 0x01);
        destination[3] = (byte)(pts >> 7);
        destination[4] = (byte)(((pts & 0x7F) << 1) | 0x01);
    }

    private static void PacketizePes(
        int pid,
        ReadOnlySpan<byte> pes,
        long pcr90Khz,
        bool includePcrOnFirstPacket,
        ref byte continuity,
        List<byte[]> output)
    {
        var offset = 0;
        var first = true;
        while (offset < pes.Length)
        {
            var packet = CreateStuffedPacket();
            var includePcr = first && includePcrOnFirstPacket;
            var maxPayload = includePcr ? 176 : 184;
            var payloadLength = Math.Min(maxPayload, pes.Length - offset);
            var needsAdaptation = includePcr || payloadLength < 184;
            WriteHeader(packet, pid, first, needsAdaptation, NextContinuity(ref continuity));

            var payloadOffset = 4;
            if (needsAdaptation)
            {
                var adaptationTotalBytes = 184 - payloadLength;
                var adaptationLength = adaptationTotalBytes - 1;
                packet[4] = (byte)adaptationLength;
                if (adaptationLength > 0)
                {
                    packet[5] = includePcr ? (byte)0x10 : (byte)0x00;
                    if (includePcr)
                    {
                        if (adaptationLength < 7) throw new InvalidOperationException("PCR adaptation field is too small.");
                        WritePcr(packet.AsSpan(6, 6), pcr90Khz);
                    }
                }
                payloadOffset += adaptationTotalBytes;
            }

            pes.Slice(offset, payloadLength).CopyTo(packet.AsSpan(payloadOffset, payloadLength));
            output.Add(packet);
            offset += payloadLength;
            first = false;
        }
    }

    private static void WritePcr(Span<byte> destination, long pcrBase)
    {
        pcrBase &= 0x1_FFFF_FFFFL;
        destination[0] = (byte)(pcrBase >> 25);
        destination[1] = (byte)(pcrBase >> 17);
        destination[2] = (byte)(pcrBase >> 9);
        destination[3] = (byte)(pcrBase >> 1);
        destination[4] = (byte)(((pcrBase & 0x01) << 7) | 0x7E);
        destination[5] = 0x00;
    }

    private static void WriteHeader(byte[] packet, int pid, bool payloadUnitStart, bool adaptationAndPayload, byte continuity)
    {
        packet[0] = 0x47;
        packet[1] = (byte)((payloadUnitStart ? 0x40 : 0x00) | ((pid >> 8) & 0x1F));
        packet[2] = (byte)(pid & 0xFF);
        packet[3] = (byte)((adaptationAndPayload ? 0x30 : 0x10) | (continuity & 0x0F));
    }

    private static byte NextContinuity(ref byte continuity)
    {
        var current = (byte)(continuity & 0x0F);
        continuity = (byte)((continuity + 1) & 0x0F);
        return current;
    }

    private static byte[] CreateStuffedPacket()
    {
        var packet = new byte[PacketSize];
        Array.Fill(packet, (byte)0xFF);
        return packet;
    }
}
