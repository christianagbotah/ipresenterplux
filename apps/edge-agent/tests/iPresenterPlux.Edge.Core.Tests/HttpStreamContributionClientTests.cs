using System.Net;
using System.Text;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Transport;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class HttpStreamContributionClientTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-06T02:00:00Z");

    [Fact]
    public async Task FetchesScopedShortLivedSrtGrantWithDeviceCredential()
    {
        var identity = Identity();
        var serviceId = Guid.Parse("00000000-0000-4000-8000-000000000003");
        var sessionId = Guid.Parse("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
        var streamPath = $"edge-{sessionId:D}";
        using var http = new HttpClient(new StubHandler(request =>
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("/api/v1/edge/stream/contribution", request.RequestUri?.AbsolutePath);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal(new string('x', 48), request.Headers.Authorization?.Parameter);
            Assert.True(request.Headers.CacheControl?.NoStore);
            Assert.True(request.Headers.CacheControl?.NoCache);
            return Json(HttpStatusCode.OK, JsonSerializer.Serialize(new
            {
                ok = true,
                contribution = new
                {
                    sessionId = sessionId.ToString("D"),
                    serviceId = serviceId.ToString("D"),
                    streamPath,
                    protocol = "srt",
                    publishUrl = $"srt://router.example.test:8890?streamid=publish%3A{streamPath}%3Aedge%3Aone-time-secret&pkt_size=1316",
                    expiresAt = Now.AddMinutes(5).ToString("O")
                }
            }));
        })) { BaseAddress = new Uri("http://127.0.0.1:3011") };

        var client = new HttpStreamContributionClient(
            http, identity, new FixedCredentialStore(Credential(identity)), new FixedTimeProvider(Now));
        var grant = await client.GetAsync(serviceId, CancellationToken.None);

        Assert.Equal(sessionId, grant.SessionId);
        Assert.Equal(serviceId, grant.ServiceId);
        Assert.Equal(streamPath, grant.StreamPath);
        Assert.Equal("srt", grant.Protocol);
        Assert.Equal("srt", grant.PublishUri.Scheme);
        Assert.Equal(Now.AddMinutes(5), grant.ExpiresAt);
        Assert.Contains("one-time-secret", grant.PublishUri.Query);
    }

    [Fact]
    public async Task RejectsGrantForDifferentService()
    {
        var identity = Identity();
        var expectedServiceId = Guid.NewGuid();
        var returnedServiceId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var streamPath = $"edge-{sessionId:D}";
        using var http = new HttpClient(new StubHandler(_ => Json(HttpStatusCode.OK, JsonSerializer.Serialize(new
        {
            ok = true,
            contribution = new
            {
                sessionId = sessionId.ToString("D"),
                serviceId = returnedServiceId.ToString("D"),
                streamPath,
                protocol = "srt",
                publishUrl = $"srt://router.example.test:8890?streamid=publish%3A{streamPath}%3Aedge%3Asecret&pkt_size=1316",
                expiresAt = Now.AddMinutes(5).ToString("O")
            }
        })))) { BaseAddress = new Uri("http://127.0.0.1:3011") };

        var client = new HttpStreamContributionClient(
            http, identity, new FixedCredentialStore(Credential(identity)), new FixedTimeProvider(Now));

        await Assert.ThrowsAsync<InvalidDataException>(() => client.GetAsync(expectedServiceId, CancellationToken.None));
    }

    [Theory]
    [InlineData("rtmp://router.example.test/live", "srt", 300)]
    [InlineData("srt://router.example.test:8890?streamid=publish%3Awrong-path%3Aedge%3Asecret&pkt_size=1316", "srt", 300)]
    [InlineData("srt://router.example.test:8890?streamid=publish%3Aedge-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee%3Aedge%3Asecret&pkt_size=1200", "srt", 300)]
    [InlineData("srt://router.example.test:8890?streamid=publish%3Aedge-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee%3Aedge%3Asecret&pkt_size=1316", "srt", 10)]
    [InlineData("srt://router.example.test:8890?streamid=publish%3Aedge-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee%3Aedge%3Asecret&pkt_size=1316", "rtmps", 300)]
    public async Task RejectsUnsafeOrStaleGrant(string publishUrl, string protocol, int lifetimeSeconds)
    {
        var identity = Identity();
        var serviceId = Guid.NewGuid();
        var sessionId = Guid.Parse("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
        const string streamPath = "edge-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        using var http = new HttpClient(new StubHandler(_ => Json(HttpStatusCode.OK, JsonSerializer.Serialize(new
        {
            ok = true,
            contribution = new
            {
                sessionId = sessionId.ToString("D"),
                serviceId = serviceId.ToString("D"),
                streamPath,
                protocol,
                publishUrl,
                expiresAt = Now.AddSeconds(lifetimeSeconds).ToString("O")
            }
        })))) { BaseAddress = new Uri("http://127.0.0.1:3011") };

        var client = new HttpStreamContributionClient(
            http, identity, new FixedCredentialStore(Credential(identity)), new FixedTimeProvider(Now));

        await Assert.ThrowsAsync<InvalidDataException>(() => client.GetAsync(serviceId, CancellationToken.None));
    }

    private static AgentIdentity Identity() => new(
        Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"),
        "Edge", "1.0");

    private static DeviceCredential Credential(AgentIdentity identity)
    {
        var issuedAt = Now.AddDays(-1);
        return new DeviceCredential(
            new DeviceCredentialMetadata(identity, Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"), issuedAt,
                Now.AddDays(1), DeviceCredentialState.Active),
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

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
