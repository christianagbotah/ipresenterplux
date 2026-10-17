using System.Globalization;
using iPresenterPlux.Edge.Core.Abstractions;

namespace iPresenterPlux.Edge.Core.Models;

public sealed record MediaSourceState(
    Guid? ServiceId,
    string SourceId,
    string Name,
    string SourceType,
    string Status,
    DateTimeOffset ObservedAt,
    IReadOnlyDictionary<string, string> Metadata)
{
    public static MediaSourceState FromVisual(
        Guid? serviceId,
        VisualSourceDescriptor source,
        VisualCaptureStatus? captureStatus,
        VisualRouteSnapshot route)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(route);

        var availability = captureStatus?.Availability ?? source.Availability;
        var previewActive = route.Preview is { Confirmed: true } preview &&
            string.Equals(preview.SourceId, source.SourceId, StringComparison.Ordinal);
        var programActive = !route.UsingRenderedProgram && route.Program is { Confirmed: true } program &&
            string.Equals(program.SourceId, source.SourceId, StringComparison.Ordinal);
        var mode = source.Modes.FirstOrDefault();
        var metadata = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["captureStatus"] = AvailabilityToken(availability),
            ["width"] = (mode?.Width ?? 0).ToString(CultureInfo.InvariantCulture),
            ["height"] = (mode?.Height ?? 0).ToString(CultureInfo.InvariantCulture),
            ["fps"] = (mode?.FramesPerSecond ?? 0).ToString(CultureInfo.InvariantCulture),
            ["previewActive"] = previewActive ? "true" : "false",
            ["programActive"] = programActive ? "true" : "false",
            ["framesCaptured"] = (captureStatus?.FramesCaptured ?? 0).ToString(CultureInfo.InvariantCulture),
            ["droppedFrames"] = (captureStatus?.DroppedFrames ?? 0).ToString(CultureInfo.InvariantCulture)
        };

        var errorCode = captureStatus?.ErrorCode ?? source.ErrorCode;
        if (!string.IsNullOrWhiteSpace(errorCode)) metadata["errorCode"] = Bound(errorCode, 80);
        if (source.Metadata.TryGetValue("processName", out var processName) && !string.IsNullOrWhiteSpace(processName))
            metadata["processName"] = Bound(processName, 160);
        if (source.Metadata.TryGetValue("displayPrimary", out var displayPrimary) && !string.IsNullOrWhiteSpace(displayPrimary))
            metadata["displayPrimary"] = Bound(displayPrimary, 16);

        var wireStatus = availability switch
        {
            VisualSourceAvailability.Available => programActive ? "live" : "ready",
            VisualSourceAvailability.Disconnected => "offline",
            VisualSourceAvailability.Error => "error",
            _ => "warning"
        };

        return new MediaSourceState(
            serviceId,
            source.SourceId,
            Bound(source.Name, 160),
            source.Kind.ToString().ToLowerInvariant(),
            wireStatus,
            source.ObservedAt,
            metadata);
    }

    private static string AvailabilityToken(VisualSourceAvailability availability) => availability switch
    {
        VisualSourceAvailability.Available => "available",
        VisualSourceAvailability.Busy => "busy",
        VisualSourceAvailability.PermissionRequired => "permission_required",
        VisualSourceAvailability.Disconnected => "disconnected",
        VisualSourceAvailability.Unsupported => "unsupported",
        VisualSourceAvailability.Error => "error",
        _ => "error"
    };

    private static string Bound(string value, int maxLength)
    {
        var trimmed = value.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }
}
