using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Windows;
using Xunit;

namespace iPresenterPlux.Edge.Windows.Tests;

public sealed class WindowsGraphicsCaptureSessionTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-17T13:30:00Z");

    [Fact]
    public async Task FramePumpDoesNotPerformReadbackOnNativeFrameArrivedCallback()
    {
        var pool = new FakeFramePool();
        await using var pump = new WindowsGraphicsFramePump(pool);
        await pump.StartAsync(Source(VisualSourceKind.Display), CancellationToken.None);
        var frame = new FakeNativeFrame(1920, 1080, 0x21) { BlockReadback = true };

        var startedAt = System.Diagnostics.Stopwatch.GetTimestamp();
        pool.Emit(frame);
        var callbackElapsed = System.Diagnostics.Stopwatch.GetElapsedTime(startedAt);

        Assert.True(callbackElapsed < TimeSpan.FromMilliseconds(250), $"FrameArrived blocked for {callbackElapsed}.");
        Assert.True(frame.ReadbackStarted.Wait(TimeSpan.FromSeconds(2)));
        frame.AllowReadback.Set();
        await EventuallyAsync(() => frame.ReadCalls == 1);
    }

    [Fact]
    public async Task PendingNativeFramesAreBoundedToLatestAndStaleFramesAreDisposed()
    {
        var pool = new FakeFramePool();
        await using var pump = new WindowsGraphicsFramePump(pool);
        await pump.StartAsync(Source(VisualSourceKind.Display), CancellationToken.None);
        var first = new FakeNativeFrame(1920, 1080, 0x11) { BlockReadback = true };
        var stale = new FakeNativeFrame(1920, 1080, 0x22);
        var latest = new FakeNativeFrame(1920, 1080, 0x33);
        var delivered = new List<WindowsGraphicsFrame>();
        pump.FrameReady += (_, frame) => delivered.Add(frame);

        pool.Emit(first);
        Assert.True(first.ReadbackStarted.Wait(TimeSpan.FromSeconds(2)));
        pool.Emit(stale);
        pool.Emit(latest);

        Assert.True(stale.Disposed);
        Assert.Equal(0, stale.ReadCalls);
        first.AllowReadback.Set();
        await EventuallyAsync(() => delivered.Count >= 2);
        Assert.Equal((byte)0x33, delivered[^1].Buffer.Span[0]);
        Assert.True(pump.DroppedFrames >= 1);
    }

    [Fact]
    public async Task ResizeRecreatesFramePoolAfterCurrentFrameIsCopied()
    {
        var pool = new FakeFramePool();
        await using var pump = new WindowsGraphicsFramePump(pool);
        await pump.StartAsync(Source(VisualSourceKind.Window), CancellationToken.None);

        pool.Emit(new FakeNativeFrame(1280, 720, 0x41));
        await EventuallyAsync(() => pool.RecreateCalls.Count == 1);

        Assert.Equal((1280, 720), pool.RecreateCalls.Single());
    }

    [Fact]
    public async Task ClosedCaptureItemTransitionsSessionToDisconnected()
    {
        var pool = new FakeFramePool();
        await using var pump = new WindowsGraphicsFramePump(pool);
        await using var session = new WindowsGraphicsCaptureSession(
            Source(VisualSourceKind.Window), new VisualCaptureOptions(1920, 1080, 30), pump, new FixedTimeProvider(Now));
        await session.StartAsync(CancellationToken.None);

        pool.Close();
        await EventuallyAsync(() => session.Status.Availability == VisualSourceAvailability.Disconnected);

        Assert.False(session.Status.IsRunning);
        Assert.Equal("screen_disconnected", session.Status.ErrorCode);
    }

    [Fact]
    public async Task SessionPublishesNormalizedBgraFrameWithSingleLatestSlot()
    {
        var pool = new FakeFramePool();
        await using var pump = new WindowsGraphicsFramePump(pool);
        await using var session = new WindowsGraphicsCaptureSession(
            Source(VisualSourceKind.Display), new VisualCaptureOptions(1920, 1080, 30), pump, new FixedTimeProvider(Now));
        await session.StartAsync(CancellationToken.None);

        pool.Emit(new FakeNativeFrame(1920, 1080, 0x61));
        await EventuallyAsync(() => session.LatestFrame is not null);
        pool.Emit(new FakeNativeFrame(1920, 1080, 0x62));
        await EventuallyAsync(() => session.Status.FramesCaptured == 2);

        Assert.Equal(1920, session.LatestFrame!.Width);
        Assert.Equal(1080, session.LatestFrame.Height);
        Assert.Equal(1920 * 4, session.LatestFrame.Stride);
        Assert.Equal("bgra32", session.LatestFrame.PixelFormat);
        Assert.Equal((byte)0x62, session.LatestFrame.Buffer.Span[0]);
        Assert.Equal(1, session.Status.DroppedFrames);
    }

    [Fact]
    public async Task StopWaitsForInFlightReadbackBeforeStoppingNativePool()
    {
        var pool = new FakeFramePool();
        await using var pump = new WindowsGraphicsFramePump(pool);
        await pump.StartAsync(Source(VisualSourceKind.Display), CancellationToken.None);
        var frame = new FakeNativeFrame(1920, 1080, 0x68) { BlockReadback = true };
        pool.Emit(frame);
        Assert.True(frame.ReadbackStarted.Wait(TimeSpan.FromSeconds(2)));

        var stop = pump.StopAsync(CancellationToken.None);
        await Task.Delay(50);
        Assert.Equal(0, pool.StopCalls);

        frame.AllowReadback.Set();
        await stop;
        Assert.Equal(1, pool.StopCalls);
    }

    [Fact]
    public async Task NativeAcquireDisconnectIsPreservedInsteadOfFlattenedToGenericCaptureFailure()
    {
        var pool = new FakeFramePool
        {
            NextFrameFailure = new WindowsGraphicsCaptureException(
                WindowsGraphicsCaptureFailureKind.Disconnected,
                "gone")
        };
        await using var pump = new WindowsGraphicsFramePump(pool);
        await using var session = new WindowsGraphicsCaptureSession(
            Source(VisualSourceKind.Display), new VisualCaptureOptions(1920, 1080, 30), pump, new FixedTimeProvider(Now));
        await session.StartAsync(CancellationToken.None);

        pool.SignalFrameArrived();
        await EventuallyAsync(() => !session.Status.IsRunning);

        Assert.Equal(VisualSourceAvailability.Disconnected, session.Status.Availability);
        Assert.Equal("screen_disconnected", session.Status.ErrorCode);
    }

    [Fact]
    public async Task StopAndDisposeAreIdempotentAndLateFramesAreIgnored()
    {
        var pool = new FakeFramePool();
        var pump = new WindowsGraphicsFramePump(pool);
        var session = new WindowsGraphicsCaptureSession(
            Source(VisualSourceKind.Display), new VisualCaptureOptions(1920, 1080, 30), pump, new FixedTimeProvider(Now));
        await session.StartAsync(CancellationToken.None);
        await session.StopAsync(CancellationToken.None);
        await session.StopAsync(CancellationToken.None);
        var before = session.LatestFrame;

        pool.Emit(new FakeNativeFrame(1920, 1080, 0x70));
        await Task.Delay(50);
        Assert.Same(before, session.LatestFrame);
        Assert.Equal(1, pool.StopCalls);

        await session.DisposeAsync();
        await session.DisposeAsync();
        Assert.Equal(1, pool.DisposeCalls);
    }

    [Theory]
    [InlineData((int)WindowsGraphicsCaptureFailureKind.Permission, VisualSourceAvailability.PermissionRequired, "screen_permission")]
    [InlineData((int)WindowsGraphicsCaptureFailureKind.Unsupported, VisualSourceAvailability.Unsupported, "screen_unsupported")]
    [InlineData((int)WindowsGraphicsCaptureFailureKind.Disconnected, VisualSourceAvailability.Disconnected, "screen_disconnected")]
    [InlineData((int)WindowsGraphicsCaptureFailureKind.Capture, VisualSourceAvailability.Error, "screen_capture_failed")]
    public async Task NativeFailuresMapToStableScreenStatus(int failureValue, VisualSourceAvailability availability, string code)
    {
        var pool = new FakeFramePool { StartFailure = new WindowsGraphicsCaptureException((WindowsGraphicsCaptureFailureKind)failureValue, "native") };
        await using var pump = new WindowsGraphicsFramePump(pool);
        await using var session = new WindowsGraphicsCaptureSession(
            Source(VisualSourceKind.Display), new VisualCaptureOptions(1920, 1080, 30), pump, new FixedTimeProvider(Now));

        var status = await session.StartAsync(CancellationToken.None);

        Assert.False(status.IsRunning);
        Assert.Equal(availability, status.Availability);
        Assert.Equal(code, status.ErrorCode);
    }

    [Theory]
    [InlineData(unchecked((int)0x80070005), (int)WindowsGraphicsCaptureFailureKind.Permission)]
    [InlineData(unchecked((int)0x80070057), (int)WindowsGraphicsCaptureFailureKind.Disconnected)]
    [InlineData(unchecked((int)0x80070578), (int)WindowsGraphicsCaptureFailureKind.Disconnected)]
    [InlineData(unchecked((int)0x887A0005), (int)WindowsGraphicsCaptureFailureKind.Disconnected)]
    [InlineData(unchecked((int)0x887A0007), (int)WindowsGraphicsCaptureFailureKind.Disconnected)]
    public void NativeFailureMappingUsesStableScreenFailureKinds(int hresult, int expectedKindValue)
    {
        var mapped = WindowsGraphicsNativeFramePool.MapNativeFailure(new System.Runtime.InteropServices.COMException("native", hresult));

        Assert.Equal((WindowsGraphicsCaptureFailureKind)expectedKindValue, mapped.Kind);
    }

    private static VisualSourceDescriptor Source(VisualSourceKind kind)
    {
        var nativeKey = kind == VisualSourceKind.Display ? "display:monitor-1" : "window:powerpnt|hwnd:123";
        return new VisualSourceDescriptor(
            VisualSourceIdentity.Create("windows", kind, nativeKey), kind,
            kind == VisualSourceKind.Display ? "Display 1" : "POWERPNT", nativeKey,
            VisualSourceAvailability.Available, [new VisualCaptureMode(1920, 1080, 30, "bgra32")],
            Now, null, new Dictionary<string, string>());
    }

    private static async Task EventuallyAsync(Func<bool> predicate)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        while (!predicate()) await Task.Delay(10, cts.Token);
    }

    private sealed class FakeFramePool : IWindowsGraphicsNativeFramePool
    {
        private readonly Queue<IWindowsGraphicsNativeFrame> _frames = new();
        public event EventHandler? FrameArrived;
        public event EventHandler? Closed;
        public event EventHandler<WindowsGraphicsCaptureException>? Faulted;
        public WindowsGraphicsCaptureException? StartFailure { get; set; }
        public WindowsGraphicsCaptureException? NextFrameFailure { get; set; }
        public List<(int Width, int Height)> RecreateCalls { get; } = [];
        public int StartCalls { get; private set; }
        public int StopCalls { get; private set; }
        public int DisposeCalls { get; private set; }
        public bool IsRunning { get; private set; }

        public Task StartAsync(VisualSourceDescriptor source, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            StartCalls++;
            if (StartFailure is not null) throw StartFailure;
            IsRunning = true;
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (IsRunning) StopCalls++;
            IsRunning = false;
            return Task.CompletedTask;
        }

        public IWindowsGraphicsNativeFrame? TryGetNextFrame()
        {
            if (NextFrameFailure is not null) throw NextFrameFailure;
            lock (_frames) return _frames.Count == 0 ? null : _frames.Dequeue();
        }

        public void Recreate(int width, int height) => RecreateCalls.Add((width, height));

        public void Emit(IWindowsGraphicsNativeFrame frame)
        {
            lock (_frames) _frames.Enqueue(frame);
            FrameArrived?.Invoke(this, EventArgs.Empty);
        }

        public void SignalFrameArrived() => FrameArrived?.Invoke(this, EventArgs.Empty);
        public void Close() => Closed?.Invoke(this, EventArgs.Empty);
        public void Fail(WindowsGraphicsCaptureException error) => Faulted?.Invoke(this, error);

        public ValueTask DisposeAsync()
        {
            DisposeCalls++;
            return ValueTask.CompletedTask;
        }
    }

    private sealed class FakeNativeFrame(int width, int height, byte value) : IWindowsGraphicsNativeFrame
    {
        public int Width { get; } = width;
        public int Height { get; } = height;
        public int ReadCalls { get; private set; }
        public bool Disposed { get; private set; }
        public bool BlockReadback { get; init; }
        public ManualResetEventSlim ReadbackStarted { get; } = new(false);
        public ManualResetEventSlim AllowReadback { get; } = new(false);

        public WindowsGraphicsFrame ReadBgra32()
        {
            ReadCalls++;
            ReadbackStarted.Set();
            if (BlockReadback) AllowReadback.Wait(TimeSpan.FromSeconds(3));
            var stride = checked(Width * 4);
            return new WindowsGraphicsFrame(Width, Height, stride, Enumerable.Repeat(value, checked(stride * Height)).ToArray(), Now);
        }

        public void Dispose() => Disposed = true;
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
