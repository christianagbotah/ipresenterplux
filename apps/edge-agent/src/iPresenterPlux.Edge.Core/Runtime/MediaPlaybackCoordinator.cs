namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class MediaPlaybackCoordinator
{
    private readonly object _gate = new();
    private readonly TimeProvider _clock;
    private Guid? _activeServiceId;
    private MediaPlaybackSnapshot? _snapshot;
    private long _revision;

    public MediaPlaybackCoordinator(TimeProvider? clock = null) => _clock = clock ?? TimeProvider.System;

    public MediaPlaybackSnapshot? Snapshot
    {
        get
        {
            lock (_gate) return EvaluateUnsafe();
        }
    }

    public Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (serviceId == Guid.Empty) serviceId = null;
        lock (_gate)
        {
            if (_activeServiceId == serviceId) return Task.CompletedTask;
            _activeServiceId = serviceId;
            if (_snapshot is not null && _snapshot.ServiceId != serviceId)
            {
                _snapshot = null;
                _revision++;
            }
        }
        return Task.CompletedTask;
    }

    public Task<MediaPlaybackSnapshot> TakeAsync(PreparedMediaAsset asset, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(asset);
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            EnsureServiceUnsafe(asset.ServiceId);
            var descriptor = asset.Descriptor;
            var now = _clock.GetUtcNow();
            var dynamic = asset.MediaKind is "video" or "audio";
            var position = descriptor.TrimStartSeconds;
            _snapshot = new MediaPlaybackSnapshot(
                asset.ItemId,
                asset.ServiceId,
                asset.CacheKey,
                asset.MediaKind,
                dynamic ? "playing" : "ready",
                dynamic ? now : null,
                null,
                position,
                position,
                descriptor.TrimStartSeconds,
                EffectiveEnd(asset),
                descriptor.Loop,
                descriptor.Volume,
                descriptor.Fit,
                ++_revision,
                null);
            return Task.FromResult(_snapshot);
        }
    }

    public Task<MediaPlaybackSnapshot> PauseAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            var current = RequireDynamicUnsafe();
            if (current.State != "playing")
                throw new InvalidOperationException("Only playing media can be paused.");
            current = EvaluateUnsafe()!;
            var now = _clock.GetUtcNow();
            _snapshot = current with
            {
                State = "paused",
                StartedAtUtc = null,
                PausedAtUtc = now,
                BasePositionSeconds = current.EffectivePositionSeconds,
                Revision = ++_revision
            };
            return Task.FromResult(_snapshot);
        }
    }

    public Task<MediaPlaybackSnapshot> ResumeAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            var current = RequireDynamicUnsafe();
            EnsureServiceUnsafe(current.ServiceId);
            current = EvaluateUnsafe()!;
            if (current.State is not ("paused" or "recovery_required" or "ended"))
                throw new InvalidOperationException("Media is not paused or awaiting recovery.");
            var position = current.State == "ended" ? current.TrimStartSeconds : current.EffectivePositionSeconds;
            _snapshot = current with
            {
                State = "playing",
                StartedAtUtc = _clock.GetUtcNow(),
                PausedAtUtc = null,
                BasePositionSeconds = position,
                EffectivePositionSeconds = position,
                Revision = ++_revision,
                ErrorCode = null
            };
            return Task.FromResult(_snapshot);
        }
    }

    public Task<MediaPlaybackSnapshot> SeekAsync(double seconds, CancellationToken cancellationToken)
    {
        if (!double.IsFinite(seconds)) throw new ArgumentOutOfRangeException(nameof(seconds));
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            var current = RequireDynamicUnsafe();
            EnsureServiceUnsafe(current.ServiceId);
            current = EvaluateUnsafe()!;
            var end = current.TrimEndSeconds ?? double.MaxValue;
            var position = Math.Clamp(seconds, current.TrimStartSeconds, end);
            var now = _clock.GetUtcNow();
            var playing = current.State == "playing";
            _snapshot = current with
            {
                State = current.State == "ended" && position < end ? "paused" : current.State,
                StartedAtUtc = playing ? now : null,
                PausedAtUtc = playing ? null : now,
                BasePositionSeconds = position,
                EffectivePositionSeconds = position,
                Revision = ++_revision
            };
            return Task.FromResult(_snapshot);
        }
    }

    public Task ClearAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            if (_snapshot is not null)
            {
                _snapshot = null;
                _revision++;
            }
        }
        return Task.CompletedTask;
    }

    public Task<MediaPlaybackSnapshot> RestoreRecoveryAsync(MediaPlaybackSnapshot persisted, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(persisted);
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            if (_activeServiceId is null || persisted.ServiceId != _activeServiceId)
            {
                _snapshot = null;
                _revision++;
                return Task.FromResult(persisted with { State = "recovery_required", Revision = _revision });
            }

            var dynamic = persisted.MediaKind is "video" or "audio";
            var position = ClampPosition(persisted.EffectivePositionSeconds, persisted.TrimStartSeconds, persisted.TrimEndSeconds);
            _snapshot = persisted with
            {
                State = dynamic ? "recovery_required" : "ready",
                StartedAtUtc = null,
                PausedAtUtc = dynamic ? _clock.GetUtcNow() : null,
                BasePositionSeconds = position,
                EffectivePositionSeconds = position,
                Revision = ++_revision,
                ErrorCode = null
            };
            return Task.FromResult(_snapshot);
        }
    }

    public Task<MediaPlaybackSnapshot> RestoreAsync(MediaPlaybackSnapshot persisted, CancellationToken cancellationToken) =>
        RestoreRecoveryAsync(persisted, cancellationToken);

    private MediaPlaybackSnapshot RequireDynamicUnsafe()
    {
        var current = _snapshot ?? throw new InvalidOperationException("No media playback is active.");
        if (current.MediaKind is not ("video" or "audio"))
            throw new InvalidOperationException("The active media is not time-based.");
        return current;
    }

    private void EnsureServiceUnsafe(Guid serviceId)
    {
        if (_activeServiceId is null || _activeServiceId != serviceId)
            throw new InvalidOperationException("Media playback service scope does not match the active service.");
    }

    private MediaPlaybackSnapshot? EvaluateUnsafe()
    {
        var current = _snapshot;
        if (current is null || current.State != "playing" || current.StartedAtUtc is null) return current;

        var elapsed = Math.Max(0, (_clock.GetUtcNow() - current.StartedAtUtc.Value).TotalSeconds);
        var position = current.BasePositionSeconds + elapsed;
        var end = current.TrimEndSeconds;
        if (end is { } trimEnd && position >= trimEnd)
        {
            if (current.Loop && trimEnd > current.TrimStartSeconds)
            {
                var span = trimEnd - current.TrimStartSeconds;
                position = current.TrimStartSeconds + ((position - current.TrimStartSeconds) % span);
                return current with { EffectivePositionSeconds = position };
            }

            _snapshot = current with
            {
                State = "ended",
                StartedAtUtc = null,
                PausedAtUtc = _clock.GetUtcNow(),
                BasePositionSeconds = trimEnd,
                EffectivePositionSeconds = trimEnd,
                Revision = ++_revision
            };
            return _snapshot;
        }

        return current with { EffectivePositionSeconds = position };
    }

    private static double? EffectiveEnd(PreparedMediaAsset asset)
    {
        if (asset.Descriptor.TrimEndSeconds is { } explicitEnd) return explicitEnd;
        if (asset.Duration is { } duration && duration.TotalSeconds > asset.Descriptor.TrimStartSeconds)
            return duration.TotalSeconds;
        return null;
    }

    private static double ClampPosition(double value, double start, double? end) =>
        end is { } max ? Math.Clamp(value, start, max) : Math.Max(start, value);
}
