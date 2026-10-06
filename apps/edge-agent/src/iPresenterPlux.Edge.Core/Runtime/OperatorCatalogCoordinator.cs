using System.Net;
using iPresenterPlux.Edge.Core.Abstractions;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class OperatorScriptureUnavailableOfflineException(string message) : InvalidOperationException(message);

public sealed class OperatorCatalogCoordinator
{
    private readonly OperatorCatalogStore _store;
    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IOperatorCatalogClient? _client;
    private Guid? _activeServiceId;

    public OperatorCatalogCoordinator(
        OperatorCatalogStore store,
        IOperatorCatalogClient? client = null,
        TimeProvider? clock = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _client = client;
        _clock = clock ?? TimeProvider.System;
    }

    public void BindClient(IOperatorCatalogClient client) =>
        _client = client ?? throw new ArgumentNullException(nameof(client));

    public async Task SetActiveServiceAsync(Guid? activeServiceId, CancellationToken cancellationToken)
    {
        if (activeServiceId == Guid.Empty) activeServiceId = null;
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            _activeServiceId = activeServiceId;
            await _store.ClearServiceAsync(activeServiceId, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RefreshAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var client = _client ?? throw new InvalidOperationException("The operator catalog client is not bound.");
            var expectedServiceId = _activeServiceId;
            var snapshot = await client.GetCatalogAsync(cancellationToken).ConfigureAwait(false);
            var returnedServiceId = snapshot.Service?.ServiceId;
            if (returnedServiceId != expectedServiceId)
                throw new InvalidDataException("The operator catalog service scope did not match the active Edge service.");
            await _store.WriteAsync(snapshot, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task<OperatorCatalogSnapshot?> QueryAsync(CancellationToken cancellationToken) =>
        _store.ReadAsync(cancellationToken);

    public async Task<OperatorResolvedScripture> ResolveScriptureAsync(
        string reference,
        string? version,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reference);
        reference = reference.Trim();
        if (reference.Length > 120) throw new ArgumentOutOfRangeException(nameof(reference));
        if (version is not null)
        {
            version = version.Trim();
            if (version.Length is 0 or > 32) throw new ArgumentOutOfRangeException(nameof(version));
        }

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var activeServiceId = _activeServiceId
                ?? throw new InvalidOperationException("An active service is required to resolve scripture.");

            if (_client is not null)
            {
                try
                {
                    var resolved = await _client.ResolveScriptureAsync(reference, version, cancellationToken).ConfigureAwait(false);
                    if (resolved.ServiceId != activeServiceId)
                        throw new InvalidDataException("The resolved scripture service scope did not match the active Edge service.");
                    await CacheResolvedScriptureAsync(resolved, cancellationToken).ConfigureAwait(false);
                    return resolved;
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (HttpRequestException error) when (IsOfflineFailure(error.StatusCode))
                {
                    // Fall through to exact same-service cache lookup.
                }
                catch (TaskCanceledException)
                {
                    // Fall through to exact same-service cache lookup.
                }
            }

            var cached = await _store.ReadAsync(cancellationToken).ConfigureAwait(false);
            if (cached?.Service?.ServiceId == activeServiceId)
            {
                var match = cached.ScriptureQueue.FirstOrDefault(item =>
                    string.Equals(item.ItemType, "scripture", StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(item.Title.Trim(), reference, StringComparison.OrdinalIgnoreCase) &&
                    VersionMatches(item, version));
                if (match is not null)
                    return new OperatorResolvedScripture(activeServiceId, match, cached.ObservedAt);
            }

            throw new OperatorScriptureUnavailableOfflineException("The requested scripture is not available in the local catalog cache.");
        }
        finally
        {
            _gate.Release();
        }
    }

    public Guid? ActiveServiceId => _activeServiceId;

    private async Task CacheResolvedScriptureAsync(
        OperatorResolvedScripture resolved,
        CancellationToken cancellationToken)
    {
        var current = await _store.ReadAsync(cancellationToken).ConfigureAwait(false);
        if (current?.Service?.ServiceId != resolved.ServiceId) return;

        var queue = new[] { resolved.Item }
            .Concat(current.ScriptureQueue.Where(item =>
                !string.Equals(item.ItemId, resolved.Item.ItemId, StringComparison.OrdinalIgnoreCase)))
            .Take(200)
            .ToArray();
        var updated = current with
        {
            SyncedAt = _clock.GetUtcNow(),
            ObservedAt = resolved.ObservedAt,
            ScriptureQueue = queue,
        };
        await _store.WriteAsync(updated, cancellationToken).ConfigureAwait(false);
    }

    private static bool VersionMatches(OperatorCatalogItem item, string? version)
    {
        if (string.IsNullOrWhiteSpace(version)) return true;
        if (string.Equals(item.Footer, version, StringComparison.OrdinalIgnoreCase)) return true;
        return item.Metadata.TryGetValue("bibleVersion", out var cachedVersion) &&
            string.Equals(cachedVersion, version, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsOfflineFailure(HttpStatusCode? statusCode) =>
        statusCode is null || (int)statusCode >= 500;
}
