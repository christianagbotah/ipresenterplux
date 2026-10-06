using System.Net;
using System.Text;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.Transport;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class HttpOperatorCatalogClientTests
{
    [Fact]
    public async Task FetchesCatalogWithDeviceCredentialWithoutLeakingCredentialIntoModel()
    {
        var identity = Identity();
        var serviceId = Guid.Parse("11111111-1111-4111-8111-111111111111");
        var token = new string('x', 48);
        using var http = new HttpClient(new StubHandler(request =>
        {
            Assert.Equal("/api/v1/edge/operator/catalog", request.RequestUri?.AbsolutePath);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal(token, request.Headers.Authorization?.Parameter);
            return Json(HttpStatusCode.OK, $$"""
                {"ok":true,"service":{"serviceId":"{{serviceId:D}}","title":"Sunday Worship","status":"live","activeBibleVersion":"KJV","scheduledStart":null,"startedAt":"2026-10-06T10:00:00Z"},"bibleVersions":[{"id":"KJV","name":"King James Version","abbreviation":"KJV","languageCode":"en"}],"items":[{"itemId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","itemType":"slide","title":"Welcome","body":"Welcome home","footer":null,"metadata":{"state":"queued"}}],"scriptureQueue":[{"itemId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","itemType":"scripture","title":"John 3:16","body":"For God so loved the world...","footer":"KJV","metadata":{"book":"John","chapter":"3","verses":"16","bibleVersion":"KJV"}}],"catalogRevision":"rev-42","observedAt":"2026-10-06T10:01:00Z"}
                """);
        })) { BaseAddress = new Uri("https://control.example.test") };
        var clock = new FixedTimeProvider(DateTimeOffset.Parse("2026-10-06T10:01:05Z"));
        var client = new HttpOperatorCatalogClient(http, identity, new FixedCredentialStore(Credential(identity, token)), clock);

        var catalog = await client.GetCatalogAsync(CancellationToken.None);

        Assert.Equal(serviceId, catalog.Service?.ServiceId);
        Assert.Equal("rev-42", catalog.CatalogRevision);
        Assert.Equal(clock.GetUtcNow(), catalog.SyncedAt);
        Assert.Equal(DateTimeOffset.Parse("2026-10-06T10:01:00Z"), catalog.ObservedAt);
        Assert.Single(catalog.Items);
        Assert.Single(catalog.ScriptureQueue);
        var serialized = JsonSerializer.Serialize(catalog);
        Assert.DoesNotContain(token, serialized, StringComparison.Ordinal);
        Assert.DoesNotContain("credential", serialized, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task RejectsCatalogPayloadBeyondClientSafetyCaps()
    {
        var identity = Identity();
        var serviceId = Guid.NewGuid();
        var items = string.Join(',', Enumerable.Range(0, 201).Select(i =>
            $$"""{"itemId":"item-{{i}}","itemType":"slide","title":"Slide {{i}}","body":"Body","footer":null,"metadata":{}}"""));
        using var http = new HttpClient(new StubHandler(_ => Json(HttpStatusCode.OK,
            $$"""{"ok":true,"service":{"serviceId":"{{serviceId:D}}","title":"Service","status":"live","activeBibleVersion":"KJV","scheduledStart":null,"startedAt":null},"bibleVersions":[],"items":[{{items}}],"scriptureQueue":[],"catalogRevision":"rev","observedAt":"2026-10-06T10:00:00Z"}""")))
        { BaseAddress = new Uri("https://control.example.test") };
        var client = new HttpOperatorCatalogClient(http, identity, new FixedCredentialStore(Credential(identity, new string('x', 48))));

        await Assert.ThrowsAsync<InvalidDataException>(() => client.GetCatalogAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ResolvesScriptureWithEncodedReferenceAndOptionalVersion()
    {
        var identity = Identity();
        var serviceId = Guid.NewGuid();
        using var http = new HttpClient(new StubHandler(request =>
        {
            Assert.Equal("/api/v1/edge/operator/scripture", request.RequestUri?.AbsolutePath);
            Assert.Contains("reference=John%203%3A16", request.RequestUri?.Query ?? "", StringComparison.Ordinal);
            Assert.Contains("version=KJV", request.RequestUri?.Query ?? "", StringComparison.Ordinal);
            return Json(HttpStatusCode.OK, $$"""{"ok":true,"item":{"itemId":"local-scripture-0123456789abcdef01234567","serviceId":"{{serviceId:D}}","itemType":"scripture","title":"John 3:16","body":"For God so loved the world...","footer":"KJV","metadata":{"book":"John","chapter":"3","verses":"16","bibleVersion":"KJV"}},"observedAt":"2026-10-06T10:00:00Z"}""");
        })) { BaseAddress = new Uri("https://control.example.test") };
        var client = new HttpOperatorCatalogClient(http, identity, new FixedCredentialStore(Credential(identity, new string('x', 48))));

        var resolved = await client.ResolveScriptureAsync("John 3:16", "KJV", CancellationToken.None);

        Assert.Equal(serviceId, resolved.ServiceId);
        Assert.Equal("John 3:16", resolved.Item.Title);
        Assert.Equal("KJV", resolved.Item.Footer);
    }

    private static AgentIdentity Identity() => new(
        Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"),
        "Edge", "1.0");

    private static DeviceCredential Credential(AgentIdentity identity, string token)
    {
        var issuedAt = DateTimeOffset.Parse("2026-10-06T00:00:00Z");
        return new DeviceCredential(
            new DeviceCredentialMetadata(identity, Guid.NewGuid(), issuedAt, issuedAt.AddYears(1), DeviceCredentialState.Active),
            Encoding.UTF8.GetBytes(token));
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

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
