namespace iPresenterPlux.Edge.Core.Models;

public enum VisualSourceKind
{
    Camera,
    Display,
    Window
}

public enum VisualSourceAvailability
{
    Available,
    Busy,
    PermissionRequired,
    Disconnected,
    Unsupported,
    Error
}

public sealed record VisualCaptureMode
{
    public VisualCaptureMode(int width, int height, int framesPerSecond, string pixelFormat)
    {
        if (width <= 0) throw new ArgumentOutOfRangeException(nameof(width));
        if (height <= 0) throw new ArgumentOutOfRangeException(nameof(height));
        if (framesPerSecond <= 0) throw new ArgumentOutOfRangeException(nameof(framesPerSecond));
        if (string.IsNullOrWhiteSpace(pixelFormat)) throw new ArgumentException("Pixel format is required.", nameof(pixelFormat));
        Width = width;
        Height = height;
        FramesPerSecond = framesPerSecond;
        PixelFormat = pixelFormat.Trim().ToLowerInvariant();
    }

    public int Width { get; }
    public int Height { get; }
    public int FramesPerSecond { get; }
    public string PixelFormat { get; }
}

public sealed record VisualCaptureOptions
{
    public VisualCaptureOptions(int width, int height, int framesPerSecond, string pixelFormat = "bgra32")
    {
        if (width <= 0) throw new ArgumentOutOfRangeException(nameof(width));
        if (height <= 0) throw new ArgumentOutOfRangeException(nameof(height));
        if (framesPerSecond <= 0) throw new ArgumentOutOfRangeException(nameof(framesPerSecond));
        if (string.IsNullOrWhiteSpace(pixelFormat)) throw new ArgumentException("Pixel format is required.", nameof(pixelFormat));
        Width = width;
        Height = height;
        FramesPerSecond = framesPerSecond;
        PixelFormat = pixelFormat.Trim().ToLowerInvariant();
    }

    public int Width { get; }
    public int Height { get; }
    public int FramesPerSecond { get; }
    public string PixelFormat { get; }
}

public sealed record VisualCaptureStatus(
    bool IsRunning,
    VisualSourceAvailability Availability,
    long FramesCaptured,
    long DroppedFrames,
    DateTimeOffset? LastFrameAt,
    string? ErrorCode);

public sealed record VisualSourceDescriptor
{
    public VisualSourceDescriptor(
        string sourceId,
        VisualSourceKind kind,
        string name,
        string nativeKey,
        VisualSourceAvailability availability,
        IReadOnlyList<VisualCaptureMode> modes,
        DateTimeOffset observedAt,
        string? errorCode,
        IReadOnlyDictionary<string, string> metadata)
    {
        if (string.IsNullOrWhiteSpace(sourceId)) throw new ArgumentException("Source ID is required.", nameof(sourceId));
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("Source name is required.", nameof(name));
        if (string.IsNullOrWhiteSpace(nativeKey)) throw new ArgumentException("Native key is required.", nameof(nativeKey));
        SourceId = sourceId.Trim();
        Kind = kind;
        Name = name.Trim();
        NativeKey = nativeKey;
        Availability = availability;
        Modes = modes ?? throw new ArgumentNullException(nameof(modes));
        ObservedAt = observedAt;
        ErrorCode = string.IsNullOrWhiteSpace(errorCode) ? null : errorCode.Trim();
        Metadata = metadata ?? throw new ArgumentNullException(nameof(metadata));
    }

    public string SourceId { get; }
    public VisualSourceKind Kind { get; }
    public string Name { get; }
    public string NativeKey { get; }
    public VisualSourceAvailability Availability { get; }
    public IReadOnlyList<VisualCaptureMode> Modes { get; }
    public DateTimeOffset ObservedAt { get; }
    public string? ErrorCode { get; }
    public IReadOnlyDictionary<string, string> Metadata { get; }
}
