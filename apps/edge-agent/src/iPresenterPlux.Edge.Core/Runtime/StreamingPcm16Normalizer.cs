using System.Buffers.Binary;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class StreamingPcm16Normalizer(int targetSampleRate = 16_000)
{
    private readonly int _targetSampleRate = targetSampleRate > 0
        ? targetSampleRate
        : throw new ArgumentOutOfRangeException(nameof(targetSampleRate));
    private int _inputSampleRate;
    private double _nextPosition;

    public int TargetSampleRate => _targetSampleRate;

    public short[] Process(AudioFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (frame.SampleRate <= 0 || frame.Channels <= 0 || frame.BytesRecorded <= 0 || frame.BytesRecorded > frame.Buffer.Length)
            return Array.Empty<short>();
        if (_inputSampleRate != frame.SampleRate)
        {
            _inputSampleRate = frame.SampleRate;
            _nextPosition = 0;
        }

        var mono = DecodeMono(frame);
        if (mono.Length == 0) return Array.Empty<short>();
        var step = frame.SampleRate / (double)_targetSampleRate;
        var output = new List<short>((int)Math.Ceiling(mono.Length / step) + 1);
        while (_nextPosition < mono.Length)
        {
            var left = (int)Math.Floor(_nextPosition);
            var right = Math.Min(left + 1, mono.Length - 1);
            var fraction = _nextPosition - left;
            var sample = mono[left] + (mono[right] - mono[left]) * fraction;
            sample = Math.Clamp(sample, -1d, 1d);
            output.Add((short)Math.Round(sample * (sample < 0 ? 32768d : 32767d)));
            _nextPosition += step;
        }
        _nextPosition -= mono.Length;
        return output.ToArray();
    }

    public void Reset()
    {
        _inputSampleRate = 0;
        _nextPosition = 0;
    }

    private static double[] DecodeMono(AudioFrame frame)
    {
        var bytesPerSample = frame.BitsPerSample / 8;
        if (bytesPerSample is not (2 or 3 or 4)) return Array.Empty<double>();
        var sampleFrames = frame.BytesRecorded / (bytesPerSample * frame.Channels);
        if (sampleFrames <= 0) return Array.Empty<double>();
        var bytes = frame.Buffer.Span[..frame.BytesRecorded];
        var mono = new double[sampleFrames];
        for (var frameIndex = 0; frameIndex < sampleFrames; frameIndex++)
        {
            double sum = 0;
            for (var channel = 0; channel < frame.Channels; channel++)
            {
                var offset = (frameIndex * frame.Channels + channel) * bytesPerSample;
                sum += DecodeSample(bytes.Slice(offset, bytesPerSample), frame.Encoding, frame.BitsPerSample);
            }
            mono[frameIndex] = sum / frame.Channels;
        }
        return mono;
    }

    private static double DecodeSample(ReadOnlySpan<byte> bytes, AudioSampleEncoding encoding, int bitsPerSample)
    {
        if (encoding == AudioSampleEncoding.IeeeFloat && bitsPerSample == 32)
        {
            var value = BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(bytes));
            return float.IsFinite(value) ? Math.Clamp(value, -1f, 1f) : 0d;
        }
        return bitsPerSample switch
        {
            16 => BinaryPrimitives.ReadInt16LittleEndian(bytes) / 32768d,
            24 => DecodePcm24(bytes) / 8_388_608d,
            32 => BinaryPrimitives.ReadInt32LittleEndian(bytes) / 2_147_483_648d,
            _ => 0d
        };
    }

    private static int DecodePcm24(ReadOnlySpan<byte> bytes)
    {
        var value = bytes[0] | bytes[1] << 8 | bytes[2] << 16;
        if ((value & 0x0080_0000) != 0) value |= unchecked((int)0xFF00_0000);
        return value;
    }
}
