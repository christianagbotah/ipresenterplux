namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed record ProgramAudioCaptureOptions(
    int SampleRate = 48_000,
    int Channels = 2,
    int BitrateBps = 192_000)
{
    private static readonly int[] SupportedBitrates = [96_000, 128_000, 160_000, 192_000];

    public ProgramAudioCaptureOptions Validate()
    {
        if (SampleRate is not (44_100 or 48_000))
            throw new ArgumentOutOfRangeException(nameof(SampleRate), "AAC capture must use 44.1 kHz or 48 kHz audio.");
        if (Channels != 2)
            throw new ArgumentOutOfRangeException(nameof(Channels), "Broadcast AAC is currently fixed to stereo.");
        if (!SupportedBitrates.Contains(BitrateBps))
            throw new ArgumentOutOfRangeException(nameof(BitrateBps), "Media Foundation AAC supports 96, 128, 160, or 192 kbps for this stereo pipeline.");
        return this;
    }
}

public sealed record EncodedProgramAudioFrame(
    ReadOnlyMemory<byte> Data,
    int SampleRate,
    int Channels,
    string Codec,
    string Format,
    long PresentationTimestampMicroseconds,
    long DurationMicroseconds);

public sealed record ProgramAudioSourceStatus(
    bool IsCapturing,
    string State,
    Guid? ServiceId,
    long FramesEncoded,
    long DroppedFrames,
    string? ErrorCode);

public interface IEncodedProgramAudioSource : IAsyncDisposable
{
    event EventHandler<EncodedProgramAudioFrame>? FrameEncoded;

    ProgramAudioSourceStatus Status { get; }

    Task<ProgramAudioSourceStatus> StartAsync(
        Guid serviceId,
        ProgramAudioCaptureOptions options,
        CancellationToken cancellationToken);

    Task<ProgramAudioSourceStatus> StopAsync(CancellationToken cancellationToken);
}
