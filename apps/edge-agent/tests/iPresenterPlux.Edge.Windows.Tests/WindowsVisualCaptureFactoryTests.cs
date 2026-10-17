using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Windows;
using Xunit;

namespace iPresenterPlux.Edge.Windows.Tests;

public sealed class WindowsVisualCaptureFactoryTests
{
    [Theory]
    [InlineData(VisualSourceKind.Camera, typeof(WindowsCameraCaptureSession))]
    [InlineData(VisualSourceKind.Display, typeof(WindowsGraphicsCaptureSession))]
    [InlineData(VisualSourceKind.Window, typeof(WindowsGraphicsCaptureSession))]
    public async Task DispatchesSourceKindToCorrectNativeSession(VisualSourceKind kind, Type expectedType)
    {
        var factory = new WindowsVisualCaptureFactory();
        var source = Source(kind);

        await using var session = await factory.CreateAsync(
            source,
            new VisualCaptureOptions(1920, 1080, 30),
            CancellationToken.None);

        Assert.IsType(expectedType, session);
        Assert.Same(source, session.Source);
    }

    [Fact]
    public async Task HonorsCancellationBeforeCreatingNativeSession()
    {
        var factory = new WindowsVisualCaptureFactory();
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAsync<OperationCanceledException>(async () =>
            await factory.CreateAsync(Source(VisualSourceKind.Camera), new VisualCaptureOptions(1920, 1080, 30), cts.Token));
    }

    private static VisualSourceDescriptor Source(VisualSourceKind kind)
    {
        var nativeKey = kind switch
        {
            VisualSourceKind.Camera => "camera:test",
            VisualSourceKind.Display => "display:test",
            _ => "window:powerpnt|hwnd:123"
        };
        return new VisualSourceDescriptor(
            VisualSourceIdentity.Create("windows", kind, nativeKey),
            kind,
            $"Test {kind}",
            nativeKey,
            VisualSourceAvailability.Available,
            [new VisualCaptureMode(1920, 1080, 30, "bgra32")],
            DateTimeOffset.Parse("2026-10-17T14:30:00Z"),
            null,
            kind == VisualSourceKind.Display
                ? new Dictionary<string, string> { ["nativeMonitorHandle"] = "123" }
                : new Dictionary<string, string>());
    }
}
