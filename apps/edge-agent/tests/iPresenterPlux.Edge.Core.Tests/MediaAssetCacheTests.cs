using System.Net;
using System.Net.Http.Headers;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class MediaAssetCacheTests
{
    private static readonly byte[] Png = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
    private static readonly byte[] Mp3 = [(byte)'I',(byte)'D',(byte)'3',4,0,0,0,0,0,0];
    private static readonly byte[] Mp4 = [0,0,0,24,(byte)'f',(byte)'t',(byte)'y',(byte)'p',(byte)'i',(byte)'s',(byte)'o',(byte)'m'];
    private static readonly IPAddress PublicAddress = IPAddress.Parse("93.184.216.34");

    [Fact]
    public async Task PreparesOneValidatedAssetPerSupportedFamily()
    {
        foreach (var fixture in new[]
        {
            (Kind: "image", Type: "image/png", Bytes: Png),
            (Kind: "audio", Type: "audio/mpeg", Bytes: Mp3),
            (Kind: "video", Type: "video/mp4", Bytes: Mp4),
        })
        {
            var directory = TempDirectory();
            try
            {
                using var http = Client((_, _) => Task.FromResult(Response(fixture.Bytes, fixture.Type)));
                var cache = Cache(directory, http);
                var descriptor = Descriptor(fixture.Kind, fixture.Type);

                var entry = await cache.PrepareAsync(Guid.NewGuid(), descriptor, CancellationToken.None);

                Assert.Equal(fixture.Kind, entry.MediaKind);
                Assert.Equal(fixture.Type, entry.ContentType);
                Assert.Equal(fixture.Bytes.LongLength, entry.Length);
                Assert.Equal(64, entry.Sha256.Length);
                Assert.True(File.Exists(entry.Path));
                Assert.Equal(fixture.Bytes, await File.ReadAllBytesAsync(entry.Path));
                Assert.True(cache.TryGetReady(entry.CacheKey, out var resolved));
                Assert.Equal(entry.Path, resolved.Path);
            }
            finally { Delete(directory); }
        }
    }

    [Fact]
    public async Task EnforcesExactSizeLimitWithAndWithoutContentLength()
    {
        foreach (var includeLength in new[] { true, false })
        {
            var directory = TempDirectory();
            try
            {
                var calls = 0;
                using var http = Client((_, _) =>
                {
                    calls++;
                    var bytes = calls == 1 ? Png : Png.Concat(new byte[] { 0 }).ToArray();
                    return Task.FromResult(Response(bytes, "image/png", includeLength));
                });
                var cache = Cache(directory, http, new MediaAssetCacheOptions(ImageLimitBytes: Png.Length));

                var exact = await cache.PrepareAsync(Guid.NewGuid(), Descriptor("image", "image/png", "v1"), CancellationToken.None);
                Assert.Equal(Png.Length, exact.Length);

                var error = await Assert.ThrowsAsync<MediaAssetCacheException>(() =>
                    cache.PrepareAsync(Guid.NewGuid(), Descriptor("image", "image/png", "v2"), CancellationToken.None));
                Assert.Equal("media_too_large", error.Code);
                Assert.Empty(Directory.GetFiles(directory, "*.tmp", SearchOption.AllDirectories));
            }
            finally { Delete(directory); }
        }
    }

    [Fact]
    public async Task ConcurrentCallersForSameCacheKeyShareOneTransfer()
    {
        var directory = TempDirectory();
        try
        {
            var calls = 0;
            var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            using var http = Client(async (_, cancellationToken) =>
            {
                Interlocked.Increment(ref calls);
                await release.Task.WaitAsync(cancellationToken);
                return Response(Mp4, "video/mp4");
            });
            var cache = Cache(directory, http);
            var organizationId = Guid.NewGuid();
            var descriptor = Descriptor("video", "video/mp4");

            var first = cache.PrepareAsync(organizationId, descriptor, CancellationToken.None);
            var second = cache.PrepareAsync(organizationId, descriptor, CancellationToken.None);
            release.SetResult();
            var entries = await Task.WhenAll(first, second);

            Assert.Equal(1, calls);
            Assert.Equal(entries[0].CacheKey, entries[1].CacheKey);
            Assert.Equal(entries[0].Path, entries[1].Path);
        }
        finally { Delete(directory); }
    }

    [Fact]
    public async Task CancellationDuringTransferRemovesTempFileAndAllowsRetry()
    {
        var directory = TempDirectory();
        try
        {
            var calls = 0;
            using var http = Client((_, _) =>
            {
                calls++;
                if (calls == 1)
                {
                    var response = new HttpResponseMessage(HttpStatusCode.OK)
                    {
                        Content = new StreamContent(new CancelAfterPrefixStream(Png[..4]))
                    };
                    response.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
                    return Task.FromResult(response);
                }
                return Task.FromResult(Response(Png, "image/png"));
            });
            var cache = Cache(directory, http);
            var organizationId = Guid.NewGuid();
            var descriptor = Descriptor("image", "image/png");
            using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                cache.PrepareAsync(organizationId, descriptor, cts.Token));
            Assert.Empty(Directory.GetFiles(directory, "*.tmp", SearchOption.AllDirectories));

            var entry = await cache.PrepareAsync(organizationId, descriptor, CancellationToken.None);
            Assert.True(File.Exists(entry.Path));
            Assert.Equal(2, calls);
        }
        finally { Delete(directory); }
    }

    [Fact]
    public async Task RejectsTypeSpoofWithoutPromotingFile()
    {
        var directory = TempDirectory();
        try
        {
            using var http = Client((_, _) => Task.FromResult(Response("not png"u8.ToArray(), "image/png")));
            var cache = Cache(directory, http);

            var error = await Assert.ThrowsAsync<MediaAssetCacheException>(() =>
                cache.PrepareAsync(Guid.NewGuid(), Descriptor("image", "image/png"), CancellationToken.None));

            Assert.Equal("media_type_invalid", error.Code);
            Assert.Empty(Directory.GetFiles(directory, "*.tmp", SearchOption.AllDirectories));
            Assert.Empty(Directory.GetFiles(directory, "*.media", SearchOption.AllDirectories));
        }
        finally { Delete(directory); }
    }

    [Fact]
    public async Task AssetVersionChangeInvalidatesOlderSourceVersion()
    {
        var directory = TempDirectory();
        try
        {
            using var http = Client((_, _) => Task.FromResult(Response(Png, "image/png")));
            var cache = Cache(directory, http);
            var organizationId = Guid.NewGuid();
            var sourceId = Guid.NewGuid();
            var first = await cache.PrepareAsync(organizationId, Descriptor("image", "image/png", "v1", sourceId), CancellationToken.None);
            var second = await cache.PrepareAsync(organizationId, Descriptor("image", "image/png", "v2", sourceId), CancellationToken.None);

            Assert.NotEqual(first.CacheKey, second.CacheKey);
            Assert.False(cache.TryGetReady(first.CacheKey, out _));
            Assert.False(File.Exists(first.Path));
            Assert.True(cache.TryGetReady(second.CacheKey, out _));
        }
        finally { Delete(directory); }
    }

    [Fact]
    public async Task ReloadInvalidatesEntryWhenFileNoLongerMatchesManifestHash()
    {
        var directory = TempDirectory();
        try
        {
            using var http = Client((_, _) => Task.FromResult(Response(Png, "image/png")));
            var firstCache = Cache(directory, http);
            var entry = await firstCache.PrepareAsync(Guid.NewGuid(), Descriptor("image", "image/png"), CancellationToken.None);
            await File.AppendAllBytesAsync(entry.Path, [0x00]);

            var reloaded = Cache(directory, http);

            Assert.False(reloaded.TryGetReady(entry.CacheKey, out _));
            Assert.False(File.Exists(entry.Path));
        }
        finally { Delete(directory); }
    }

    [Fact]
    public async Task LruEvictionSkipsActiveLease()
    {
        var directory = TempDirectory();
        try
        {
            using var http = Client((_, _) => Task.FromResult(Response(Png, "image/png")));
            var clock = new ManualTimeProvider(DateTimeOffset.Parse("2026-10-22T10:00:00Z"));
            var cache = Cache(directory, http, new MediaAssetCacheOptions(TotalQuotaBytes: Png.Length * 2), clock);
            var organizationId = Guid.NewGuid();
            var first = await cache.PrepareAsync(organizationId, Descriptor("image", "image/png", "a", Guid.NewGuid()), CancellationToken.None);
            clock.Advance(TimeSpan.FromSeconds(1));
            var second = await cache.PrepareAsync(organizationId, Descriptor("image", "image/png", "b", Guid.NewGuid()), CancellationToken.None);
            using var lease = cache.AcquireLease(first.CacheKey);
            clock.Advance(TimeSpan.FromSeconds(1));
            var third = await cache.PrepareAsync(organizationId, Descriptor("image", "image/png", "c", Guid.NewGuid()), CancellationToken.None);

            Assert.True(cache.TryGetReady(first.CacheKey, out _));
            Assert.False(cache.TryGetReady(second.CacheKey, out _));
            Assert.True(cache.TryGetReady(third.CacheKey, out _));
        }
        finally { Delete(directory); }
    }

    [Fact]
    public async Task ReportsCacheFullWhenOnlyEvictionCandidateIsLeased()
    {
        var directory = TempDirectory();
        try
        {
            using var http = Client((_, _) => Task.FromResult(Response(Png, "image/png")));
            var cache = Cache(directory, http, new MediaAssetCacheOptions(TotalQuotaBytes: Png.Length));
            var organizationId = Guid.NewGuid();
            var first = await cache.PrepareAsync(organizationId, Descriptor("image", "image/png", "a", Guid.NewGuid()), CancellationToken.None);
            using var lease = cache.AcquireLease(first.CacheKey);

            var error = await Assert.ThrowsAsync<MediaAssetCacheException>(() =>
                cache.PrepareAsync(organizationId, Descriptor("image", "image/png", "b", Guid.NewGuid()), CancellationToken.None));

            Assert.Equal("media_cache_full", error.Code);
            Assert.True(cache.TryGetReady(first.CacheKey, out _));
        }
        finally { Delete(directory); }
    }

    [Fact]
    public void ExposesProductionConstructorThatOwnsPolicyControlledTransport()
    {
        var signature = new[]
        {
            typeof(string), typeof(MediaRemoteEndpointPolicy), typeof(MediaAssetCacheOptions), typeof(TimeProvider)
        };
        Assert.NotNull(typeof(MediaAssetCache).GetConstructor(signature));
    }

    [Fact]
    public async Task AllowsGenericOctetStreamOnlyWhenTrustedHintMatchesDetectedBytes()
    {
        var directory = TempDirectory();
        try
        {
            using var http = Client((_, _) => Task.FromResult(Response(Mp4, "application/octet-stream")));
            var cache = Cache(directory, http);

            var entry = await cache.PrepareAsync(Guid.NewGuid(), Descriptor("video", "video/mp4"), CancellationToken.None);

            Assert.Equal("video/mp4", entry.ContentType);
        }
        finally { Delete(directory); }
    }

    [Fact]
    public async Task SupersededLeasedVersionIsRetiredWhenLeaseEnds()
    {
        var directory = TempDirectory();
        try
        {
            using var http = Client((_, _) => Task.FromResult(Response(Png, "image/png")));
            var cache = Cache(directory, http);
            var organizationId = Guid.NewGuid();
            var sourceId = Guid.NewGuid();
            var first = await cache.PrepareAsync(organizationId, Descriptor("image", "image/png", "v1", sourceId), CancellationToken.None);
            var lease = cache.AcquireLease(first.CacheKey);
            var second = await cache.PrepareAsync(organizationId, Descriptor("image", "image/png", "v2", sourceId), CancellationToken.None);

            Assert.True(cache.TryGetReady(first.CacheKey, out _));
            Assert.True(cache.TryGetReady(second.CacheKey, out _));
            lease.Dispose();

            Assert.False(cache.TryGetReady(first.CacheKey, out _));
            Assert.False(File.Exists(first.Path));
        }
        finally { Delete(directory); }
    }

    [Fact]
    public void RecoveryDeletesOrphanMediaFileWithoutManifest()
    {
        var directory = TempDirectory();
        try
        {
            var orphan = Path.Combine(directory, $"{new string('a', 64)}.media");
            File.WriteAllBytes(orphan, Png);
            using var http = Client((_, _) => Task.FromResult(Response(Png, "image/png")));

            _ = Cache(directory, http);

            Assert.False(File.Exists(orphan));
        }
        finally { Delete(directory); }
    }

    [Fact]
    public async Task FailedOversizedReplacementPreservesLastReadyVersion()
    {
        var directory = TempDirectory();
        try
        {
            var calls = 0;
            using var http = Client((_, _) =>
            {
                calls++;
                var bytes = calls == 1 ? Png : Png.Concat(new byte[] { 0x00 }).ToArray();
                return Task.FromResult(Response(bytes, "image/png"));
            });
            var options = new MediaAssetCacheOptions(ImageLimitBytes: Png.Length + 1, TotalQuotaBytes: Png.Length);
            var cache = Cache(directory, http, options);
            var organizationId = Guid.NewGuid();
            var sourceId = Guid.NewGuid();
            var first = await cache.PrepareAsync(organizationId, Descriptor("image", "image/png", "v1", sourceId), CancellationToken.None);

            var error = await Assert.ThrowsAsync<MediaAssetCacheException>(() =>
                cache.PrepareAsync(organizationId, Descriptor("image", "image/png", "v2", sourceId), CancellationToken.None));

            Assert.Equal("media_cache_full", error.Code);
            Assert.True(cache.TryGetReady(first.CacheKey, out _));
            Assert.True(File.Exists(first.Path));
        }
        finally { Delete(directory); }
    }

    [Fact]
    public async Task RedirectToPrivateDestinationIsRejectedBeforeSecondRequestOrBodyRead()
    {
        var directory = TempDirectory();
        try
        {
            var requests = 0;
            using var http = Client((_, _) =>
            {
                requests++;
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Redirect)
                {
                    Headers = { Location = new Uri("https://127.0.0.1/private.mp4") },
                    Content = new ThrowIfReadContent()
                });
            });
            var cache = Cache(directory, http);

            var error = await Assert.ThrowsAsync<MediaAssetCacheException>(() =>
                cache.PrepareAsync(Guid.NewGuid(), Descriptor("video", "video/mp4"), CancellationToken.None));

            Assert.Equal("media_remote_unsafe", error.Code);
            Assert.Equal(1, requests);
        }
        finally { Delete(directory); }
    }

    private static MediaAssetCache Cache(
        string directory,
        HttpClient http,
        MediaAssetCacheOptions? options = null,
        TimeProvider? clock = null) =>
        new(directory, http, Policy(), options, clock);

    private static MediaRemoteEndpointPolicy Policy() =>
        new((_, _) => Task.FromResult(new[] { PublicAddress }));

    private static PresentationMediaDescriptor Descriptor(
        string kind,
        string contentType,
        string version = "v1",
        Guid? sourceId = null) =>
        new PresentationMediaDescriptor(sourceId ?? Guid.NewGuid(), kind, new Uri($"https://cdn.example.test/{sourceId ?? Guid.Empty}/{version}.bin"),
            version, contentType, "Fixture", 0, null, false, 1, "contain").Validate();

    private static HttpClient Client(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> handler) =>
        new(new StubHandler(handler), disposeHandler: true);

    private static HttpResponseMessage Response(byte[] bytes, string contentType, bool includeLength = true)
    {
        HttpContent content = includeLength ? new ByteArrayContent(bytes) : new UnknownLengthContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        if (!includeLength) content.Headers.ContentLength = null;
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
    }

    private static string TempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "ipresenter-media-cache-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static void Delete(string path)
    {
        if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
    }

    private sealed class StubHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> handler) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            handler(request, cancellationToken);
    }

    private sealed class UnknownLengthContent(byte[] bytes) : HttpContent
    {
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => stream.WriteAsync(bytes).AsTask();
        protected override bool TryComputeLength(out long length) { length = 0; return false; }
    }

    private sealed class ThrowIfReadContent : HttpContent
    {
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            throw new InvalidOperationException("Redirect response body must not be read.");
        protected override bool TryComputeLength(out long length) { length = 0; return false; }
    }

    private sealed class CancelAfterPrefixStream(byte[] prefix) : Stream
    {
        private int _offset;
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => _offset; set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            if (_offset < prefix.Length)
            {
                var count = Math.Min(buffer.Length, prefix.Length - _offset);
                prefix.AsMemory(_offset, count).CopyTo(buffer);
                _offset += count;
                return count;
            }
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return 0;
        }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    private sealed class ManualTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan delta) => _now += delta;
    }
}
