using SharpMediaFoundationInterop.Transforms;
using SharpMediaFoundationInterop.Utils;
using Windows.Win32;
using Windows.Win32.Media.MediaFoundation;

namespace iPresenterPlux.Edge.Windows;

internal sealed class AdtsAacEncoder : AudioTransformBase
{
    private const uint SamplesPerPacket = 1024;
    private readonly uint _bitrateBps;

    public AdtsAacEncoder(uint channels, uint sampleRate, uint bitrateBps)
        : base(CalculatePacketDuration(sampleRate), channels, sampleRate, 16)
    {
        if (channels != 2) throw new ArgumentOutOfRangeException(nameof(channels));
        if (sampleRate is not (44_100u or 48_000u)) throw new ArgumentOutOfRangeException(nameof(sampleRate));
        if (bitrateBps is not (96_000u or 128_000u or 160_000u or 192_000u))
            throw new ArgumentOutOfRangeException(nameof(bitrateBps));
        _bitrateBps = bitrateBps;
    }

    public override Guid InputFormat => PInvoke.MFAudioFormat_PCM;

    public override Guid OutputFormat => PInvoke.MFAudioFormat_AAC;

    protected override IMFTransform Create()
    {
        const uint streamId = 0;
        var input = new MFT_REGISTER_TYPE_INFO
        {
            guidMajorType = PInvoke.MFMediaType_Audio,
            guidSubtype = InputFormat
        };
        var output = new MFT_REGISTER_TYPE_INFO
        {
            guidMajorType = PInvoke.MFMediaType_Audio,
            guidSubtype = OutputFormat
        };

        var transform = CreateTransform(
            PInvoke.MFT_CATEGORY_AUDIO_ENCODER,
            MFT_ENUM_FLAG.MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG.MFT_ENUM_FLAG_HARDWARE,
            input,
            output) ?? CreateTransform(
                PInvoke.MFT_CATEGORY_AUDIO_ENCODER,
                MFT_ENUM_FLAG.MFT_ENUM_FLAG_SYNCMFT,
                input,
                output) ?? throw new NotSupportedException("No synchronous Media Foundation AAC encoder is available.");

        MediaUtils.Check(PInvoke.MFCreateMediaType(out IMFMediaType mediaOutput));
        mediaOutput.SetGUID(PInvoke.MF_MT_MAJOR_TYPE, PInvoke.MFMediaType_Audio);
        mediaOutput.SetGUID(PInvoke.MF_MT_SUBTYPE, OutputFormat);
        mediaOutput.SetUINT32(PInvoke.MF_MT_AUDIO_BITS_PER_SAMPLE, BitsPerSample);
        mediaOutput.SetUINT32(PInvoke.MF_MT_AUDIO_SAMPLES_PER_SECOND, SampleRate);
        mediaOutput.SetUINT32(PInvoke.MF_MT_AUDIO_NUM_CHANNELS, Channels);
        mediaOutput.SetUINT32(PInvoke.MF_MT_AUDIO_AVG_BYTES_PER_SECOND, _bitrateBps / 8);
        mediaOutput.SetUINT32(PInvoke.MF_MT_AAC_PAYLOAD_TYPE, 1); // ADTS AAC on Windows 8+.
        MediaUtils.Check(transform.SetOutputType(streamId, mediaOutput, 0));

        MediaUtils.Check(PInvoke.MFCreateMediaType(out IMFMediaType mediaInput));
        mediaInput.SetGUID(PInvoke.MF_MT_MAJOR_TYPE, PInvoke.MFMediaType_Audio);
        mediaInput.SetGUID(PInvoke.MF_MT_SUBTYPE, InputFormat);
        mediaInput.SetUINT32(PInvoke.MF_MT_AUDIO_BITS_PER_SAMPLE, BitsPerSample);
        mediaInput.SetUINT32(PInvoke.MF_MT_AUDIO_SAMPLES_PER_SECOND, SampleRate);
        mediaInput.SetUINT32(PInvoke.MF_MT_AUDIO_NUM_CHANNELS, Channels);
        mediaInput.SetUINT32(PInvoke.MF_MT_AUDIO_BLOCK_ALIGNMENT, Channels * 2);
        mediaInput.SetUINT32(PInvoke.MF_MT_AUDIO_AVG_BYTES_PER_SECOND, SampleRate * Channels * 2);
        mediaInput.SetUINT32(PInvoke.MF_MT_ALL_SAMPLES_INDEPENDENT, 1);
        MediaUtils.Check(transform.SetInputType(streamId, mediaInput, 0));

        return transform;
    }

    private static long CalculatePacketDuration(uint sampleRate)
    {
        if (sampleRate == 0) throw new ArgumentOutOfRangeException(nameof(sampleRate));
        return checked((long)(SamplesPerPacket * 10_000_000UL / sampleRate));
    }
}
