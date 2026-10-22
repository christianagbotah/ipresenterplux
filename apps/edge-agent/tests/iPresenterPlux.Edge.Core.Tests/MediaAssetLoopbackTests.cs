using System.Net;
using System.Net.Sockets;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class MediaAssetLoopbackTests
{
    [Theory]
    [InlineData("bytes=0-3", 10, 0, 3)]
    [InlineData("bytes=4-", 10, 4, 9)]
    [InlineData("bytes=-4", 10, 6, 9)]
    public void ParsesSupportedSingleByteRanges(string header, long length, long expectedStart, long expectedEnd)
    {
        Assert.True(HttpByteRange.TryParseSingle(header, length, out var start, out var end));
        Assert.Equal(expectedStart, start);
        Assert.Equal(expectedEnd, end);
    }

    [Theory]
    [InlineData("bytes=10-12", 10)]
    [InlineData("bytes=4-3", 10)]
    [InlineData("bytes=0-1,3-4", 10)]
    [InlineData("items=0-1", 10)]
    [InlineData("bytes=-0", 10)]
    public void RejectsInvalidOrMultiByteRanges(string header, long length)
    {
        Assert.False(HttpByteRange.TryParseSingle(header, length, out _, out _));
    }

    [Fact]
    public async Task LoopbackAssetEndpointSupportsGetHeadRangesAndSafeFailures()
    {
        var directory = TempDirectory();
        try
        {
            var bytes = Enumerable.Range(0, 16).Select(value => (byte)value).ToArray();
            var path = Path.Combine(directory, "image.png");
            await File.WriteAllBytesAsync(path, bytes);
            var cache = new FakeCache(Entry(path, bytes.LongLength));
            var preparation = new FakePreparation();
            var port = FreePort();
            await using var output = new LocalWebProgramOutputService(
                port, mediaAssetCache: cache, mediaPreparation: preparation);
            await output.StartProgramOutputAsync(CancellationToken.None);
            using var client = new HttpClient();
            var url = $"http://127.0.0.1:{port}/api/media-assets/{cache.Entry.CacheKey}";

            using (var response = await client.GetAsync(url))
            {
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                Assert.Equal(bytes, await response.Content.ReadAsByteArrayAsync());
                Assert.Contains("bytes", response.Headers.GetValues("Accept-Ranges"));
                Assert.Contains("nosniff", response.Headers.GetValues("X-Content-Type-Options"));
                Assert.Contains("immutable", response.Headers.CacheControl?.ToString() ?? string.Empty, StringComparison.OrdinalIgnoreCase);
            }

            using (var request = new HttpRequestMessage(HttpMethod.Head, url))
            using (var response = await client.SendAsync(request))
            {
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                Assert.Equal(bytes.LongLength, response.Content.Headers.ContentLength);
                Assert.Empty(await response.Content.ReadAsByteArrayAsync());
            }

            using (var request = new HttpRequestMessage(HttpMethod.Get, url))
            {
                request.Headers.TryAddWithoutValidation("Range", "bytes=2-5");
                using var response = await client.SendAsync(request);
                Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
                Assert.Equal("bytes 2-5/16", response.Content.Headers.ContentRange?.ToString());
                Assert.Equal(bytes[2..6], await response.Content.ReadAsByteArrayAsync());
            }

            using (var request = new HttpRequestMessage(HttpMethod.Get, url))
            {
                request.Headers.TryAddWithoutValidation("Range", "bytes=-4");
                using var response = await client.SendAsync(request);
                Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
                Assert.Equal(bytes[^4..], await response.Content.ReadAsByteArrayAsync());
            }

            using (var request = new HttpRequestMessage(HttpMethod.Get, url))
            {
                request.Headers.TryAddWithoutValidation("Range", "bytes=0-1,3-4");
                using var response = await client.SendAsync(request);
                Assert.Equal(HttpStatusCode.RequestedRangeNotSatisfiable, response.StatusCode);
                Assert.Equal("bytes */16", response.Content.Headers.ContentRange?.ToString());
            }

            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"http://127.0.0.1:{port}/api/media-assets/{new string('b', 64)}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"http://127.0.0.1:{port}/api/media-assets/not-a-cache-key")).StatusCode);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task ReadyImageStateAndPageUseOnlyLoopbackAssetIdentity()
    {
        var directory = TempDirectory();
        try
        {
            var bytes = new byte[] { 1, 2, 3, 4 };
            var path = Path.Combine(directory, "image.png");
            await File.WriteAllBytesAsync(path, bytes);
            var cache = new FakeCache(Entry(path, bytes.LongLength));
            var serviceId = Guid.NewGuid();
            var itemId = Guid.NewGuid().ToString("D");
            var descriptor = new PresentationMediaDescriptor(
                Guid.NewGuid(), "image", new Uri("https://cdn.example.test/worship.png"),
                "asset-v1", "image/png", "Worship Image", 0, null, false, 1, "cover").Validate();
            var asset = new PreparedMediaAsset(
                itemId, serviceId, cache.Entry.CacheKey, path, "image/png", "image", null, descriptor);
            var preparation = new FakePreparation(new MediaPreparationSnapshot(
                itemId, serviceId, MediaPreparationState.Ready, asset, null), cache);
            var item = new PresentationRenderItem(
                itemId, serviceId, "media", "Worship Image", "", null,
                new Dictionary<string, string>(), descriptor);
            var port = FreePort();
            await using var output = new LocalWebProgramOutputService(
                port, mediaAssetCache: cache, mediaPreparation: preparation);

            await output.SetPreviewAsync(item, CancellationToken.None);
            await output.TakePreviewToProgramAsync(CancellationToken.None);
            await output.StartProgramOutputAsync(CancellationToken.None);
            using var client = new HttpClient();
            var state = await client.GetStringAsync($"http://127.0.0.1:{port}/api/state/program");
            var page = await client.GetStringAsync($"http://127.0.0.1:{port}/program");

            Assert.Contains($"/api/media-assets/{cache.Entry.CacheKey}", state, StringComparison.Ordinal);
            Assert.Contains("\"mediaKind\":\"image\"", state, StringComparison.Ordinal);
            Assert.Contains("\"contentType\":\"image/png\"", state, StringComparison.Ordinal);
            Assert.Contains("\"fit\":\"cover\"", state, StringComparison.Ordinal);
            Assert.Contains("\"preparationState\":\"ready\"", state, StringComparison.Ordinal);
            Assert.DoesNotContain("cdn.example.test", state, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("downloadUrl", state, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(path, state, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("id=\"media-image\"", page, StringComparison.Ordinal);
            Assert.Contains("media-image-active", page, StringComparison.Ordinal);
            Assert.Contains("objectFit", page, StringComparison.Ordinal);
            Assert.DoesNotContain("cdn.example.test", page, StringComparison.OrdinalIgnoreCase);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task ReadyVideoProgramStateExposesPlaybackClockAndOnlyLoopbackAssetIdentity()
    {
        var directory = TempDirectory();
        try
        {
            var bytes = new byte[] { 0, 1, 2, 3, 4, 5 };
            var path = Path.Combine(directory, "video.mp4");
            await File.WriteAllBytesAsync(path, bytes);
            var entry = new MediaAssetCacheEntry(
                new string('c', 64), path, "video/mp4", "video", new string('d', 64),
                bytes.LongLength, DateTimeOffset.UtcNow);
            var cache = new FakeCache(entry);
            var serviceId = Guid.NewGuid();
            var itemId = Guid.NewGuid().ToString("D");
            var descriptor = new PresentationMediaDescriptor(
                Guid.NewGuid(), "video", new Uri("https://cdn.example.test/worship.mp4"),
                "asset-video-v1", "video/mp4", "Worship Video", 1, 8, false, .75, "contain").Validate();
            var asset = new PreparedMediaAsset(
                itemId, serviceId, entry.CacheKey, path, "video/mp4", "video",
                TimeSpan.FromSeconds(8), descriptor);
            var preparation = new FakePreparation(new MediaPreparationSnapshot(
                itemId, serviceId, MediaPreparationState.Ready, asset, null), cache);
            var playback = new MediaPlaybackCoordinator();
            var item = new PresentationRenderItem(
                itemId, serviceId, "media", "Worship Video", "", null,
                new Dictionary<string, string>(), descriptor);
            var port = FreePort();
            await using var output = new LocalWebProgramOutputService(
                port, mediaAssetCache: cache, mediaPreparation: preparation, mediaPlayback: playback);

            await output.SetActiveServiceAsync(serviceId, CancellationToken.None);
            await output.SetPreviewAsync(item, CancellationToken.None);
            await output.TakePreviewToProgramAsync(CancellationToken.None);
            await output.StartProgramOutputAsync(CancellationToken.None);
            using var client = new HttpClient();

            var state = await client.GetStringAsync($"http://127.0.0.1:{port}/api/state/program");

            Assert.Contains($"/api/media-assets/{entry.CacheKey}", state, StringComparison.Ordinal);
            Assert.Contains("\"mediaKind\":\"video\"", state, StringComparison.Ordinal);
            Assert.Contains("\"playback\":{", state, StringComparison.Ordinal);
            Assert.Contains("\"revision\":", state, StringComparison.Ordinal);
            Assert.Contains("\"state\":\"playing\"", state, StringComparison.Ordinal);
            Assert.Contains("\"effectivePositionSeconds\":", state, StringComparison.Ordinal);
            Assert.Contains("\"serverTimeUtc\":", state, StringComparison.Ordinal);
            Assert.DoesNotContain("cdn.example.test", state, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("https://", state, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("downloadUrl", state, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(path, state, StringComparison.OrdinalIgnoreCase);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task PreviewReplacementReleasesReadyMediaLease()
    {
        var directory = TempDirectory();
        try
        {
            var path = Path.Combine(directory, "image.png");
            await File.WriteAllBytesAsync(path, [1, 2, 3, 4]);
            var cache = new FakeCache(Entry(path, 4));
            var serviceId = Guid.NewGuid();
            var itemId = Guid.NewGuid().ToString("D");
            var descriptor = new PresentationMediaDescriptor(
                Guid.NewGuid(), "image", new Uri("https://cdn.example.test/image.png"),
                "v1", "image/png", "Image", 0, null, false, 1, "contain").Validate();
            var asset = new PreparedMediaAsset(itemId, serviceId, cache.Entry.CacheKey, path, "image/png", "image", null, descriptor);
            var preparation = new FakePreparation(new MediaPreparationSnapshot(itemId, serviceId, MediaPreparationState.Ready, asset, null), cache);
            await using var output = new LocalWebProgramOutputService(
                FreePort(), mediaAssetCache: cache, mediaPreparation: preparation);

            await output.SetPreviewAsync(new PresentationRenderItem(
                itemId, serviceId, "media", "Image", "", null, new Dictionary<string,string>(), descriptor), CancellationToken.None);
            Assert.Equal(1, preparation.ActiveLeases);

            await output.SetPreviewAsync(new PresentationRenderItem(
                "slide-1", serviceId, "slide", "Welcome", "Hello", null, new Dictionary<string,string>()), CancellationToken.None);
            Assert.Equal(0, preparation.ActiveLeases);
        }
        finally { Directory.Delete(directory, true); }
    }

    private static MediaAssetCacheEntry Entry(string path, long length) => new(
        new string('a', 64), path, "image/png", "image", new string('b', 64), length, DateTimeOffset.UtcNow);

    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try { return ((IPEndPoint)listener.LocalEndpoint).Port; }
        finally { listener.Stop(); }
    }

    private static string TempDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenter-media-loopback-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        return directory;
    }

    private sealed class FakeCache(MediaAssetCacheEntry entry) : IMediaAssetCache
    {
        public MediaAssetCacheEntry Entry { get; } = entry;
        public Task<MediaAssetCacheEntry> PrepareAsync(Guid organizationId, PresentationMediaDescriptor descriptor, CancellationToken cancellationToken) => Task.FromResult(Entry);
        public bool TryGetReady(string cacheKey, out MediaAssetCacheEntry ready)
        {
            if (string.Equals(cacheKey, Entry.CacheKey, StringComparison.Ordinal)) { ready = Entry; return true; }
            ready = default!; return false;
        }
        public IDisposable AcquireLease(string cacheKey) => new NoopLease();
        private sealed class NoopLease : IDisposable { public void Dispose() { } }
    }

    private sealed class FakePreparation : IMediaPreparationCoordinator
    {
        private readonly MediaPreparationSnapshot? _snapshot;
        private readonly IMediaAssetCache? _cache;
        public int ActiveLeases { get; private set; }
        public FakePreparation(MediaPreparationSnapshot? snapshot = null, IMediaAssetCache? cache = null) { _snapshot = snapshot; _cache = cache; }
        public event EventHandler<MediaPreparationSnapshot>? StatusChanged { add { } remove { } }
        public Task<MediaPreparationSnapshot> PrepareAsync(PresentationRenderItem item, CancellationToken cancellationToken) =>
            Task.FromResult(_snapshot ?? new MediaPreparationSnapshot(item.ItemId, item.ServiceId, MediaPreparationState.NotRequired, null, null));
        public MediaPreparationSnapshot? TryGet(string itemId) => _snapshot is not null && _snapshot.ItemId == itemId ? _snapshot : null;
        public Task PrefetchAsync(Guid serviceId, IReadOnlyList<OperatorCatalogItem> items, CancellationToken cancellationToken) => Task.CompletedTask;
        public IDisposable AcquireReadyLease(string itemId)
        {
            if (_snapshot?.State != MediaPreparationState.Ready || _snapshot.Asset is null || _cache is null)
                throw new MediaAssetCacheException("media_not_ready", "not ready");
            var inner = _cache.AcquireLease(_snapshot.Asset.CacheKey);
            ActiveLeases++;
            return new CountedLease(this, inner);
        }
        public Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken) => Task.CompletedTask;
        private sealed class CountedLease(FakePreparation owner, IDisposable inner) : IDisposable
        {
            private FakePreparation? _owner = owner;
            public void Dispose()
            {
                var current = Interlocked.Exchange(ref _owner, null);
                if (current is null) return;
                inner.Dispose(); current.ActiveLeases--;
            }
        }
    }
}
