using SharpMediaFoundationInterop.Transforms;
using SharpMediaFoundationInterop.Utils;
using Windows.Win32;
using Windows.Win32.Media.MediaFoundation;

namespace iPresenterPlux.Edge.Windows;

internal sealed class ExactH264Encoder : VideoTransformBase
{
    private readonly uint _averageBitrate;

    public ExactH264Encoder(uint width, uint height, uint framesPerSecond, uint averageBitrate)
        : base(width, height)
    {
        if (width == 0 || height == 0) throw new ArgumentOutOfRangeException(nameof(width));
        if (framesPerSecond == 0) throw new ArgumentOutOfRangeException(nameof(framesPerSecond));
        if (averageBitrate < 250_000) throw new ArgumentOutOfRangeException(nameof(averageBitrate));
        FramesPerSecond = framesPerSecond;
        _averageBitrate = averageBitrate;
    }

    public uint FramesPerSecond { get; }

    public override Guid InputFormat => PInvoke.MFVideoFormat_NV12;

    public override Guid OutputFormat => PInvoke.MFVideoFormat_H264;

    protected override IMFTransform Create()
    {
        const uint streamId = 0;
        var input = new MFT_REGISTER_TYPE_INFO
        {
            guidMajorType = PInvoke.MFMediaType_Video,
            guidSubtype = InputFormat
        };
        var output = new MFT_REGISTER_TYPE_INFO
        {
            guidMajorType = PInvoke.MFMediaType_Video,
            guidSubtype = OutputFormat
        };

        var transform = CreateTransform(
            PInvoke.MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG.MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG.MFT_ENUM_FLAG_SORTANDFILTER,
            input,
            output) ?? throw new NotSupportedException("No synchronous Media Foundation H.264 encoder is available.");

        MediaUtils.Check(PInvoke.MFCreateMediaType(out IMFMediaType mediaOutput));
        mediaOutput.SetGUID(PInvoke.MF_MT_MAJOR_TYPE, PInvoke.MFMediaType_Video);
        mediaOutput.SetGUID(PInvoke.MF_MT_SUBTYPE, OutputFormat);
        mediaOutput.SetUINT64(PInvoke.MF_MT_FRAME_SIZE, MediaUtils.EncodeAttributeValue(Width, Height));
        mediaOutput.SetUINT64(PInvoke.MF_MT_FRAME_RATE, MediaUtils.EncodeAttributeValue(FramesPerSecond, 1));
        mediaOutput.SetUINT32(PInvoke.MF_MT_INTERLACE_MODE, (uint)MFVideoInterlaceMode.MFVideoInterlace_Progressive);
        mediaOutput.SetUINT32(PInvoke.MF_MT_AVG_BITRATE, _averageBitrate);
        MediaUtils.Check(transform.SetOutputType(streamId, mediaOutput, 0));

        MediaUtils.Check(PInvoke.MFCreateMediaType(out IMFMediaType mediaInput));
        mediaInput.SetGUID(PInvoke.MF_MT_MAJOR_TYPE, PInvoke.MFMediaType_Video);
        mediaInput.SetGUID(PInvoke.MF_MT_SUBTYPE, InputFormat);
        mediaInput.SetUINT64(PInvoke.MF_MT_FRAME_SIZE, MediaUtils.EncodeAttributeValue(Width, Height));
        mediaInput.SetUINT64(PInvoke.MF_MT_FRAME_RATE, MediaUtils.EncodeAttributeValue(FramesPerSecond, 1));
        mediaInput.SetUINT32(PInvoke.MF_MT_INTERLACE_MODE, (uint)MFVideoInterlaceMode.MFVideoInterlace_Progressive);
        MediaUtils.Check(transform.SetInputType(streamId, mediaInput, 0));

        return transform;
    }
}
