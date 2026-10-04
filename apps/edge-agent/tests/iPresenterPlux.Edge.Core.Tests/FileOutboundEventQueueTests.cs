using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Queues;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class FileOutboundEventQueueTests
{
    [Fact]
    public async Task PendingEventSurvivesQueueRecreationAndAcknowledgement()
    {
        var directory = CreateTempDirectory();
        try
        {
            var outbound = Event(Guid.Parse("11111111-1111-1111-1111-111111111111"));
            var now = DateTimeOffset.Parse("2026-10-04T12:00:00Z");

            await using (var first = new FileOutboundEventQueue(directory))
            {
                await first.EnqueueAsync(outbound, CancellationToken.None);
            }

            await using (var second = new FileOutboundEventQueue(directory))
            {
                var deliveries = await second.ClaimAsync(
                    outbound.Scope,
                    10,
                    now,
                    TimeSpan.FromMinutes(1),
                    CancellationToken.None);

                var delivery = Assert.Single(deliveries);
                Assert.Equal(outbound, delivery.Event);
                Assert.True(await second.AcknowledgeAsync(
                    outbound.Scope,
                    outbound.EventId,
                    delivery.ClaimId,
                    now.AddSeconds(1),
                    CancellationToken.None));
            }

            await using (var third = new FileOutboundEventQueue(directory))
            {
                await third.EnqueueAsync(outbound, CancellationToken.None);
                var deliveries = await third.ClaimAsync(
                    outbound.Scope,
                    10,
                    now.AddMinutes(2),
                    TimeSpan.FromMinutes(1),
                    CancellationToken.None);
                Assert.Empty(deliveries);
            }
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task RetryScheduleSurvivesQueueRecreation()
    {
        var directory = CreateTempDirectory();
        try
        {
            var outbound = Event(Guid.Parse("22222222-2222-2222-2222-222222222222"));
            var now = DateTimeOffset.Parse("2026-10-04T12:00:00Z");
            var retryAt = now.AddMinutes(5);

            await using (var first = new FileOutboundEventQueue(directory))
            {
                await first.EnqueueAsync(outbound, CancellationToken.None);
                var firstDelivery = Assert.Single(await first.ClaimAsync(
                    outbound.Scope,
                    1,
                    now,
                    TimeSpan.FromMinutes(1),
                    CancellationToken.None));
                Assert.True(await first.RetryAsync(
                    outbound.Scope,
                    outbound.EventId,
                    firstDelivery.ClaimId,
                    now.AddSeconds(1),
                    retryAt,
                    CancellationToken.None));
            }

            await using (var second = new FileOutboundEventQueue(directory))
            {
                Assert.Empty(await second.ClaimAsync(
                    outbound.Scope,
                    1,
                    retryAt.AddSeconds(-1),
                    TimeSpan.FromMinutes(1),
                    CancellationToken.None));

                var retried = Assert.Single(await second.ClaimAsync(
                    outbound.Scope,
                    1,
                    retryAt,
                    TimeSpan.FromMinutes(1),
                    CancellationToken.None));
                Assert.Equal(2, retried.Attempt);
            }
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task ConflictingDuplicateIdIsRejectedAfterRestart()
    {
        var directory = CreateTempDirectory();
        try
        {
            var eventId = Guid.Parse("33333333-3333-3333-3333-333333333333");
            var outbound = Event(eventId);

            await using (var first = new FileOutboundEventQueue(directory))
            {
                await first.EnqueueAsync(outbound, CancellationToken.None);
            }

            await using var second = new FileOutboundEventQueue(directory);
            var conflicting = outbound with { PayloadJson = "{\"text\":\"different\"}" };
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                second.EnqueueAsync(conflicting, CancellationToken.None));
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task CompactionUsesDeliveryTimeNotOriginalEventTime()
    {
        var directory = CreateTempDirectory();
        try
        {
            var outbound = Event(Guid.Parse("44444444-4444-4444-4444-444444444444")) with
            {
                OccurredAt = DateTimeOffset.Parse("2025-01-01T00:00:00Z")
            };
            var deliveredAt = DateTimeOffset.Parse("2026-10-04T12:00:00Z");

            await using var queue = new FileOutboundEventQueue(directory);
            await queue.EnqueueAsync(outbound, CancellationToken.None);
            var delivery = Assert.Single(await queue.ClaimAsync(
                outbound.Scope,
                1,
                deliveredAt.AddSeconds(-1),
                TimeSpan.FromMinutes(1),
                CancellationToken.None));
            Assert.True(await queue.AcknowledgeAsync(
                outbound.Scope,
                outbound.EventId,
                delivery.ClaimId,
                deliveredAt,
                CancellationToken.None));

            Assert.Equal(0, await queue.CompactAsync(deliveredAt.AddMinutes(-1), CancellationToken.None));
            Assert.Equal(1, await queue.CompactAsync(deliveredAt.AddMinutes(1), CancellationToken.None));
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    private static OutboundEvent Event(Guid eventId) => new(
        eventId,
        new OutboundEventScope(
            Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")),
        Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"),
        OutboundEventKind.Transcript,
        1,
        DateTimeOffset.Parse("2026-10-04T11:59:00Z"),
        "{\"text\":\"John 3:16\"}");

    private static string CreateTempDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenterplux-edge-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        return directory;
    }
}
