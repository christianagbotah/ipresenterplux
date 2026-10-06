namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed record ProgramVideoCaptureTarget(
    int ProcessId,
    string WindowTitle)
{
    public ProgramVideoCaptureTarget Validate()
    {
        if (ProcessId <= 0) throw new ArgumentOutOfRangeException(nameof(ProcessId));
        if (string.IsNullOrWhiteSpace(WindowTitle)) throw new ArgumentException("Program window title is required.", nameof(WindowTitle));
        return this;
    }
}

public sealed record ProgramVideoCaptureOptions(
    int Width = 1920,
    int Height = 1080,
    int FramesPerSecond = 30,
    int BitrateBps = 6_000_000)
{
    public ProgramVideoCaptureOptions Validate()
    {
        if (Width is < 320 or > 7680) throw new ArgumentOutOfRangeException(nameof(Width));
        if (Height is < 180 or > 4320) throw new ArgumentOutOfRangeException(nameof(Height));
        if (FramesPerSecond is < 1 or > 120) throw new ArgumentOutOfRangeException(nameof(FramesPerSecond));
        if (BitrateBps is < 250_000 or > 100_000_000) throw new ArgumentOutOfRangeException(nameof(BitrateBps));
        return this;
    }
}

public sealed record EncodedProgramVideoFrame(
    ReadOnlyMemory<byte> Data,
    int Width,
    int Height,
    string Codec,
    string Format,
    bool IsKeyFrame,
    long PresentationTimestampMicroseconds);

public sealed record ProgramVideoSourceStatus(
    bool IsCapturing,
    string State,
    long FramesEncoded,
    long DroppedFrames,
    string? ErrorCode);

public interface IEncodedProgramVideoSource : IAsyncDisposable
{
    event EventHandler<EncodedProgramVideoFrame>? FrameEncoded;

    ProgramVideoSourceStatus Status { get; }

    Task<ProgramVideoSourceStatus> StartAsync(
        ProgramVideoCaptureTarget target,
        ProgramVideoCaptureOptions options,
        CancellationToken cancellationToken);

    Task<ProgramVideoSourceStatus> StopAsync(CancellationToken cancellationToken);
}
