using System.Buffers.Binary;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class StreamingStereoPcm16Normalizer(int targetSampleRate = 48_000)
{
    private readonly int _targetSampleRate = targetSampleRate is 44_100 or 48_000
        ? targetSampleRate
        : throw new ArgumentOutOfRangeException(nameof(targetSampleRate), "Broadcast PCM target must be 44.1 kHz or 48 kHz.");
    private int _inputSampleRate;
    private double _nextPosition;

    public int TargetSampleRate => _targetSampleRate;
    public int TargetChannels => 2;
    public int TargetBitsPerSample => 16;

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

        var (left, right) = DecodeStereo(frame);
        if (left.Length == 0 || right.Length != left.Length) return Array.Empty<short>();

        var step = frame.SampleRate / (double)_targetSampleRate;
        var outputFrames = Math.Max(1, (int)Math.Ceiling(left.Length / step) + 1);
        var output = new List<short>(checked(outputFrames * 2));
        while (_nextPosition < left.Length)
        {
            var index = (int)Math.Floor(_nextPosition);
            var next = Math.Min(index + 1, left.Length - 1);
            var fraction = _nextPosition - index;
            var l = left[index] + (left[next] - left[index]) * fraction;
            var r = right[index] + (right[next] - right[index]) * fraction;
            output.Add(ToPcm16(l));
            output.Add(ToPcm16(r));
            _nextPosition += step;
        }
        _nextPosition -= left.Length;
        return output.ToArray();
    }

    public void Reset()
    {
        _inputSampleRate = 0;
        _nextPosition = 0;
    }

    private static (double[] Left, double[] Right) DecodeStereo(AudioFrame frame)
    {
        var bytesPerSample = frame.BitsPerSample / 8;
        if (bytesPerSample is not (2 or 3 or 4)) return (Array.Empty<double>(), Array.Empty<double>());
        var sampleFrames = frame.BytesRecorded / (bytesPerSample * frame.Channels);
        if (sampleFrames <= 0) return (Array.Empty<double>(), Array.Empty<double>());

        var bytes = frame.Buffer.Span[..frame.BytesRecorded];
        var left = new double[sampleFrames];
        var right = new double[sampleFrames];
        for (var frameIndex = 0; frameIndex < sampleFrames; frameIndex++)
        {
            if (frame.Channels == 1)
            {
                var value = DecodeSample(bytes.Slice(frameIndex * bytesPerSample, bytesPerSample), frame.Encoding, frame.BitsPerSample);
                left[frameIndex] = value;
                right[frameIndex] = value;
                continue;
            }

            if (frame.Channels == 2)
            {
                var baseOffset = frameIndex * 2 * bytesPerSample;
                left[frameIndex] = DecodeSample(bytes.Slice(baseOffset, bytesPerSample), frame.Encoding, frame.BitsPerSample);
                right[frameIndex] = DecodeSample(bytes.Slice(baseOffset + bytesPerSample, bytesPerSample), frame.Encoding, frame.BitsPerSample);
                continue;
            }

            // Without a channel mask, the only deterministic safe downmix for arbitrary
            // multichannel capture is an equal-power-neutral average duplicated to stereo.
            double sum = 0;
            for (var channel = 0; channel < frame.Channels; channel++)
            {
                var offset = (frameIndex * frame.Channels + channel) * bytesPerSample;
                sum += DecodeSample(bytes.Slice(offset, bytesPerSample), frame.Encoding, frame.BitsPerSample);
            }
            var mono = sum / frame.Channels;
            left[frameIndex] = mono;
            right[frameIndex] = mono;
        }
        return (left, right);
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

    private static short ToPcm16(double sample)
    {
        sample = Math.Clamp(sample, -1d, 1d);
        return (short)Math.Round(sample * (sample < 0 ? 32768d : 32767d));
    }
}
