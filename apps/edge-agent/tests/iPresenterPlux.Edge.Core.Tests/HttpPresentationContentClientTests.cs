using System.Net;
using System.Text;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Transport;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class HttpPresentationContentClientTests
{
    [Fact]
    public async Task FetchesScopedRenderItemWithDeviceCredential()
    {
        var identity = Identity();
        var itemId = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
        var serviceId = Guid.Parse("00000000-0000-4000-8000-000000000003");
        using var http = new HttpClient(new StubHandler(request =>
        {
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal(new string('x', 48), request.Headers.Authorization?.Parameter);
            Assert.Equal($"/api/v1/edge/presentation/items/{itemId:D}", request.RequestUri?.AbsolutePath);
            return Json(HttpStatusCode.OK, JsonSerializer.Serialize(new
            {
                ok = true,
                item = new
                {
                    itemId = itemId.ToString("D"),
                    serviceId = serviceId.ToString("D"),
                    itemType = "scripture",
                    title = "John 3:16",
                    body = "For God so loved the world",
                    footer = "KJV",
                    metadata = new Dictionary<string, string> { ["book"] = "John" }
                }
            }));
        })) { BaseAddress = new Uri("http://127.0.0.1:3011") };

        var client = new HttpPresentationContentClient(http, identity, new FixedCredentialStore(Credential(identity)));
        var item = await client.GetAsync(itemId.ToString("D"), CancellationToken.None);

        Assert.Equal(itemId.ToString("D"), item.ItemId);
        Assert.Equal(serviceId, item.ServiceId);
        Assert.Equal("scripture", item.ItemType);
        Assert.Equal("John 3:16", item.Title);
        Assert.Equal("KJV", item.Footer);
        Assert.Equal("John", item.Metadata["book"]);
    }


    [Fact]
    public async Task HydratesApprovedThemeAssetsWhileFetchingPresentationContent()
    {
        var identity = Identity();
        var itemId = Guid.NewGuid();
        var serviceId = Guid.NewGuid();
        var assetId = Guid.NewGuid();
        var directory = Path.Combine(Path.GetTempPath(), $"ipresenter-theme-client-{Guid.NewGuid():N}");
        try
        {
            using var http = new HttpClient(new StubHandler(request =>
            {
                if (request.RequestUri?.AbsolutePath == $"/api/v1/edge/presentation/items/{itemId:D}")
                    return Json(HttpStatusCode.OK, JsonSerializer.Serialize(new { ok=true,item=new { itemId=itemId.ToString("D"),serviceId=serviceId.ToString("D"),itemType="scripture",title="John 3:16",body="Text",footer="WEBP",metadata=new Dictionary<string,string> { [PresentationThemeAssetCache.MetadataKey]=JsonSerializer.Serialize(new Dictionary<string,string> { [assetId.ToString("D")]="https://cdn.example.invalid/theme.webp" }) } } }));
                var asset = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([7,8,9]) };
                asset.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/webp");
                return asset;
            })) { BaseAddress = new Uri("http://127.0.0.1:3011") };
            var cache = new PresentationThemeAssetCache(http,directory);
            var client = new HttpPresentationContentClient(http,identity,new FixedCredentialStore(Credential(identity)),themeAssetCache:cache);
            await client.GetAsync(itemId.ToString("D"),CancellationToken.None);
            Assert.True(cache.TryResolve(assetId,out _,out var contentType));
            Assert.Equal("image/webp",contentType);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory,true); }
    }

    private static AgentIdentity Identity() => new(
        Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"),
        "Edge", "1.0");

    private static DeviceCredential Credential(AgentIdentity identity)
    {
        var issuedAt = DateTimeOffset.Parse("2026-10-05T00:00:00Z");
        return new DeviceCredential(
            new DeviceCredentialMetadata(identity, Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"), issuedAt,
                issuedAt.AddYears(1), DeviceCredentialState.Active),
            Encoding.UTF8.GetBytes(new string('x', 48)));
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) => new(status)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json")
    };

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> handler) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(handler(request));
    }

    private sealed class FixedCredentialStore(DeviceCredential credential) : IDeviceCredentialStore
    {
        public Task<DeviceCredential?> ReadAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken) => Task.FromResult<DeviceCredential?>(credential);
        public Task<DeviceCredentialMetadata?> ReadMetadataAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken) => Task.FromResult<DeviceCredentialMetadata?>(credential.Metadata);
        public Task<bool> SaveAsync(DeviceCredential value, Guid? expectedCredentialId, CancellationToken cancellationToken) => Task.FromResult(false);
        public Task<bool> MarkRevokedAsync(DeviceCredentialMetadata revoked, Guid expectedCredentialId, CancellationToken cancellationToken) => Task.FromResult(false);
    }
}
