using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class ContributionMasterStreamPublisherTests
{
    [Fact]
    public async Task SameServiceStartIsIdempotentAndUsesOneGrant()
    {
        var serviceId = Guid.NewGuid();
        var grants = new FakeContributionClient();
        var transport = new FakeTransport();
        await using var publisher = new ContributionMasterStreamPublisher(grants, transport, new FixedTimeProvider());

        var first = await publisher.StartAsync(serviceId, CancellationToken.None);
        var second = await publisher.StartAsync(serviceId, CancellationToken.None);

        Assert.True(first.IsPublishing);
        Assert.True(second.IsPublishing);
        Assert.Equal(serviceId, second.ServiceId);
        Assert.Equal(1, grants.Calls);
        Assert.Equal(1, transport.StartCount);
        Assert.Equal(0, transport.StopCount);
    }

    [Fact]
    public async Task DifferentServiceStopsOldPublisherBeforeGettingFreshGrant()
    {
        var firstService = Guid.NewGuid();
        var secondService = Guid.NewGuid();
        var grants = new FakeContributionClient();
        var transport = new FakeTransport();
        await using var publisher = new ContributionMasterStreamPublisher(grants, transport, new FixedTimeProvider());

        await publisher.StartAsync(firstService, CancellationToken.None);
        var second = await publisher.StartAsync(secondService, CancellationToken.None);

        Assert.True(second.IsPublishing);
        Assert.Equal(secondService, second.ServiceId);
        Assert.Equal(2, grants.Calls);
        Assert.Equal(new[] { firstService, secondService }, grants.Services);
        Assert.Equal(2, transport.StartCount);
        Assert.Equal(1, transport.StopCount);
    }

    [Fact]
    public async Task ServiceReassignmentStopsCurrentPublisher()
    {
        var serviceId = Guid.NewGuid();
        var grants = new FakeContributionClient();
        var transport = new FakeTransport();
        await using var publisher = new ContributionMasterStreamPublisher(grants, transport, new FixedTimeProvider());
        await publisher.StartAsync(serviceId, CancellationToken.None);

        await publisher.HandleActiveServiceAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.False(publisher.Status.IsPublishing);
        Assert.Null(publisher.Status.ServiceId);
        Assert.Equal("idle", publisher.Status.State);
        Assert.Equal(1, transport.StopCount);
    }

    [Fact]
    public async Task GrantFailureDoesNotTouchTransportOrLeakDetails()
    {
        var grants = new FakeContributionClient(new HttpRequestException("srt://edge:secret@router.invalid"));
        var transport = new FakeTransport();
        await using var publisher = new ContributionMasterStreamPublisher(grants, transport, new FixedTimeProvider());

        var status = await publisher.StartAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.False(status.IsPublishing);
        Assert.Equal("error", status.State);
        Assert.Equal("contribution_unavailable", status.ErrorCode);
        Assert.DoesNotContain("secret", status.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, transport.StartCount);
    }

    [Fact]
    public async Task UnknownTransportErrorIsReducedToAllowlistedCode()
    {
        var transport = new FakeTransport
        {
            StartResult = new ContributionStreamTransportStatus(
                false, "error", null, null, 0, 0, null,
                "srt://router.invalid?streamid=publish:path:edge:super-secret")
        };
        await using var publisher = new ContributionMasterStreamPublisher(
            new FakeContributionClient(), transport, new FixedTimeProvider());

        var status = await publisher.StartAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.False(status.IsPublishing);
        Assert.Equal("publisher_error", status.ErrorCode);
        Assert.DoesNotContain("super-secret", status.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task InvalidTransportTelemetryIsDroppedInsteadOfSurfaced()
    {
        var transport = new FakeTransport
        {
            StartResult = new ContributionStreamTransportStatus(
                true, "publishing", -5, 5001, -9, -3,
                DateTimeOffset.Parse("2026-10-06T02:00:00Z"), null)
        };
        await using var publisher = new ContributionMasterStreamPublisher(
            new FakeContributionClient(), transport, new FixedTimeProvider());

        var status = await publisher.StartAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.True(status.IsPublishing);
        Assert.Null(status.BitrateBps);
        Assert.Null(status.FramesPerSecond);
        Assert.Equal(0, status.DroppedFrames);
        Assert.Equal(0, status.ReconnectCount);
    }

    [Fact]
    public async Task StopIsIdempotent()
    {
        var transport = new FakeTransport();
        await using var publisher = new ContributionMasterStreamPublisher(
            new FakeContributionClient(), transport, new FixedTimeProvider());
        await publisher.StartAsync(Guid.NewGuid(), CancellationToken.None);

        var first = await publisher.StopAsync(CancellationToken.None);
        var second = await publisher.StopAsync(CancellationToken.None);

        Assert.False(first.IsPublishing);
        Assert.False(second.IsPublishing);
        Assert.Equal("idle", second.State);
        Assert.Equal(1, transport.StopCount);
    }

    [Fact]
    public async Task PublisherOwnsAndDisposesTransport()
    {
        var transport = new FakeTransport();
        var publisher = new ContributionMasterStreamPublisher(
            new FakeContributionClient(), transport, new FixedTimeProvider());

        await publisher.DisposeAsync();

        Assert.Equal(1, transport.DisposeCount);
    }

    private sealed class FakeContributionClient(Exception? error = null) : IStreamContributionClient
    {
        public int Calls { get; private set; }
        public List<Guid> Services { get; } = new();

        public Task<StreamContributionGrant> GetAsync(Guid expectedServiceId, CancellationToken cancellationToken)
        {
            Calls++;
            Services.Add(expectedServiceId);
            if (error is not null) return Task.FromException<StreamContributionGrant>(error);
            var sessionId = Guid.NewGuid();
            var path = $"edge-{sessionId:D}";
            return Task.FromResult(new StreamContributionGrant(
                sessionId,
                expectedServiceId,
                path,
                "srt",
                new Uri($"srt://router.test:8890?streamid=publish%3A{path}%3Aedge%3Aone-time-secret&pkt_size=1316"),
                DateTimeOffset.Parse("2026-10-06T02:05:00Z")));
        }
    }

    private sealed class FakeTransport : IContributionStreamTransport
    {
        private ContributionStreamTransportStatus _status = Idle();
        public int StartCount { get; private set; }
        public int StopCount { get; private set; }
        public int DisposeCount { get; private set; }
        public ContributionStreamTransportStatus? StartResult { get; init; }
        public ContributionStreamTransportStatus Status => _status;

        public Task<ContributionStreamTransportStatus> StartAsync(StreamContributionGrant grant, CancellationToken cancellationToken)
        {
            StartCount++;
            _status = StartResult ?? new ContributionStreamTransportStatus(
                true, "publishing", 4_500_000, 30, 0, 0,
                DateTimeOffset.Parse("2026-10-06T02:00:00Z"), null);
            return Task.FromResult(_status);
        }

        public Task<ContributionStreamTransportStatus> StopAsync(CancellationToken cancellationToken)
        {
            StopCount++;
            _status = Idle();
            return Task.FromResult(_status);
        }

        public ValueTask DisposeAsync()
        {
            DisposeCount++;
            return ValueTask.CompletedTask;
        }

        private static ContributionStreamTransportStatus Idle() =>
            new(false, "idle", null, null, 0, 0, null, null);
    }

    private sealed class FixedTimeProvider : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => DateTimeOffset.Parse("2026-10-06T02:00:00Z");
    }
}
