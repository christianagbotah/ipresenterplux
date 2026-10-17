using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class VisualProgramRouterTests
{
    [Fact]
    public async Task PreviewSelectionDoesNotChangeRenderedProgram()
    {
        var source = Descriptor("camera-a", VisualSourceKind.Camera);
        var fallbackFrame = Frame("rendered");
        var session = new FakeSession(source, Frame("camera-a"));
        await using var router = CreateRouter([source], new FakeFactory(session), fallbackFrame);

        await router.SelectPreviewAsync(source.SourceId, CancellationToken.None);

        Assert.Equal(fallbackFrame, router.GetCurrentFrame());
        Assert.Equal(source.SourceId, router.Snapshot.Preview?.SourceId);
        Assert.Null(router.Snapshot.Program);
        Assert.True(router.Snapshot.UsingRenderedProgram);
    }

    [Fact]
    public async Task ProgramAAndPreviewBUseAtMostTwoSessions()
    {
        var a = Descriptor("camera-a", VisualSourceKind.Camera);
        var b = Descriptor("camera-b", VisualSourceKind.Camera);
        var sessionA = new FakeSession(a, Frame("camera-a"));
        var sessionB = new FakeSession(b, Frame("camera-b"));
        var factory = new FakeFactory(sessionA, sessionB);
        await using var router = CreateRouter([a, b], factory, Frame("rendered"));

        await router.SelectPreviewAsync(a.SourceId, CancellationToken.None);
        await router.TakePreviewAsync(CancellationToken.None);
        await router.SelectPreviewAsync(b.SourceId, CancellationToken.None);

        Assert.Equal(2, factory.CreateCount);
        Assert.Equal(2, factory.ActiveSessionCount);
        Assert.Equal(a.SourceId, router.Snapshot.Program?.SourceId);
        Assert.Equal(b.SourceId, router.Snapshot.Preview?.SourceId);
        Assert.Equal("camera-a", router.GetCurrentFrame().ItemId);
    }

    [Fact]
    public async Task PreviewingCurrentProgramSourceReusesExistingSession()
    {
        var source = Descriptor("camera-a", VisualSourceKind.Camera);
        var session = new FakeSession(source, Frame("camera-a"));
        var factory = new FakeFactory(session);
        await using var router = CreateRouter([source], factory, Frame("rendered"));

        await router.SelectPreviewAsync(source.SourceId, CancellationToken.None);
        await router.TakePreviewAsync(CancellationToken.None);
        await router.SelectPreviewAsync(source.SourceId, CancellationToken.None);
        await router.TakePreviewAsync(CancellationToken.None);

        Assert.Equal(1, factory.CreateCount);
        Assert.Equal(1, factory.ActiveSessionCount);
        Assert.Equal(source.SourceId, router.Snapshot.Program?.SourceId);
        Assert.Null(router.Snapshot.Preview);
    }

    [Fact]
    public async Task TakePromotesPreviewThenReleasesPreviousProgramSession()
    {
        var a = Descriptor("camera-a", VisualSourceKind.Camera);
        var b = Descriptor("camera-b", VisualSourceKind.Camera);
        var sessionA = new FakeSession(a, Frame("camera-a"));
        var sessionB = new FakeSession(b, Frame("camera-b"));
        var factory = new FakeFactory(sessionA, sessionB);
        await using var router = CreateRouter([a, b], factory, Frame("rendered"));

        await router.SelectPreviewAsync(a.SourceId, CancellationToken.None);
        await router.TakePreviewAsync(CancellationToken.None);
        await router.SelectPreviewAsync(b.SourceId, CancellationToken.None);
        Assert.Equal(0, sessionA.DisposeCount);

        await router.TakePreviewAsync(CancellationToken.None);

        Assert.Equal(b.SourceId, router.Snapshot.Program?.SourceId);
        Assert.Null(router.Snapshot.Preview);
        Assert.Equal("camera-b", router.GetCurrentFrame().ItemId);
        Assert.Equal(1, sessionA.DisposeCount);
        Assert.Equal(0, sessionB.DisposeCount);
    }

    [Fact]
    public async Task FailedPreviewStartLeavesProgramUntouched()
    {
        var a = Descriptor("camera-a", VisualSourceKind.Camera);
        var b = Descriptor("camera-b", VisualSourceKind.Camera);
        var sessionA = new FakeSession(a, Frame("camera-a"));
        var sessionB = new FakeSession(b, Frame("camera-b"), startAvailability: VisualSourceAvailability.Busy);
        var factory = new FakeFactory(sessionA, sessionB);
        await using var router = CreateRouter([a, b], factory, Frame("rendered"));
        await router.SelectPreviewAsync(a.SourceId, CancellationToken.None);
        await router.TakePreviewAsync(CancellationToken.None);

        await Assert.ThrowsAsync<InvalidOperationException>(() => router.SelectPreviewAsync(b.SourceId, CancellationToken.None));

        Assert.Equal(a.SourceId, router.Snapshot.Program?.SourceId);
        Assert.Null(router.Snapshot.Preview);
        Assert.Equal("camera-a", router.GetCurrentFrame().ItemId);
        Assert.Equal(0, sessionA.DisposeCount);
        Assert.Equal(1, sessionB.DisposeCount);
    }

    [Fact]
    public async Task UseRenderedProgramReleasesNativeProgram()
    {
        var source = Descriptor("camera-a", VisualSourceKind.Camera);
        var fallbackFrame = Frame("rendered");
        var session = new FakeSession(source, Frame("camera-a"));
        await using var router = CreateRouter([source], new FakeFactory(session), fallbackFrame);
        await router.SelectPreviewAsync(source.SourceId, CancellationToken.None);
        await router.TakePreviewAsync(CancellationToken.None);

        await router.UseRenderedProgramAsync(CancellationToken.None);

        Assert.True(router.Snapshot.UsingRenderedProgram);
        Assert.Null(router.Snapshot.Program);
        Assert.Equal(fallbackFrame, router.GetCurrentFrame());
        Assert.Equal(1, session.DisposeCount);
    }

    private static VisualProgramRouter CreateRouter(
        IReadOnlyList<VisualSourceDescriptor> sources,
        FakeFactory factory,
        ProgramVideoFrame fallbackFrame) =>
        new(new FakeCatalog(sources), factory, new StaticProgramSource(fallbackFrame));

    private static VisualSourceDescriptor Descriptor(string nativeKey, VisualSourceKind kind) =>
        new(
            VisualSourceIdentity.Create("windows", kind, nativeKey),
            kind,
            nativeKey,
            nativeKey,
            VisualSourceAvailability.Available,
            [new VisualCaptureMode(2, 2, 30, "bgra32")],
            DateTimeOffset.UtcNow,
            null,
            new Dictionary<string, string>());

    private static ProgramVideoFrame Frame(string itemId) =>
        new(2, 2, 8, "bgra32", new byte[16], itemId, DateTimeOffset.UtcNow);

    private sealed class StaticProgramSource(ProgramVideoFrame frame) : IProgramVideoSource
    {
        public ProgramVideoFrame GetCurrentFrame() => frame;
    }

    private sealed class FakeCatalog(IReadOnlyList<VisualSourceDescriptor> sources) : IVisualSourceCatalog
    {
        public Task<IReadOnlyList<VisualSourceDescriptor>> ScanAsync(CancellationToken cancellationToken) => Task.FromResult(sources);
    }

    private sealed class FakeFactory(params FakeSession[] sessions) : IVisualCaptureFactory
    {
        private readonly Queue<FakeSession> _sessions = new(sessions);
        public int CreateCount { get; private set; }
        public int ActiveSessionCount => sessions.Count(item => item.StartCount > item.DisposeCount);

        public ValueTask<IVisualCaptureSession> CreateAsync(VisualSourceDescriptor source, VisualCaptureOptions options, CancellationToken cancellationToken)
        {
            CreateCount++;
            var session = _sessions.Dequeue();
            Assert.Equal(source.SourceId, session.Source.SourceId);
            return ValueTask.FromResult<IVisualCaptureSession>(session);
        }
    }

    private sealed class FakeSession(
        VisualSourceDescriptor source,
        ProgramVideoFrame frame,
        VisualSourceAvailability startAvailability = VisualSourceAvailability.Available) : IVisualCaptureSession
    {
        public event EventHandler? StatusChanged;
        public VisualSourceDescriptor Source { get; } = source;
        public ProgramVideoFrame? LatestFrame { get; private set; } = frame;
        public int StartCount { get; private set; }
        public int DisposeCount { get; private set; }
        public VisualCaptureStatus Status { get; private set; } = new(false, VisualSourceAvailability.Disconnected, 0, 0, null, null);

        public Task<VisualCaptureStatus> StartAsync(CancellationToken cancellationToken)
        {
            StartCount++;
            Status = startAvailability == VisualSourceAvailability.Available
                ? new(true, startAvailability, 1, 0, DateTimeOffset.UtcNow, null)
                : new(false, startAvailability, 0, 0, null, startAvailability.ToString().ToLowerInvariant());
            StatusChanged?.Invoke(this, EventArgs.Empty);
            return Task.FromResult(Status);
        }

        public Task<VisualCaptureStatus> StopAsync(CancellationToken cancellationToken)
        {
            Status = Status with { IsRunning = false };
            StatusChanged?.Invoke(this, EventArgs.Empty);
            return Task.FromResult(Status);
        }

        public ValueTask DisposeAsync()
        {
            DisposeCount++;
            Status = Status with { IsRunning = false };
            return ValueTask.CompletedTask;
        }
    }
}
