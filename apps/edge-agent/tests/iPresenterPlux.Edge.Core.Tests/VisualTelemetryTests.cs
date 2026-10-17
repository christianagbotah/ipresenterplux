using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class VisualTelemetryTests
{
    [Theory]
    [InlineData(VisualSourceKind.Camera, "camera")]
    [InlineData(VisualSourceKind.Display, "display")]
    [InlineData(VisualSourceKind.Window, "window")]
    public void MapsVisualKindToWireSourceType(VisualSourceKind kind, string expected)
    {
        var source = Descriptor(kind, VisualSourceAvailability.Available);

        var state = MediaSourceState.FromVisual(null, source, null, new VisualRouteSnapshot(null, null, true));

        Assert.Equal(expected, state.SourceType);
        Assert.Equal("ready", state.Status);
    }

    [Theory]
    [InlineData(VisualSourceAvailability.Available, false, "ready")]
    [InlineData(VisualSourceAvailability.Available, true, "live")]
    [InlineData(VisualSourceAvailability.Busy, false, "warning")]
    [InlineData(VisualSourceAvailability.PermissionRequired, false, "warning")]
    [InlineData(VisualSourceAvailability.Disconnected, false, "offline")]
    [InlineData(VisualSourceAvailability.Unsupported, false, "warning")]
    [InlineData(VisualSourceAvailability.Error, false, "error")]
    public void MapsAvailabilityAndProgramFlagToBackwardCompatibleWireStatus(
        VisualSourceAvailability availability,
        bool programActive,
        string expected)
    {
        var source = Descriptor(VisualSourceKind.Camera, availability);
        var program = programActive ? Slot(source) : null;
        var route = new VisualRouteSnapshot(null, program, !programActive);

        var state = MediaSourceState.FromVisual(null, source, null, route);

        Assert.Equal(expected, state.Status);
    }


    [Fact]
    public void WindowTelemetryUsesProcessIdentityInsteadOfArbitraryDescriptorTitle()
    {
        var source = new VisualSourceDescriptor(
            VisualSourceIdentity.Create("windows", VisualSourceKind.Window, "window-1"),
            VisualSourceKind.Window,
            "Board Meeting - confidential payroll.xlsx",
            "window-1",
            VisualSourceAvailability.Available,
            [new VisualCaptureMode(1920, 1080, 30, "bgra32")],
            DateTimeOffset.Parse("2026-10-17T12:00:00Z"),
            null,
            new Dictionary<string, string> { ["processName"] = "Microsoft Excel" });

        var state = MediaSourceState.FromVisual(null, source, null, new VisualRouteSnapshot(null, null, true));

        Assert.Equal("Microsoft Excel", state.Name);
        Assert.DoesNotContain("payroll", state.Name, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void WindowTelemetryFallsBackToGenericNameWhenProcessIdentityIsUnavailable()
    {
        var source = new VisualSourceDescriptor(
            VisualSourceIdentity.Create("windows", VisualSourceKind.Window, "window-2"),
            VisualSourceKind.Window,
            "Private sermon notes - salary review",
            "window-2",
            VisualSourceAvailability.Available,
            [new VisualCaptureMode(1920, 1080, 30, "bgra32")],
            DateTimeOffset.Parse("2026-10-17T12:00:00Z"),
            null,
            new Dictionary<string, string>());

        var state = MediaSourceState.FromVisual(null, source, null, new VisualRouteSnapshot(null, null, true));

        Assert.Equal("Application window", state.Name);
    }

    [Fact]
    public void EmitsOnlyAllowlistedBoundedVisualMetadata()
    {
        var source = Descriptor(
            VisualSourceKind.Window,
            VisualSourceAvailability.Available,
            new Dictionary<string, string>
            {
                ["processName"] = new string('p', 500),
                ["displayPrimary"] = "true",
                ["windowTitle"] = "Confidential board meeting",
                ["path"] = @"C:\Users\Pastor\Secrets\slides.pptx",
                ["token"] = "do-not-send",
                ["frameBytes"] = "deadbeef",
                ["nativeMonitorHandle"] = "deadbeef"
            });
        var capture = new VisualCaptureStatus(true, VisualSourceAvailability.Available, 123, 4, DateTimeOffset.UtcNow, "capture_problem");
        var route = new VisualRouteSnapshot(Slot(source), Slot(source), false);

        var state = MediaSourceState.FromVisual(Guid.NewGuid(), source, capture, route);

        var expectedKeys = new[]
        {
            "captureStatus", "width", "height", "fps", "previewActive", "programActive",
            "framesCaptured", "droppedFrames", "errorCode", "processName", "displayPrimary"
        };
        Assert.Equal(expectedKeys.Order(), state.Metadata.Keys.Order());
        Assert.Equal("true", state.Metadata["previewActive"]);
        Assert.Equal("true", state.Metadata["programActive"]);
        Assert.Equal("123", state.Metadata["framesCaptured"]);
        Assert.Equal("4", state.Metadata["droppedFrames"]);
        Assert.True(state.Metadata["processName"].Length <= 160);
        Assert.DoesNotContain("windowTitle", state.Metadata.Keys);
        Assert.DoesNotContain("path", state.Metadata.Keys);
        Assert.DoesNotContain("token", state.Metadata.Keys);
        Assert.DoesNotContain("frameBytes", state.Metadata.Keys);
        Assert.DoesNotContain("nativeMonitorHandle", state.Metadata.Keys);
    }

    [Fact]
    public void VisualOutboundEventNeverSerializesNativeKeyOrArbitraryMetadata()
    {
        var identity = new AgentIdentity(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "Edge", "1.0.0");
        var source = Descriptor(
            VisualSourceKind.Window,
            VisualSourceAvailability.Available,
            new Dictionary<string, string>
            {
                ["processName"] = "PowerPoint",
                ["windowTitle"] = "Private sermon notes",
                ["secret"] = "do-not-send"
            },
            nativeKey: @"C:\Users\Pastor\Private\sermon.pptx");
        var route = new VisualRouteSnapshot(Slot(source), null, true);

        var outbound = OutboundEventFactory.VisualMedia(identity, null, source, null, route, Guid.NewGuid());

        Assert.Contains("PowerPoint", outbound.PayloadJson, StringComparison.Ordinal);
        Assert.DoesNotContain(source.NativeKey, outbound.PayloadJson, StringComparison.Ordinal);
        Assert.DoesNotContain("Private sermon notes", outbound.PayloadJson, StringComparison.Ordinal);
        Assert.DoesNotContain("do-not-send", outbound.PayloadJson, StringComparison.Ordinal);
        Assert.DoesNotContain("nativeKey", outbound.PayloadJson, StringComparison.OrdinalIgnoreCase);
    }

    private static VisualSourceDescriptor Descriptor(
        VisualSourceKind kind,
        VisualSourceAvailability availability,
        IReadOnlyDictionary<string, string>? metadata = null,
        string nativeKey = "native-source") =>
        new(
            VisualSourceIdentity.Create("windows", kind, nativeKey),
            kind,
            kind == VisualSourceKind.Window ? "PowerPoint" : $"Test {kind}",
            nativeKey,
            availability,
            [new VisualCaptureMode(1920, 1080, 30, "bgra32")],
            DateTimeOffset.Parse("2026-10-17T12:00:00Z"),
            availability == VisualSourceAvailability.Error ? "capture_error" : null,
            metadata ?? new Dictionary<string, string>());

    private static VisualRouteSlot Slot(VisualSourceDescriptor source) =>
        new(source.SourceId, source.Kind, source.Availability, true, source.ErrorCode);
}
