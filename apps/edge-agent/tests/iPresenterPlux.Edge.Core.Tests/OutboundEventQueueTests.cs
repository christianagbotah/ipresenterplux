using System.Text.Json;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Queues;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class OutboundEventQueueTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-01-01T00:00:00Z");
    private static readonly OutboundEventScope Scope = new(Guid.NewGuid(), Guid.NewGuid());
    private static OutboundEvent Create(OutboundEventKind kind = OutboundEventKind.Transcript) =>
        new(Guid.NewGuid(), Scope, Guid.NewGuid(), kind, 1, Now, "{}");

    [Fact]
    public async Task AllKindsAcrossServicesKeepEnqueueOrderAndRoundTrip()
    {
        var queue = new InMemoryOutboundEventQueue();
        var events = Enum.GetValues<OutboundEventKind>().Select(Create).ToArray();
        foreach (var item in events)
        {
            Assert.Equal(item, JsonSerializer.Deserialize<OutboundEvent>(JsonSerializer.Serialize(item)));
            await queue.EnqueueAsync(item, default);
        }
        var claims = await queue.ClaimAsync(Scope, 10, Now, TimeSpan.FromMinutes(1), default);
        Assert.Equal(events, claims.Select(claim => claim.Event));
        Assert.All(claims, claim => Assert.Equal(1, claim.Attempt));
    }

    [Fact]
    public async Task DuplicateIdIsIdempotentEvenAfterAckAndConflictsAreRejected()
    {
        var queue = new InMemoryOutboundEventQueue();
        var item = Create();
        await queue.EnqueueAsync(item, default);
        await queue.EnqueueAsync(item, default);
        var claim = Assert.Single(await queue.ClaimAsync(Scope, 10, Now, TimeSpan.FromMinutes(1), default));
        Assert.True(await queue.AcknowledgeAsync(Scope, item.EventId, claim.ClaimId, Now, default));
        Assert.False(await queue.AcknowledgeAsync(Scope, item.EventId, claim.ClaimId, Now, default));
        await queue.EnqueueAsync(item, default);
        Assert.Empty(await queue.ClaimAsync(Scope, 10, Now, TimeSpan.FromMinutes(1), default));
        await Assert.ThrowsAsync<InvalidOperationException>(() => queue.EnqueueAsync(item with { ServiceId = Guid.NewGuid() }, default));
    }

    [Fact]
    public async Task RetryAndLeaseExpiryRejectStaleClaims()
    {
        var queue = new InMemoryOutboundEventQueue();
        var item = Create();
        await queue.EnqueueAsync(item, default);
        var first = Assert.Single(await queue.ClaimAsync(Scope, 1, Now, TimeSpan.FromMinutes(1), default));
        Assert.Empty(await queue.ClaimAsync(Scope, 1, Now, TimeSpan.FromMinutes(1), default));
        Assert.True(await queue.RetryAsync(Scope, item.EventId, first.ClaimId, Now, Now.AddSeconds(30), default));
        Assert.False(await queue.AcknowledgeAsync(Scope, item.EventId, first.ClaimId, Now, default));
        Assert.Empty(await queue.ClaimAsync(Scope, 1, Now.AddSeconds(29), TimeSpan.FromMinutes(1), default));
        var second = Assert.Single(await queue.ClaimAsync(Scope, 1, Now.AddSeconds(30), TimeSpan.FromMinutes(1), default));
        Assert.Equal(2, second.Attempt);
        var expiry = second.LeaseExpiresAt;
        Assert.False(await queue.AcknowledgeAsync(Scope, item.EventId, second.ClaimId, expiry, default));
        var third = Assert.Single(await queue.ClaimAsync(Scope, 1, expiry, TimeSpan.FromMinutes(1), default));
        Assert.Equal(3, third.Attempt);
        Assert.NotEqual(second.ClaimId, third.ClaimId);
        Assert.False(await queue.RetryAsync(Scope, item.EventId, second.ClaimId, expiry, expiry, default));
        Assert.True(await queue.AcknowledgeAsync(Scope, item.EventId, third.ClaimId, expiry, default));
    }

    [Fact]
    public async Task ScopeSeparatesDevicesAndOrganizations()
    {
        var queue = new InMemoryOutboundEventQueue();
        var item = Create();
        var otherDevice = Scope with { DeviceId = Guid.NewGuid() };
        var otherTenant = Scope with { OrganizationId = Guid.NewGuid() };
        await queue.EnqueueAsync(item, default);
        await queue.EnqueueAsync(item with { Scope = otherDevice }, default);
        await queue.EnqueueAsync(item with { Scope = otherTenant }, default);
        var claim = Assert.Single(await queue.ClaimAsync(Scope, 10, Now, TimeSpan.FromMinutes(1), default));
        Assert.False(await queue.AcknowledgeAsync(otherTenant, item.EventId, claim.ClaimId, Now, default));
        Assert.Single(await queue.ClaimAsync(otherDevice, 10, Now, TimeSpan.FromMinutes(1), default));
        Assert.Single(await queue.ClaimAsync(otherTenant, 10, Now, TimeSpan.FromMinutes(1), default));
    }

    [Fact]
    public async Task ConcurrentClaimersDeliverEachEventOncePerLease()
    {
        var queue = new InMemoryOutboundEventQueue();
        for (var i = 0; i < 50; i++) await queue.EnqueueAsync(Create(), default);
        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Task.Run(() =>
            queue.ClaimAsync(Scope, 10, Now, TimeSpan.FromMinutes(1), default))));
        var ids = results.SelectMany(batch => batch).Select(claim => claim.Event.EventId).ToArray();
        Assert.Equal(50, ids.Length);
        Assert.Equal(50, ids.Distinct().Count());
    }

    [Fact]
    public async Task CancellationAndInvalidArgumentsDoNotMutateQueue()
    {
        var queue = new InMemoryOutboundEventQueue();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var item = Create();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => queue.EnqueueAsync(item, cancellation.Token));
        await Assert.ThrowsAsync<ArgumentException>(() => queue.EnqueueAsync(item with { EventId = Guid.Empty }, default));
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => queue.ClaimAsync(Scope, 0, Now, TimeSpan.FromMinutes(1), default));
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => queue.ClaimAsync(Scope, 1, Now, TimeSpan.Zero, default));
        await queue.EnqueueAsync(item, default);
        var claim = Assert.Single(await queue.ClaimAsync(Scope, 1, Now, TimeSpan.FromMinutes(1), default));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => queue.AcknowledgeAsync(Scope, item.EventId, claim.ClaimId, Now, cancellation.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => queue.RetryAsync(Scope, item.EventId, claim.ClaimId, Now, Now, cancellation.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => queue.ClaimAsync(Scope, 1, Now, TimeSpan.FromMinutes(1), cancellation.Token));
        Assert.True(await queue.AcknowledgeAsync(Scope, item.EventId, claim.ClaimId, Now, default));
    }
}
