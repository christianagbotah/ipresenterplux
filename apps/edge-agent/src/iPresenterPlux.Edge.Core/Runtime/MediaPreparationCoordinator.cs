using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class MediaPreparationCoordinator : IMediaPreparationCoordinator, IDisposable
{
    private readonly IMediaAssetCache _cache;
    private readonly OperatorCatalogCoordinator _catalog;
    private readonly object _sync = new();
    private readonly Dictionary<string, MediaPreparationSnapshot> _states = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Task<MediaPreparationSnapshot>> _inflight = new(StringComparer.Ordinal);
    private CancellationTokenSource _serviceCts = new();
    private Guid? _organizationId;
    private Guid? _activeServiceId;
    private bool _disposed;

    public MediaPreparationCoordinator(IMediaAssetCache cache, OperatorCatalogCoordinator catalog)
    {
        _cache = cache ?? throw new ArgumentNullException(nameof(cache));
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
    }

    public event EventHandler<MediaPreparationSnapshot>? StatusChanged;

    public void BindOrganization(Guid organizationId)
    {
        if (organizationId == Guid.Empty) throw new ArgumentException("Organization id must be nonempty.", nameof(organizationId));
        lock (_sync)
        {
            ThrowIfDisposed();
            _organizationId = organizationId;
        }
    }

    public Task<MediaPreparationSnapshot> PrepareAsync(
        PresentationRenderItem item,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentException.ThrowIfNullOrWhiteSpace(item.ItemId);

        Task<MediaPreparationSnapshot> job;
        lock (_sync)
        {
            ThrowIfDisposed();
            if (_activeServiceId is not { } activeServiceId || item.ServiceId != activeServiceId)
                return Task.FromResult(PublishLocked(new MediaPreparationSnapshot(
                    item.ItemId, item.ServiceId, MediaPreparationState.Failed, null, "media_scope_mismatch")));

            if (!string.Equals(item.ItemType, "media", StringComparison.OrdinalIgnoreCase))
                return Task.FromResult(PublishLocked(new MediaPreparationSnapshot(
                    item.ItemId, item.ServiceId, MediaPreparationState.NotRequired, null, null)));

            if (item.Media is null || _organizationId is null)
                return Task.FromResult(PublishLocked(new MediaPreparationSnapshot(
                    item.ItemId, item.ServiceId, MediaPreparationState.Failed, null, "media_scope_mismatch")));

            if (_states.TryGetValue(item.ItemId, out var existing) &&
                existing.ServiceId == activeServiceId &&
                existing.State is MediaPreparationState.Ready or MediaPreparationState.Unsupported)
            {
                return Task.FromResult(existing);
            }

            if (_inflight.TryGetValue(item.ItemId, out var current))
                return current.WaitAsync(cancellationToken);

            var serviceToken = _serviceCts.Token;
            job = RunPreparationAsync(item, _organizationId.Value, activeServiceId, serviceToken);
            _inflight[item.ItemId] = job;
            _ = job.ContinueWith(
                _ =>
                {
                    lock (_sync)
                    {
                        if (_inflight.TryGetValue(item.ItemId, out var tracked) && ReferenceEquals(tracked, job))
                            _inflight.Remove(item.ItemId);
                    }
                },
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
        }

        return job.WaitAsync(cancellationToken);
    }

    public MediaPreparationSnapshot? TryGet(string itemId)
    {
        if (string.IsNullOrWhiteSpace(itemId)) return null;
        lock (_sync)
        {
            ThrowIfDisposed();
            return _states.TryGetValue(itemId.Trim(), out var snapshot) ? snapshot : null;
        }
    }

    public async Task PrefetchAsync(
        Guid serviceId,
        IReadOnlyList<OperatorCatalogItem> items,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(items);
        CancellationToken serviceToken;
        lock (_sync)
        {
            ThrowIfDisposed();
            if (_activeServiceId != serviceId) return;
            serviceToken = _serviceCts.Token;
        }

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, serviceToken);
        try
        {
            var tasks = items
                .Where(item => string.Equals(item.ItemType, "media", StringComparison.OrdinalIgnoreCase))
                .Select(item => PrefetchItemAsync(serviceId, item, linked.Token))
                .ToArray();
            await Task.WhenAll(tasks).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (serviceToken.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            // Assignment changed: old low-priority work is intentionally abandoned.
        }
    }

    public IDisposable AcquireReadyLease(string itemId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(itemId);
        lock (_sync)
        {
            ThrowIfDisposed();
            if (!_states.TryGetValue(itemId.Trim(), out var snapshot) ||
                snapshot.State != MediaPreparationState.Ready || snapshot.Asset is null ||
                snapshot.ServiceId != _activeServiceId)
            {
                throw new MediaAssetCacheException("media_not_ready", "Only ready media items can be leased.");
            }
            return _cache.AcquireLease(snapshot.Asset.CacheKey);
        }
    }

    public Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        CancellationTokenSource previous;
        lock (_sync)
        {
            ThrowIfDisposed();
            if (serviceId == Guid.Empty) serviceId = null;
            if (_activeServiceId == serviceId) return Task.CompletedTask;
            previous = _serviceCts;
            _serviceCts = new CancellationTokenSource();
            _activeServiceId = serviceId;
            _states.Clear();
            _inflight.Clear();
        }
        previous.Cancel();
        previous.Dispose();
        return Task.CompletedTask;
    }

    private async Task<MediaPreparationSnapshot> RunPreparationAsync(
        PresentationRenderItem item,
        Guid organizationId,
        Guid serviceId,
        CancellationToken cancellationToken)
    {
        PublishIfActive(new MediaPreparationSnapshot(item.ItemId, serviceId, MediaPreparationState.Queued, null, null));
        PublishIfActive(new MediaPreparationSnapshot(item.ItemId, serviceId, MediaPreparationState.Downloading, null, null));
        try
        {
            var entry = await _cache.PrepareAsync(organizationId, item.Media!, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            PublishIfActive(new MediaPreparationSnapshot(item.ItemId, serviceId, MediaPreparationState.Validating, null, null));
            var asset = new PreparedMediaAsset(
                item.ItemId,
                serviceId,
                entry.CacheKey,
                entry.Path,
                entry.ContentType,
                entry.MediaKind,
                Duration: null,
                item.Media!);
            return PublishIfActive(new MediaPreparationSnapshot(
                item.ItemId, serviceId, MediaPreparationState.Ready, asset, null));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (MediaAssetCacheException error)
        {
            var state = IsPermanentUnsupported(error.Code)
                ? MediaPreparationState.Unsupported
                : MediaPreparationState.Failed;
            return PublishIfActive(new MediaPreparationSnapshot(item.ItemId, serviceId, state, null, error.Code));
        }
        catch (Exception)
        {
            return PublishIfActive(new MediaPreparationSnapshot(
                item.ItemId, serviceId, MediaPreparationState.Failed, null, "media_download_failed"));
        }
    }

    private async Task PrefetchItemAsync(
        Guid serviceId,
        OperatorCatalogItem item,
        CancellationToken cancellationToken)
    {
        try
        {
            var render = await _catalog.ResolvePresentationAsync(item.ItemId, cancellationToken).ConfigureAwait(false);
            if (render.ServiceId != serviceId || !string.Equals(render.ItemType, "media", StringComparison.OrdinalIgnoreCase)) return;
            _ = await PrepareAsync(render, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            // Prefetch is best effort; explicit Preview can retry transient failures later.
        }
    }

    private MediaPreparationSnapshot PublishIfActive(MediaPreparationSnapshot snapshot)
    {
        EventHandler<MediaPreparationSnapshot>? changed;
        lock (_sync)
        {
            if (_activeServiceId != snapshot.ServiceId) throw new OperationCanceledException(_serviceCts.Token);
            _states[snapshot.ItemId] = snapshot;
            changed = StatusChanged;
        }
        changed?.Invoke(this, snapshot);
        return snapshot;
    }

    private MediaPreparationSnapshot PublishLocked(MediaPreparationSnapshot snapshot)
    {
        _states[snapshot.ItemId] = snapshot;
        var changed = StatusChanged;
        if (changed is not null) ThreadPool.QueueUserWorkItem(_ => changed(this, snapshot));
        return snapshot;
    }

    private static bool IsPermanentUnsupported(string code) =>
        code is "media_type_invalid" or "media_type_unsupported";

    public void Dispose()
    {
        CancellationTokenSource cts;
        lock (_sync)
        {
            if (_disposed) return;
            _disposed = true;
            cts = _serviceCts;
            _states.Clear();
            _inflight.Clear();
        }
        cts.Cancel();
        cts.Dispose();
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}
