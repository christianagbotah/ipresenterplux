using System.Buffers.Binary;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public static class AudioLevelMeter
{
    public static double CalculateRmsDb(AudioFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (frame.BytesRecorded <= 0 || frame.BytesRecorded > frame.Buffer.Length) return -120d;
        if (frame.Channels <= 0 || frame.SampleRate <= 0) return -120d;

        var bytes = frame.Buffer.Span[..frame.BytesRecorded];
        var (sumSquares, samples) = frame.Encoding switch
        {
            AudioSampleEncoding.IeeeFloat when frame.BitsPerSample == 32 => Float32(bytes),
            AudioSampleEncoding.PcmInteger when frame.BitsPerSample == 16 => Pcm16(bytes),
            AudioSampleEncoding.PcmInteger when frame.BitsPerSample == 24 => Pcm24(bytes),
            AudioSampleEncoding.PcmInteger when frame.BitsPerSample == 32 => Pcm32(bytes),
            _ => (0d, 0L)
        };

        if (samples == 0 || sumSquares <= 0) return -120d;
        var rms = Math.Sqrt(sumSquares / samples);
        if (!double.IsFinite(rms) || rms <= 0) return -120d;
        return Math.Clamp(20d * Math.Log10(rms), -120d, 0d);
    }

    private static (double SumSquares, long Samples) Float32(ReadOnlySpan<byte> bytes)
    {
        var count = bytes.Length / 4;
        double sum = 0;
        for (var i = 0; i < count; i++)
        {
            var bits = BinaryPrimitives.ReadInt32LittleEndian(bytes.Slice(i * 4, 4));
            var sample = BitConverter.Int32BitsToSingle(bits);
            if (!float.IsFinite(sample)) continue;
            var normalized = Math.Clamp(sample, -1f, 1f);
            sum += normalized * normalized;
        }
        return (sum, count);
    }

    private static (double SumSquares, long Samples) Pcm16(ReadOnlySpan<byte> bytes)
    {
        var count = bytes.Length / 2;
        double sum = 0;
        for (var i = 0; i < count; i++)
        {
            var sample = BinaryPrimitives.ReadInt16LittleEndian(bytes.Slice(i * 2, 2)) / 32768d;
            sum += sample * sample;
        }
        return (sum, count);
    }

    private static (double SumSquares, long Samples) Pcm24(ReadOnlySpan<byte> bytes)
    {
        var count = bytes.Length / 3;
        double sum = 0;
        for (var i = 0; i < count; i++)
        {
            var offset = i * 3;
            var value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
            if ((value & 0x0080_0000) != 0) value |= unchecked((int)0xFF00_0000);
            var sample = value / 8_388_608d;
            sum += sample * sample;
        }
        return (sum, count);
    }

    private static (double SumSquares, long Samples) Pcm32(ReadOnlySpan<byte> bytes)
    {
        var count = bytes.Length / 4;
        double sum = 0;
        for (var i = 0; i < count; i++)
        {
            var sample = BinaryPrimitives.ReadInt32LittleEndian(bytes.Slice(i * 4, 4)) / 2_147_483_648d;
            sum += sample * sample;
        }
        return (sum, count);
    }
}
