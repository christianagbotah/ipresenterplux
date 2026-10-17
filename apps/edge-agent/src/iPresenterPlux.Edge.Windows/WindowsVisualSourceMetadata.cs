using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Windows;

public sealed record WindowsNativeCamera(string NativeId, string Name);

public sealed record WindowsNativeDisplay(
    nint Handle,
    string DeviceName,
    string DeviceId,
    int X,
    int Y,
    int Width,
    int Height,
    bool IsPrimary);

public sealed record WindowsNativeWindow(
    nint Handle,
    int ProcessId,
    string ProcessName,
    string ExecutableIdentity);

internal static class WindowsVisualSourceMetadata
{
    public static VisualSourceDescriptor Camera(WindowsNativeCamera record, DateTimeOffset observedAt)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(record.NativeId);
        var nativeKey = record.NativeId.Trim();
        var name = string.IsNullOrWhiteSpace(record.Name) ? "Camera" : record.Name.Trim();
        return new VisualSourceDescriptor(
            VisualSourceIdentity.Create("windows", VisualSourceKind.Camera, nativeKey),
            VisualSourceKind.Camera,
            name,
            nativeKey,
            VisualSourceAvailability.Available,
            [],
            observedAt,
            null,
            EmptyMetadata());
    }

    public static VisualSourceDescriptor Display(WindowsNativeDisplay record, DateTimeOffset observedAt)
    {
        var stableIdentity = string.IsNullOrWhiteSpace(record.DeviceId)
            ? record.DeviceName
            : record.DeviceId;
        ArgumentException.ThrowIfNullOrWhiteSpace(stableIdentity);
        if (record.Width <= 0) throw new ArgumentOutOfRangeException(nameof(record), "Display width must be positive.");
        if (record.Height <= 0) throw new ArgumentOutOfRangeException(nameof(record), "Display height must be positive.");

        var nativeKey = $"display:{stableIdentity.Trim().ToLowerInvariant()}";
        var name = string.IsNullOrWhiteSpace(record.DeviceName) ? "Display" : record.DeviceName.Trim();
        return new VisualSourceDescriptor(
            VisualSourceIdentity.Create("windows", VisualSourceKind.Display, nativeKey),
            VisualSourceKind.Display,
            name,
            nativeKey,
            VisualSourceAvailability.Available,
            [new VisualCaptureMode(record.Width, record.Height, 30, "bgra32")],
            observedAt,
            null,
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["displayPrimary"] = record.IsPrimary ? "true" : "false"
            });
    }

    public static VisualSourceDescriptor Window(WindowsNativeWindow record, DateTimeOffset observedAt)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(record.ProcessName);
        ArgumentException.ThrowIfNullOrWhiteSpace(record.ExecutableIdentity);
        if (record.Handle == 0) throw new ArgumentOutOfRangeException(nameof(record), "Window handle is required.");

        var processName = record.ProcessName.Trim();
        var executableIdentity = record.ExecutableIdentity.Trim().ToLowerInvariant();
        var nativeKey = $"window:{executableIdentity}|hwnd:{record.Handle.ToInt64():x}";
        return new VisualSourceDescriptor(
            VisualSourceIdentity.Create("windows", VisualSourceKind.Window, nativeKey),
            VisualSourceKind.Window,
            processName,
            nativeKey,
            VisualSourceAvailability.Available,
            [],
            observedAt,
            null,
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["processName"] = processName
            });
    }

    public static bool IsInternalWindow(WindowsNativeWindow record) =>
        record.ProcessName.Trim().StartsWith("iPresenterPlux", StringComparison.OrdinalIgnoreCase);

    private static IReadOnlyDictionary<string, string> EmptyMetadata() =>
        new Dictionary<string, string>(StringComparer.Ordinal);
}
