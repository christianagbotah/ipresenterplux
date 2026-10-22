using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class PresentationThemeAssetCacheTests
{
    [Fact]
    public async Task DownloadsApprovedImageOnceAndResolvesLoopbackAsset()
    {
        var assetId = Guid.NewGuid();
        var requests = 0;
        using var http = new HttpClient(new StubHandler(request =>
        {
            requests++;
            Assert.Equal(Uri.UriSchemeHttps, request.RequestUri?.Scheme);
            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([1,2,3,4]) };
            response.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            return response;
        }));
        var directory = Path.Combine(Path.GetTempPath(), $"ipresenter-theme-assets-{Guid.NewGuid():N}");
        try
        {
            var cache = new PresentationThemeAssetCache(http, directory);
            var metadata = new Dictionary<string,string> { [PresentationThemeAssetCache.MetadataKey] = JsonSerializer.Serialize(new Dictionary<string,string> { [assetId.ToString("D")] = "https://cdn.example.invalid/logo.png" }) };
            await cache.HydrateAsync(metadata, CancellationToken.None);
            await cache.HydrateAsync(metadata, CancellationToken.None);
            Assert.Equal(1, requests);
            Assert.True(cache.TryResolve(assetId, out var path, out var contentType));
            Assert.Equal("image/png", contentType);
            Assert.Equal([1,2,3,4], await File.ReadAllBytesAsync(path));
            var theme = PresentationThemeMetadata.Default with { Background = new PresentationThemeBackground("image", assetId.ToString("D")) };
            Assert.Equal($"/api/theme-assets/{assetId:D}", cache.AvailableLoopbackUrls(theme)[assetId.ToString("D")]);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Theory]
    [InlineData("http://example.invalid/a.png", "image/png")]
    [InlineData("https://example.invalid/a.svg", "image/svg+xml")]
    [InlineData("https://127.0.0.1/a.png", "image/png")]
    public async Task RejectsUnsafeOrUnsupportedThemeAssets(string url, string mediaType)
    {
        var assetId = Guid.NewGuid();
        using var http = new HttpClient(new StubHandler(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes("not-an-approved-image")) };
            response.Content.Headers.ContentType = new MediaTypeHeaderValue(mediaType);
            return response;
        }));
        var directory = Path.Combine(Path.GetTempPath(), $"ipresenter-theme-assets-{Guid.NewGuid():N}");
        try
        {
            var cache = new PresentationThemeAssetCache(http, directory);
            await cache.HydrateAsync(new Dictionary<string,string> { [PresentationThemeAssetCache.MetadataKey] = JsonSerializer.Serialize(new Dictionary<string,string> { [assetId.ToString("D")] = url }) }, CancellationToken.None);
            Assert.False(cache.TryResolve(assetId, out _, out _));
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    private sealed class StubHandler(Func<HttpRequestMessage,HttpResponseMessage> handler) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(handler(request));
    }
}
