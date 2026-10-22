using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class MediaAssetCache : IMediaAssetCache, IDisposable
{
    private const int MaxRedirects = 5;
    private const int ProbeBytes = 64;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly string _root;
    private readonly HttpClient _http;
    private readonly MediaRemoteEndpointPolicy _remotePolicy;
    private readonly MediaAssetCacheOptions _options;
    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _downloads;
    private readonly object _sync = new();
    private readonly Dictionary<string, CacheRecord> _entries = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _leases = new(StringComparer.Ordinal);
    private readonly HashSet<string> _retireWhenReleased = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Task<MediaAssetCacheEntry>> _inflight = new(StringComparer.Ordinal);
    private readonly bool _ownsHttpClient;

    public MediaAssetCache(
        string directoryPath,
        MediaRemoteEndpointPolicy remotePolicy,
        MediaAssetCacheOptions options,
        TimeProvider clock)
        : this(directoryPath, CreateProductionHttpClient(remotePolicy), remotePolicy, options, clock, ownsHttpClient: true)
    {
    }

    internal MediaAssetCache(
        string directoryPath,
        HttpClient http,
        MediaRemoteEndpointPolicy remotePolicy,
        MediaAssetCacheOptions? options = null,
        TimeProvider? clock = null)
        : this(directoryPath, http, remotePolicy, options, clock, ownsHttpClient: false)
    {
    }

    private MediaAssetCache(
        string directoryPath,
        HttpClient http,
        MediaRemoteEndpointPolicy remotePolicy,
        MediaAssetCacheOptions? options,
        TimeProvider? clock,
        bool ownsHttpClient)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directoryPath);
        _root = Path.GetFullPath(directoryPath);
        Directory.CreateDirectory(_root);
        _http = http ?? throw new ArgumentNullException(nameof(http));
        _remotePolicy = remotePolicy ?? throw new ArgumentNullException(nameof(remotePolicy));
        _options = (options ?? new MediaAssetCacheOptions()).Validate();
        _clock = clock ?? TimeProvider.System;
        _ownsHttpClient = ownsHttpClient;
        _downloads = new SemaphoreSlim(_options.MaxConcurrentDownloads, _options.MaxConcurrentDownloads);
        Recover();
    }

    private static HttpClient CreateProductionHttpClient(MediaRemoteEndpointPolicy remotePolicy)
    {
        ArgumentNullException.ThrowIfNull(remotePolicy);
        return new HttpClient(remotePolicy.CreateHttpHandler(), disposeHandler: true)
        {
            Timeout = Timeout.InfiniteTimeSpan
        };
    }

    public Task<MediaAssetCacheEntry> PrepareAsync(
        Guid organizationId,
        PresentationMediaDescriptor descriptor,
        CancellationToken cancellationToken)
    {
        if (organizationId == Guid.Empty) throw new ArgumentException("Organization id must be nonempty.", nameof(organizationId));
        descriptor = (descriptor ?? throw new ArgumentNullException(nameof(descriptor))).Validate();
        var cacheKey = CacheKey(organizationId, descriptor.SourceId, descriptor.AssetVersion);

        lock (_sync)
        {
            if (TryGetReadyLocked(cacheKey, out var ready)) return Task.FromResult(ready);
            if (_inflight.TryGetValue(cacheKey, out var existing)) return existing.WaitAsync(cancellationToken);

            var task = PrepareCoreAsync(cacheKey, organizationId, descriptor, cancellationToken);
            _inflight[cacheKey] = task;
            _ = task.ContinueWith(
                _ => { lock (_sync) { if (_inflight.TryGetValue(cacheKey, out var current) && ReferenceEquals(current, task)) _inflight.Remove(cacheKey); } },
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
            return task;
        }
    }

    public bool TryGetReady(string cacheKey, out MediaAssetCacheEntry entry)
    {
        if (string.IsNullOrWhiteSpace(cacheKey)) { entry = default!; return false; }
        lock (_sync) return TryGetReadyLocked(cacheKey.Trim(), out entry);
    }

    public IDisposable AcquireLease(string cacheKey)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(cacheKey);
        cacheKey = cacheKey.Trim();
        lock (_sync)
        {
            if (!TryGetReadyLocked(cacheKey, out _))
                throw new MediaAssetCacheException("media_not_ready", "Only ready media assets can be leased.");
            _leases[cacheKey] = _leases.GetValueOrDefault(cacheKey) + 1;
        }
        return new Lease(this, cacheKey);
    }

    private async Task<MediaAssetCacheEntry> PrepareCoreAsync(
        string cacheKey,
        Guid organizationId,
        PresentationMediaDescriptor descriptor,
        CancellationToken cancellationToken)
    {
        await _downloads.WaitAsync(cancellationToken).ConfigureAwait(false);
        string? tempPath = null;
        try
        {
            await _remotePolicy.ApproveAsync(descriptor.DownloadUrl, cancellationToken).ConfigureAwait(false);
            var response = await SendWithRedirectsAsync(descriptor.DownloadUrl, cancellationToken).ConfigureAwait(false);
            using (response)
            {
                if (!response.IsSuccessStatusCode)
                    throw new MediaAssetCacheException("media_download_failed", $"Media download failed with HTTP {(int)response.StatusCode}.");

                var limit = _options.LimitFor(descriptor.MediaKind);
                if (response.Content.Headers.ContentLength is { } declaredLength && declaredLength > limit)
                    throw new MediaAssetCacheException("media_too_large", "Media exceeds its configured family size limit.");

                tempPath = Path.Combine(_root, $"{cacheKey}.{Guid.NewGuid():N}.tmp");
                var probe = new byte[ProbeBytes];
                var probeLength = 0;
                long length = 0;
                using var hasher = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                await using (var input = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false))
                await using (var output = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.Asynchronous | FileOptions.WriteThrough))
                {
                    var buffer = new byte[64 * 1024];
                    while (true)
                    {
                        var read = await input.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                        if (read == 0) break;
                        length += read;
                        if (length > limit) throw new MediaAssetCacheException("media_too_large", "Media exceeds its configured family size limit.");
                        if (probeLength < probe.Length)
                        {
                            var copy = Math.Min(read, probe.Length - probeLength);
                            buffer.AsSpan(0, copy).CopyTo(probe.AsSpan(probeLength));
                            probeLength += copy;
                        }
                        hasher.AppendData(buffer, 0, read);
                        await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                    }
                    await output.FlushAsync(cancellationToken).ConfigureAwait(false);
                    output.Flush(flushToDisk: true);
                }

                var responseType = response.Content.Headers.ContentType?.MediaType;
                string? declaredType;
                if (string.Equals(responseType, "application/octet-stream", StringComparison.OrdinalIgnoreCase))
                {
                    if (string.IsNullOrWhiteSpace(descriptor.ContentTypeHint))
                        throw new MediaAssetCacheException("media_type_invalid", "Generic media responses require a trusted content-type hint.");
                    declaredType = descriptor.ContentTypeHint;
                }
                else
                {
                    declaredType = responseType ?? descriptor.ContentTypeHint;
                }
                var detectedType = MediaFormatProbe.Detect(probe.AsSpan(0, probeLength), descriptor.MediaKind, declaredType);
                if (!string.IsNullOrWhiteSpace(descriptor.ContentTypeHint))
                    MediaFormatProbe.Detect(probe.AsSpan(0, probeLength), descriptor.MediaKind, descriptor.ContentTypeHint);
                var sha256 = Convert.ToHexString(hasher.GetHashAndReset()).ToLowerInvariant();

                MediaAssetCacheEntry promoted;
                lock (_sync)
                {
                    EnsureQuotaLocked(length, cacheKey);
                    InvalidateOtherVersionsLocked(organizationId, descriptor.SourceId, descriptor.AssetVersion);
                    var mediaPath = Path.Combine(_root, $"{cacheKey}.media");
                    var manifestPath = Path.Combine(_root, $"{cacheKey}.manifest.json");
                    File.Move(tempPath, mediaPath, overwrite: true);
                    tempPath = null;
                    var accessed = _clock.GetUtcNow();
                    var manifest = new MediaAssetCacheManifest(
                        cacheKey, organizationId, descriptor.SourceId, descriptor.AssetVersion,
                        detectedType, descriptor.MediaKind, sha256, length, accessed);
                    try
                    {
                        WriteManifestAtomic(manifestPath, manifest);
                    }
                    catch
                    {
                        TryDelete(mediaPath);
                        throw;
                    }
                    promoted = new MediaAssetCacheEntry(cacheKey, mediaPath, detectedType, descriptor.MediaKind, sha256, length, accessed);
                    _entries[cacheKey] = new CacheRecord(promoted, manifest);
                }
                return promoted;
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (MediaAssetCacheException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new MediaAssetCacheException("media_download_failed", "Media could not be prepared for local playback.", error);
        }
        finally
        {
            if (tempPath is not null) TryDelete(tempPath);
            _downloads.Release();
        }
    }

    private async Task<HttpResponseMessage> SendWithRedirectsAsync(Uri initial, CancellationToken cancellationToken)
    {
        var current = initial;
        for (var redirects = 0; redirects <= MaxRedirects; redirects++)
        {
            await _remotePolicy.ApproveAsync(current, cancellationToken).ConfigureAwait(false);
            using var request = new HttpRequestMessage(HttpMethod.Get, current);
            var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
            if (!IsRedirect(response.StatusCode)) return response;

            if (redirects == MaxRedirects)
            {
                response.Dispose();
                throw new MediaAssetCacheException("media_redirect_limit", "Media exceeded the redirect limit.");
            }
            var location = response.Headers.Location;
            if (location is null)
            {
                response.Dispose();
                throw new MediaAssetCacheException("media_download_failed", "Media redirect did not include a location.");
            }
            var target = location.IsAbsoluteUri ? location : new Uri(current, location);
            await _remotePolicy.ApproveAsync(target, cancellationToken).ConfigureAwait(false);
            response.Dispose();
            current = target;
        }
        throw new MediaAssetCacheException("media_redirect_limit", "Media exceeded the redirect limit.");
    }

    private bool TryGetReadyLocked(string cacheKey, out MediaAssetCacheEntry entry)
    {
        if (!_entries.TryGetValue(cacheKey, out var record))
        {
            entry = default!;
            return false;
        }
        if (!File.Exists(record.Entry.Path) || new FileInfo(record.Entry.Path).Length != record.Entry.Length)
        {
            RemoveLocked(cacheKey);
            entry = default!;
            return false;
        }
        var accessed = _clock.GetUtcNow();
        entry = record.Entry with { LastAccessedAt = accessed };
        _entries[cacheKey] = record with
        {
            Entry = entry,
            Manifest = record.Manifest with { LastAccessedAt = accessed }
        };
        return true;
    }

    private void InvalidateOtherVersionsLocked(Guid organizationId, Guid sourceId, string assetVersion)
    {
        foreach (var pair in _entries.Where(pair =>
                     pair.Value.Manifest.OrganizationId == organizationId &&
                     pair.Value.Manifest.SourceId == sourceId &&
                     !string.Equals(pair.Value.Manifest.AssetVersion, assetVersion, StringComparison.Ordinal)).ToArray())
        {
            if (_leases.GetValueOrDefault(pair.Key) == 0) RemoveLocked(pair.Key);
            else _retireWhenReleased.Add(pair.Key);
        }
    }

    private void EnsureQuotaLocked(long incomingLength, string incomingKey)
    {
        if (incomingLength > _options.TotalQuotaBytes)
            throw new MediaAssetCacheException("media_cache_full", "Media asset cannot fit within the configured cache quota.");

        long total = _entries.Values.Sum(item => item.Entry.Length);
        if (_entries.TryGetValue(incomingKey, out var replaced)) total -= replaced.Entry.Length;
        if (total + incomingLength <= _options.TotalQuotaBytes) return;

        var projected = total;
        var planned = new List<string>();
        foreach (var candidate in _entries
                     .Where(pair => pair.Key != incomingKey && _leases.GetValueOrDefault(pair.Key) == 0)
                     .OrderBy(pair => pair.Value.Entry.LastAccessedAt)
                     .ThenBy(pair => pair.Key, StringComparer.Ordinal))
        {
            projected -= candidate.Value.Entry.Length;
            planned.Add(candidate.Key);
            if (projected + incomingLength <= _options.TotalQuotaBytes) break;
        }

        if (projected + incomingLength > _options.TotalQuotaBytes)
            throw new MediaAssetCacheException("media_cache_full", "No inactive cache entry can be evicted to make room.");

        foreach (var cacheKey in planned) RemoveLocked(cacheKey);
    }

    private void Recover()
    {
        foreach (var temp in Directory.EnumerateFiles(_root, "*.tmp", SearchOption.TopDirectoryOnly)) TryDelete(temp);
        foreach (var manifestPath in Directory.EnumerateFiles(_root, "*.manifest.json", SearchOption.TopDirectoryOnly))
        {
            try
            {
                var manifest = JsonSerializer.Deserialize<MediaAssetCacheManifest>(File.ReadAllText(manifestPath), JsonOptions);
                if (manifest is null || !IsCacheKey(manifest.CacheKey) ||
                    !string.Equals(Path.GetFileName(manifestPath), $"{manifest.CacheKey}.manifest.json", StringComparison.Ordinal) ||
                    !IsCacheKey(manifest.Sha256) || manifest.Length <= 0 ||
                    manifest.MediaKind is not ("image" or "audio" or "video"))
                {
                    TryDelete(manifestPath);
                    continue;
                }
                var mediaPath = Path.Combine(_root, $"{manifest.CacheKey}.media");
                if (!File.Exists(mediaPath) || new FileInfo(mediaPath).Length != manifest.Length || !HashMatches(mediaPath, manifest.Sha256))
                {
                    TryDelete(mediaPath);
                    TryDelete(manifestPath);
                    continue;
                }
                var entry = new MediaAssetCacheEntry(
                    manifest.CacheKey, mediaPath, manifest.ContentType, manifest.MediaKind,
                    manifest.Sha256, manifest.Length, manifest.LastAccessedAt);
                _entries[manifest.CacheKey] = new CacheRecord(entry, manifest);
            }
            catch
            {
                TryDelete(manifestPath);
            }
        }

        foreach (var mediaPath in Directory.EnumerateFiles(_root, "*.media", SearchOption.TopDirectoryOnly))
        {
            var cacheKey = Path.GetFileNameWithoutExtension(mediaPath);
            if (!IsCacheKey(cacheKey) || !_entries.ContainsKey(cacheKey)) TryDelete(mediaPath);
        }
    }

    private void RemoveLocked(string cacheKey)
    {
        _retireWhenReleased.Remove(cacheKey);
        if (!_entries.Remove(cacheKey, out var record)) return;
        TryDelete(record.Entry.Path);
        TryDelete(Path.Combine(_root, $"{cacheKey}.manifest.json"));
        _leases.Remove(cacheKey);
    }

    private void ReleaseLease(string cacheKey)
    {
        lock (_sync)
        {
            var count = _leases.GetValueOrDefault(cacheKey);
            if (count <= 1)
            {
                _leases.Remove(cacheKey);
                if (_retireWhenReleased.Contains(cacheKey)) RemoveLocked(cacheKey);
            }
            else
            {
                _leases[cacheKey] = count - 1;
            }
        }
    }

    private static string CacheKey(Guid organizationId, Guid sourceId, string assetVersion)
    {
        var bytes = Encoding.UTF8.GetBytes($"{organizationId:D}|{sourceId:D}|{assetVersion}");
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }

    private static bool IsCacheKey(string value) =>
        value.Length == 64 && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    public void Dispose()
    {
        _downloads.Dispose();
        if (_ownsHttpClient) _http.Dispose();
    }

    private static bool IsRedirect(HttpStatusCode status) => (int)status is 301 or 302 or 303 or 307 or 308;

    private static bool HashMatches(string path, string expected)
    {
        using var stream = File.OpenRead(path);
        return string.Equals(Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant(), expected, StringComparison.Ordinal);
    }

    private static void WriteManifestAtomic(string path, MediaAssetCacheManifest manifest)
    {
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(manifest, JsonOptions));
        using (var stream = new FileStream(temp, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) stream.Flush(flushToDisk: true);
        File.Move(temp, path, overwrite: true);
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    private sealed record CacheRecord(MediaAssetCacheEntry Entry, MediaAssetCacheManifest Manifest);

    private sealed class Lease(MediaAssetCache owner, string cacheKey) : IDisposable
    {
        private MediaAssetCache? _owner = owner;
        public void Dispose() => Interlocked.Exchange(ref _owner, null)?.ReleaseLease(cacheKey);
    }
}
