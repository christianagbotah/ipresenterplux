using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class ProgramAudioMixer
{
    public const int OutputSampleRate = 48_000;
    public const int OutputChannels = 2;
    public const int OutputBitsPerSample = 16;
    public const int DefaultFrameSamples = 960;

    private readonly object _gate = new();
    private readonly StreamingStereoPcm16Normalizer _liveNormalizer = new(OutputSampleRate);
    private readonly StreamingStereoPcm16Normalizer _mediaNormalizer = new(OutputSampleRate);

    public AudioFrame Mix(AudioFrame? live, AudioFrame? media, float mediaVolume)
    {
        if (!float.IsFinite(mediaVolume) || mediaVolume is < 0f or > 1f)
            throw new ArgumentOutOfRangeException(nameof(mediaVolume), "Media volume must be between 0 and 1.");
        ValidateFrame(live, nameof(live));
        ValidateFrame(media, nameof(media));

        lock (_gate)
        {
            var liveSamples = live is null ? Array.Empty<short>() : _liveNormalizer.Process(live);
            var mediaSamples = media is null ? Array.Empty<short>() : _mediaNormalizer.Process(media);
            var sampleCount = Math.Max(liveSamples.Length, mediaSamples.Length);
            if (sampleCount == 0) sampleCount = DefaultFrameSamples * OutputChannels;
            if ((sampleCount & 1) != 0) sampleCount++;

            var mixed = new short[sampleCount];
            for (var index = 0; index < sampleCount; index++)
            {
                var liveValue = index < liveSamples.Length ? liveSamples[index] : 0;
                var mediaValue = index < mediaSamples.Length
                    ? (int)Math.Round(mediaSamples[index] * mediaVolume)
                    : 0;
                mixed[index] = (short)Math.Clamp(liveValue + mediaValue, short.MinValue, short.MaxValue);
            }

            var bytes = new byte[checked(mixed.Length * sizeof(short))];
            Buffer.BlockCopy(mixed, 0, bytes, 0, bytes.Length);
            return new AudioFrame(
                bytes,
                bytes.Length,
                OutputSampleRate,
                OutputChannels,
                OutputBitsPerSample,
                live?.CapturedAt ?? media?.CapturedAt ?? DateTimeOffset.UtcNow,
                AudioSampleEncoding.PcmInteger);
        }
    }

    public void Reset()
    {
        lock (_gate)
        {
            _liveNormalizer.Reset();
            _mediaNormalizer.Reset();
        }
    }

    private static void ValidateFrame(AudioFrame? frame, string parameterName)
    {
        if (frame is null) return;
        if (frame.BytesRecorded <= 0 || frame.BytesRecorded > frame.Buffer.Length ||
            frame.SampleRate <= 0 || frame.Channels <= 0 || frame.BitsPerSample <= 0 ||
            frame.BitsPerSample % 8 != 0 ||
            frame.BytesRecorded % Math.Max(1, (frame.BitsPerSample / 8) * frame.Channels) != 0)
        {
            throw new ArgumentException("Audio frame is malformed.", parameterName);
        }
        if (frame.BitsPerSample is not (16 or 24 or 32))
            throw new ArgumentException("Audio frame sample format is unsupported.", parameterName);
        if (frame.Encoding == AudioSampleEncoding.IeeeFloat && frame.BitsPerSample != 32)
            throw new ArgumentException("IEEE float audio must use 32-bit samples.", parameterName);
    }
}
