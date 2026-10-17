using System.Runtime.InteropServices;
using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Windows;
using Xunit;

namespace iPresenterPlux.Edge.Windows.Tests;

public sealed class WindowsCameraCaptureSessionTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-17T13:05:00Z");
    private static readonly VisualCaptureOptions Requested = new(1920, 1080, 30);

    [Fact]
    public async Task StartStopRestartAndLateFrameAfterStopIsIgnored()
    {
        var reader = new FakeCameraReader(new WindowsCameraModeCandidate(1280, 720, 30, 1, Guid.NewGuid()));
        await using var session = new WindowsCameraCaptureSession(Source(), Requested, reader, new FixedTimeProvider(Now));

        var started = await session.StartAsync(CancellationToken.None);
        Assert.True(started.IsRunning);
        Assert.Equal(VisualSourceAvailability.Available, started.Availability);
        Assert.Equal(1, reader.StartCalls);

        var firstBuffer = Enumerable.Repeat((byte)0x11, 1280 * 720 * 4).ToArray();
        reader.EmitFrame(new WindowsCameraFrame(1280, 720, 1280 * 4, firstBuffer, Now));
        Assert.NotNull(session.LatestFrame);
        Assert.Equal((byte)0x11, session.LatestFrame!.Buffer.Span[0]);

        var stopped = await session.StopAsync(CancellationToken.None);
        Assert.False(stopped.IsRunning);
        var frameAfterStop = session.LatestFrame;
        reader.EmitFrame(new WindowsCameraFrame(1280, 720, 1280 * 4, new byte[1280 * 720 * 4], Now.AddSeconds(1)));
        Assert.Same(frameAfterStop, session.LatestFrame);

        var restarted = await session.StartAsync(CancellationToken.None);
        Assert.True(restarted.IsRunning);
        Assert.Equal(2, reader.StartCalls);
    }

    [Theory]
    [InlineData((int)WindowsCameraReaderFailureKind.Busy, VisualSourceAvailability.Busy, "camera_busy")]
    [InlineData((int)WindowsCameraReaderFailureKind.Permission, VisualSourceAvailability.PermissionRequired, "camera_permission")]
    [InlineData((int)WindowsCameraReaderFailureKind.Unsupported, VisualSourceAvailability.Unsupported, "camera_unsupported")]
    [InlineData((int)WindowsCameraReaderFailureKind.Disconnected, VisualSourceAvailability.Disconnected, "camera_disconnected")]
    [InlineData((int)WindowsCameraReaderFailureKind.Capture, VisualSourceAvailability.Error, "camera_capture_failed")]
    public async Task StartFailureMapsToStableOperatorStatus(
        int failureValue,
        VisualSourceAvailability expectedAvailability,
        string expectedCode)
    {
        var reader = new FakeCameraReader(new WindowsCameraModeCandidate(1920, 1080, 30, 1, Guid.NewGuid()))
        {
            StartFailure = new WindowsCameraReaderException((WindowsCameraReaderFailureKind)failureValue, "native failure")
        };
        await using var session = new WindowsCameraCaptureSession(Source(), Requested, reader, new FixedTimeProvider(Now));

        var status = await session.StartAsync(CancellationToken.None);

        Assert.False(status.IsRunning);
        Assert.Equal(expectedAvailability, status.Availability);
        Assert.Equal(expectedCode, status.ErrorCode);
        Assert.Null(session.LatestFrame);
    }

    [Fact]
    public async Task DisconnectDuringCaptureTransitionsWithoutPublishingAnotherFrame()
    {
        var reader = new FakeCameraReader(new WindowsCameraModeCandidate(1920, 1080, 30, 1, Guid.NewGuid()));
        await using var session = new WindowsCameraCaptureSession(Source(), Requested, reader, new FixedTimeProvider(Now));
        await session.StartAsync(CancellationToken.None);
        reader.EmitFrame(Frame(0x31));
        var lastGood = session.LatestFrame;
        var statusChanges = 0;
        session.StatusChanged += (_, _) => statusChanges++;

        reader.EmitFault(new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Disconnected, "unplugged"));
        reader.EmitFrame(Frame(0x52));

        Assert.False(session.Status.IsRunning);
        Assert.Equal(VisualSourceAvailability.Disconnected, session.Status.Availability);
        Assert.Equal("camera_disconnected", session.Status.ErrorCode);
        Assert.Same(lastGood, session.LatestFrame);
        Assert.True(statusChanges >= 1);
    }

    [Fact]
    public async Task LatestFrameSlotReplacesStaleFrameInsteadOfQueueing()
    {
        var reader = new FakeCameraReader(new WindowsCameraModeCandidate(1920, 1080, 30, 1, Guid.NewGuid()));
        await using var session = new WindowsCameraCaptureSession(Source(), Requested, reader, new FixedTimeProvider(Now));
        await session.StartAsync(CancellationToken.None);

        reader.EmitFrame(Frame(0x01));
        reader.EmitFrame(Frame(0x02));

        Assert.Equal((byte)0x02, session.LatestFrame!.Buffer.Span[0]);
        Assert.Equal(2, session.Status.FramesCaptured);
        Assert.Equal(1, session.Status.DroppedFrames);
        Assert.Equal("bgra32", session.LatestFrame.PixelFormat);
    }


    [Theory]
    [InlineData(unchecked((int)0x80070005), (int)WindowsCameraReaderFailureKind.Permission)]
    [InlineData(unchecked((int)0x80070020), (int)WindowsCameraReaderFailureKind.Busy)]
    [InlineData(unchecked((int)0x800700AA), (int)WindowsCameraReaderFailureKind.Busy)]
    [InlineData(unchecked((int)0xC00D3EA3), (int)WindowsCameraReaderFailureKind.Busy)]
    [InlineData(unchecked((int)0xC00D3EA2), (int)WindowsCameraReaderFailureKind.Disconnected)]
    [InlineData(unchecked((int)0xC00D3E98), (int)WindowsCameraReaderFailureKind.Unsupported)]
    public void NativeFailureMappingUsesStableCameraFailureKinds(int hresult, int expectedKindValue)
    {
        var mapped = WindowsMediaFoundationCameraReader.MapNativeFailure(new COMException("native", hresult), opening: true);

        Assert.Equal((WindowsCameraReaderFailureKind)expectedKindValue, mapped.Kind);
    }

    [Fact]
    public void ModeSelectionPrefersExactRequestedModeAndRejectsOver60Fps()
    {
        var modes = new[]
        {
            new WindowsCameraModeCandidate(3840, 2160, 30, 1, Guid.NewGuid()),
            new WindowsCameraModeCandidate(1920, 1080, 75, 1, Guid.NewGuid()),
            new WindowsCameraModeCandidate(1280, 720, 30, 1, Guid.NewGuid()),
            new WindowsCameraModeCandidate(1920, 1080, 30000, 1001, Guid.NewGuid())
        };

        var selected = WindowsMediaFoundationCameraReader.SelectBestMode(modes, Requested);

        Assert.Equal(1920, selected.Width);
        Assert.Equal(1080, selected.Height);
        Assert.InRange(selected.FramesPerSecond, 29.9, 30.1);
    }

    [Fact]
    public void ModeSelectionFallsBackToClosestSupportedMode()
    {
        var modes = new[]
        {
            new WindowsCameraModeCandidate(2560, 1440, 30, 1, Guid.NewGuid()),
            new WindowsCameraModeCandidate(1600, 900, 30, 1, Guid.NewGuid()),
            new WindowsCameraModeCandidate(1920, 1080, 120, 1, Guid.NewGuid())
        };

        var selected = WindowsMediaFoundationCameraReader.SelectBestMode(modes, Requested);

        Assert.Equal(1600, selected.Width);
        Assert.Equal(900, selected.Height);
        Assert.Equal(30d, selected.FramesPerSecond);
    }

    [Fact]
    public void ModeSelectionFailsWhenAllModesExceed60Fps()
    {
        var modes = new[]
        {
            new WindowsCameraModeCandidate(1920, 1080, 120, 1, Guid.NewGuid()),
            new WindowsCameraModeCandidate(1280, 720, 90, 1, Guid.NewGuid())
        };

        var error = Assert.Throws<WindowsCameraReaderException>(() =>
            WindowsMediaFoundationCameraReader.SelectBestMode(modes, Requested));

        Assert.Equal(WindowsCameraReaderFailureKind.Unsupported, error.Kind);
    }

    private static VisualSourceDescriptor Source() => new(
        VisualSourceIdentity.Create("windows", VisualSourceKind.Camera, "camera-symbolic-link-a"),
        VisualSourceKind.Camera,
        "USB Camera",
        "camera-symbolic-link-a",
        VisualSourceAvailability.Available,
        [],
        Now,
        null,
        new Dictionary<string, string>());

    private static WindowsCameraFrame Frame(byte value) =>
        new(1920, 1080, 1920 * 4, Enumerable.Repeat(value, 1920 * 1080 * 4).ToArray(), Now);

    private sealed class FakeCameraReader(WindowsCameraModeCandidate startMode) : IWindowsCameraReader
    {
        public event EventHandler<WindowsCameraFrame>? FrameReceived;
        public event EventHandler<WindowsCameraReaderException>? Faulted;
        public WindowsCameraReaderException? StartFailure { get; set; }
        public int StartCalls { get; private set; }
        public int StopCalls { get; private set; }

        public Task<WindowsCameraModeCandidate> StartAsync(
            string nativeId,
            VisualCaptureOptions options,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            StartCalls++;
            if (StartFailure is not null) throw StartFailure;
            return Task.FromResult(startMode);
        }

        public Task StopAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            StopCalls++;
            return Task.CompletedTask;
        }

        public void EmitFrame(WindowsCameraFrame frame) => FrameReceived?.Invoke(this, frame);
        public void EmitFault(WindowsCameraReaderException error) => Faulted?.Invoke(this, error);
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
