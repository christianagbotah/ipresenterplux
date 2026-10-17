using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class VisualProgramRouterFailureTests
{
    [Fact]
    public async Task HoldsLastGoodProgramFrameUntilJustBeforeTwoSeconds()
    {
        var clock = new ManualTimeProvider(new DateTimeOffset(2026, 10, 17, 12, 0, 0, TimeSpan.Zero));
        var source = Descriptor("camera-a");
        var lastGood = Frame("camera-a", clock.GetUtcNow());
        var session = new MutableSession(source, lastGood, clock);
        await using var router = new VisualProgramRouter(new FakeCatalog([source]), new FakeFactory(session), new StaticProgramSource(Frame("rendered", clock.GetUtcNow())), clock);
        await router.SelectPreviewAsync(source.SourceId, CancellationToken.None);
        await router.TakePreviewAsync(CancellationToken.None);
        Assert.Equal(lastGood, router.GetCurrentFrame());

        session.Disconnect();
        clock.Advance(TimeSpan.FromMilliseconds(1999));

        Assert.Equal(lastGood, router.GetCurrentFrame());
    }

    [Fact]
    public async Task ReturnsSafeBlackAtTwoSecondsAfterProgramDisconnect()
    {
        var clock = new ManualTimeProvider(new DateTimeOffset(2026, 10, 17, 12, 0, 0, TimeSpan.Zero));
        var source = Descriptor("camera-a");
        var lastGood = Frame("camera-a", clock.GetUtcNow());
        var session = new MutableSession(source, lastGood, clock);
        await using var router = new VisualProgramRouter(new FakeCatalog([source]), new FakeFactory(session), new StaticProgramSource(Frame("rendered", clock.GetUtcNow())), clock);
        await router.SelectPreviewAsync(source.SourceId, CancellationToken.None);
        await router.TakePreviewAsync(CancellationToken.None);
        _ = router.GetCurrentFrame();

        session.Disconnect();
        clock.Advance(TimeSpan.FromSeconds(2));
        var frame = router.GetCurrentFrame();

        Assert.NotEqual(lastGood, frame);
        Assert.Equal(lastGood.Width, frame.Width);
        Assert.Equal(lastGood.Height, frame.Height);
        Assert.Equal("bgra32", frame.PixelFormat);
        Assert.All(frame.Buffer.ToArray(), value => Assert.Equal((byte)0, value));
    }

    [Fact]
    public async Task FreshFrameBeforeTwoSecondsCancelsBlackFallback()
    {
        var clock = new ManualTimeProvider(new DateTimeOffset(2026, 10, 17, 12, 0, 0, TimeSpan.Zero));
        var source = Descriptor("camera-a");
        var first = Frame("camera-a-1", clock.GetUtcNow());
        var session = new MutableSession(source, first, clock);
        await using var router = new VisualProgramRouter(new FakeCatalog([source]), new FakeFactory(session), new StaticProgramSource(Frame("rendered", clock.GetUtcNow())), clock);
        await router.SelectPreviewAsync(source.SourceId, CancellationToken.None);
        await router.TakePreviewAsync(CancellationToken.None);
        _ = router.GetCurrentFrame();

        session.Disconnect();
        clock.Advance(TimeSpan.FromMilliseconds(1500));
        var resumed = Frame("camera-a-2", clock.GetUtcNow());
        session.Resume(resumed);
        clock.Advance(TimeSpan.FromSeconds(1));

        Assert.Equal(resumed, router.GetCurrentFrame());
    }

    [Fact]
    public async Task PreviewDisconnectReleasesPreviewWithoutChangingProgram()
    {
        var clock = new ManualTimeProvider(new DateTimeOffset(2026, 10, 17, 12, 0, 0, TimeSpan.Zero));
        var a = Descriptor("camera-a");
        var b = Descriptor("camera-b");
        var sessionA = new MutableSession(a, Frame("camera-a", clock.GetUtcNow()), clock);
        var sessionB = new MutableSession(b, Frame("camera-b", clock.GetUtcNow()), clock);
        await using var router = new VisualProgramRouter(new FakeCatalog([a, b]), new FakeFactory(sessionA, sessionB), new StaticProgramSource(Frame("rendered", clock.GetUtcNow())), clock);
        await router.SelectPreviewAsync(a.SourceId, CancellationToken.None);
        await router.TakePreviewAsync(CancellationToken.None);
        await router.SelectPreviewAsync(b.SourceId, CancellationToken.None);

        sessionB.Disconnect();
        await WaitUntilAsync(() => router.Snapshot.Preview is null);

        Assert.Equal(a.SourceId, router.Snapshot.Program?.SourceId);
        Assert.Equal("camera-a", router.GetCurrentFrame().ItemId);
        Assert.Equal(1, sessionB.DisposeCount);
        Assert.Equal(0, sessionA.DisposeCount);
    }

    private static async Task WaitUntilAsync(Func<bool> predicate)
    {
        for (var i = 0; i < 100; i++)
        {
            if (predicate()) return;
            await Task.Delay(10);
        }
        Assert.True(predicate(), "Condition was not reached before timeout.");
    }

    private static VisualSourceDescriptor Descriptor(string nativeKey) =>
        new(
            VisualSourceIdentity.Create("windows", VisualSourceKind.Camera, nativeKey),
            VisualSourceKind.Camera,
            nativeKey,
            nativeKey,
            VisualSourceAvailability.Available,
            [new VisualCaptureMode(2, 2, 30, "bgra32")],
            DateTimeOffset.UtcNow,
            null,
            new Dictionary<string, string>());

    private static ProgramVideoFrame Frame(string itemId, DateTimeOffset at) =>
        new(2, 2, 8, "bgra32", Enumerable.Repeat((byte)7, 16).ToArray(), itemId, at);

    private sealed class ManualTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan amount) => _now = _now.Add(amount);
    }

    private sealed class StaticProgramSource(ProgramVideoFrame frame) : IProgramVideoSource
    {
        public ProgramVideoFrame GetCurrentFrame() => frame;
    }

    private sealed class FakeCatalog(IReadOnlyList<VisualSourceDescriptor> sources) : IVisualSourceCatalog
    {
        public Task<IReadOnlyList<VisualSourceDescriptor>> ScanAsync(CancellationToken cancellationToken) => Task.FromResult(sources);
    }

    private sealed class FakeFactory(params MutableSession[] sessions) : IVisualCaptureFactory
    {
        private readonly Queue<MutableSession> _sessions = new(sessions);
        public ValueTask<IVisualCaptureSession> CreateAsync(VisualSourceDescriptor source, VisualCaptureOptions options, CancellationToken cancellationToken) =>
            ValueTask.FromResult<IVisualCaptureSession>(_sessions.Dequeue());
    }

    private sealed class MutableSession(VisualSourceDescriptor source, ProgramVideoFrame frame, TimeProvider clock) : IVisualCaptureSession
    {
        public event EventHandler? StatusChanged;
        public VisualSourceDescriptor Source { get; } = source;
        public VisualCaptureStatus Status { get; private set; } = new(false, VisualSourceAvailability.Disconnected, 0, 0, null, null);
        public ProgramVideoFrame? LatestFrame { get; private set; } = frame;
        public int DisposeCount { get; private set; }

        public Task<VisualCaptureStatus> StartAsync(CancellationToken cancellationToken)
        {
            Status = new(true, VisualSourceAvailability.Available, 1, 0, clock.GetUtcNow(), null);
            StatusChanged?.Invoke(this, EventArgs.Empty);
            return Task.FromResult(Status);
        }

        public Task<VisualCaptureStatus> StopAsync(CancellationToken cancellationToken)
        {
            Status = Status with { IsRunning = false };
            StatusChanged?.Invoke(this, EventArgs.Empty);
            return Task.FromResult(Status);
        }

        public void Disconnect()
        {
            Status = Status with { IsRunning = false, Availability = VisualSourceAvailability.Disconnected, ErrorCode = "source_disconnected" };
            StatusChanged?.Invoke(this, EventArgs.Empty);
        }

        public void Resume(ProgramVideoFrame frame)
        {
            LatestFrame = frame;
            Status = Status with { IsRunning = true, Availability = VisualSourceAvailability.Available, FramesCaptured = Status.FramesCaptured + 1, LastFrameAt = clock.GetUtcNow(), ErrorCode = null };
            StatusChanged?.Invoke(this, EventArgs.Empty);
        }

        public ValueTask DisposeAsync()
        {
            DisposeCount++;
            return ValueTask.CompletedTask;
        }
    }
}
