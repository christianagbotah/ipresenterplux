using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Queues;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class OutboundEventDispatcherTests
{
    [Fact]
    public async Task FlushPublishesAndAcknowledgesTranscript()
    {
        var identity = Identity();
        var queue = new InMemoryOutboundEventQueue();
        var publisher = new FakePublisher();
        var clock = new MutableClock(DateTimeOffset.Parse("2026-10-04T12:00:00Z"));
        var dispatcher = new OutboundEventDispatcher(queue, publisher, clock);
        var segment = new TranscriptSegment(
            Guid.NewGuid(),
            1,
            clock.GetUtcNow(),
            "Please turn to John chapter 3 verse 16.",
            true,
            null,
            "en");
        var outbound = OutboundEventFactory.Transcript(identity, segment, Guid.NewGuid());

        await queue.EnqueueAsync(outbound, CancellationToken.None);
        var result = await dispatcher.FlushAsync(outbound.Scope, 10, CancellationToken.None);

        Assert.Equal(new OutboundDispatchResult(1, 1, 0), result);
        Assert.Single(publisher.Transcripts);
        Assert.Equal(segment, publisher.Transcripts[0]);

        var remaining = await queue.ClaimAsync(
            outbound.Scope,
            10,
            clock.GetUtcNow(),
            TimeSpan.FromMinutes(1),
            CancellationToken.None);
        Assert.Empty(remaining);
    }

    [Fact]
    public async Task FailedPublishSchedulesRetryAndLaterDelivers()
    {
        var identity = Identity();
        var queue = new InMemoryOutboundEventQueue();
        var publisher = new FakePublisher { Fail = true };
        var clock = new MutableClock(DateTimeOffset.Parse("2026-10-04T12:00:00Z"));
        var dispatcher = new OutboundEventDispatcher(queue, publisher, clock);
        var health = new EdgeDeviceHealth(
            identity.DeviceId.ToString(),
            identity.DeviceName,
            identity.SoftwareVersion,
            "online",
            clock.GetUtcNow(),
            12.5,
            42.0,
            10.0,
            new Dictionary<string, string> { ["audio.capture"] = "available" });
        var outbound = OutboundEventFactory.Health(identity, health, Guid.NewGuid());

        await queue.EnqueueAsync(outbound, CancellationToken.None);
        var first = await dispatcher.FlushAsync(outbound.Scope, 10, CancellationToken.None);

        Assert.Equal(new OutboundDispatchResult(1, 0, 1), first);
        Assert.Empty(publisher.Health);

        clock.Advance(TimeSpan.FromSeconds(3));
        publisher.Fail = false;
        var second = await dispatcher.FlushAsync(outbound.Scope, 10, CancellationToken.None);

        Assert.Equal(new OutboundDispatchResult(1, 1, 0), second);
        Assert.Single(publisher.Health);
        Assert.Equal(health.DeviceId, publisher.Health[0].DeviceId);
        Assert.Equal(health.DeviceName, publisher.Health[0].DeviceName);
        Assert.Equal(health.Version, publisher.Health[0].Version);
        Assert.Equal(health.Status, publisher.Health[0].Status);
        Assert.Equal(health.ObservedAt, publisher.Health[0].ObservedAt);
        Assert.Equal(health.CpuPercent, publisher.Health[0].CpuPercent);
        Assert.Equal(health.MemoryPercent, publisher.Health[0].MemoryPercent);
        Assert.Equal(health.UplinkMbps, publisher.Health[0].UplinkMbps);
        Assert.Equal(health.Capabilities, publisher.Health[0].Capabilities);
    }

    [Fact]
    public void FactoryScopesEventsToTenantAndDevice()
    {
        var identity = Identity();
        var state = new MediaSourceState(
            "camera-main",
            "Main Camera",
            "camera",
            "ready",
            DateTimeOffset.Parse("2026-10-04T12:00:00Z"),
            new Dictionary<string, string>());

        var outbound = OutboundEventFactory.Media(identity, state, Guid.Parse("11111111-1111-1111-1111-111111111111"));

        Assert.Equal(identity.OrganizationId, outbound.Scope.OrganizationId);
        Assert.Equal(identity.DeviceId, outbound.Scope.DeviceId);
        Assert.Equal(OutboundEventKind.Media, outbound.Kind);
        Assert.Equal(1, outbound.SchemaVersion);
        Assert.Contains("camera-main", outbound.PayloadJson, StringComparison.Ordinal);
    }

    private static AgentIdentity Identity() => new(
        Guid.Parse("22222222-2222-2222-2222-222222222222"),
        Guid.Parse("33333333-3333-3333-3333-333333333333"),
        Guid.Parse("44444444-4444-4444-4444-444444444444"),
        "Edge UAT",
        "0.1.0");

    private sealed class FakePublisher : IEdgeEventPublisher
    {
        public bool Fail { get; set; }
        public List<EdgeDeviceHealth> Health { get; } = [];
        public List<TranscriptSegment> Transcripts { get; } = [];
        public List<MediaSourceState> Media { get; } = [];

        public Task PublishHealthAsync(Guid eventId, EdgeDeviceHealth health, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ThrowIfFailing();
            Health.Add(health);
            return Task.CompletedTask;
        }

        public Task PublishTranscriptAsync(Guid eventId, TranscriptSegment segment, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ThrowIfFailing();
            Transcripts.Add(segment);
            return Task.CompletedTask;
        }

        public Task PublishMediaSourceStateAsync(Guid eventId, MediaSourceState state, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ThrowIfFailing();
            Media.Add(state);
            return Task.CompletedTask;
        }

        private void ThrowIfFailing()
        {
            if (Fail) throw new HttpRequestException("offline");
        }
    }

    private sealed class MutableClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan delta) => _now = _now.Add(delta);
    }
}
