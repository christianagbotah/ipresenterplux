using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed record OutboundDispatchResult(int Claimed, int Delivered, int Retried);

public sealed class OutboundEventDispatcher(
    IOutboundEventQueue queue,
    IEdgeEventPublisher publisher,
    TimeProvider? clock = null)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(2);

    private readonly IOutboundEventQueue _queue = queue ?? throw new ArgumentNullException(nameof(queue));
    private readonly IEdgeEventPublisher _publisher = publisher ?? throw new ArgumentNullException(nameof(publisher));
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    public async Task<OutboundDispatchResult> FlushAsync(
        OutboundEventScope scope,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(limit);

        var now = _clock.GetUtcNow();
        var deliveries = await _queue.ClaimAsync(
            scope,
            limit,
            now,
            LeaseDuration,
            cancellationToken);

        var delivered = 0;
        var retried = 0;

        foreach (var delivery in deliveries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                await PublishAsync(delivery.Event, cancellationToken);
                var acknowledged = await _queue.AcknowledgeAsync(
                    scope,
                    delivery.Event.EventId,
                    delivery.ClaimId,
                    _clock.GetUtcNow(),
                    cancellationToken);

                if (acknowledged) delivered++;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch
            {
                var retryAt = _clock.GetUtcNow().Add(BackoffFor(delivery.Attempt));
                var scheduled = await _queue.RetryAsync(
                    scope,
                    delivery.Event.EventId,
                    delivery.ClaimId,
                    _clock.GetUtcNow(),
                    retryAt,
                    cancellationToken);

                if (scheduled) retried++;
            }
        }

        return new OutboundDispatchResult(deliveries.Count, delivered, retried);
    }

    private Task PublishAsync(OutboundEvent outboundEvent, CancellationToken cancellationToken) =>
        outboundEvent.Kind switch
        {
            OutboundEventKind.Transcript => _publisher.PublishTranscriptAsync(
                outboundEvent.EventId, Deserialize<TranscriptSegment>(outboundEvent), cancellationToken),
            OutboundEventKind.Health => _publisher.PublishHealthAsync(
                outboundEvent.EventId, Deserialize<EdgeDeviceHealth>(outboundEvent), cancellationToken),
            OutboundEventKind.Media => _publisher.PublishMediaSourceStateAsync(
                outboundEvent.EventId, Deserialize<MediaSourceState>(outboundEvent), cancellationToken),
            _ => throw new InvalidOperationException($"Unsupported outbound event kind: {outboundEvent.Kind}")
        };

    private static T Deserialize<T>(OutboundEvent outboundEvent) =>
        JsonSerializer.Deserialize<T>(outboundEvent.PayloadJson, JsonOptions)
        ?? throw new InvalidOperationException(
            $"Outbound event {outboundEvent.EventId} has an empty {typeof(T).Name} payload.");

    private static TimeSpan BackoffFor(int attempt)
    {
        var boundedAttempt = Math.Clamp(attempt, 1, 8);
        var seconds = Math.Min(300, Math.Pow(2, boundedAttempt));
        return TimeSpan.FromSeconds(seconds);
    }
}
