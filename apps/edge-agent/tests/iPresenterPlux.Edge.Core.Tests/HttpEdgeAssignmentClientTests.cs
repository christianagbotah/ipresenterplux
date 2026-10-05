using System.Net;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Transport;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class HttpEdgeAssignmentClientTests
{
    [Fact]
    public async Task ReadsAssignedServiceWithDeviceBearerCredential()
    {
        var serviceId = Guid.Parse("00000000-0000-4000-8000-000000000003");
        var identity = Identity();
        var store = new FixedCredentialStore(Credential(identity));
        using var http = new HttpClient(new StubHandler(request =>
        {
            Assert.Equal("/api/v1/edge/assignment", request.RequestUri?.AbsolutePath);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal(new string('x', 48), request.Headers.Authorization?.Parameter);
            return Json(HttpStatusCode.OK,
                $$"""{"ok":true,"assignment":{"serviceId":"{{serviceId:D}}","title":"Sunday Worship","status":"live","campusId":"{{identity.CampusId:D}}"},"observedAt":"2026-10-05T11:00:00Z"}""");
        })) { BaseAddress = new Uri("http://127.0.0.1:3011") };

        var assignment = await new HttpEdgeAssignmentClient(http, identity, store).GetAsync();

        Assert.NotNull(assignment);
        Assert.Equal(serviceId, assignment.ServiceId);
        Assert.Equal("Sunday Worship", assignment.Title);
        Assert.Equal("live", assignment.Status);
    }

    [Fact]
    public async Task NullAssignmentClearsServiceScope()
    {
        var identity = Identity();
        var store = new FixedCredentialStore(Credential(identity));
        using var http = new HttpClient(new StubHandler(_ =>
            Json(HttpStatusCode.OK, """{"ok":true,"assignment":null,"observedAt":"2026-10-05T11:00:00Z"}""")))
        { BaseAddress = new Uri("http://127.0.0.1:3011") };

        Assert.Null(await new HttpEdgeAssignmentClient(http, identity, store).GetAsync());
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
            new DeviceCredentialMetadata(
                identity,
                Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"),
                issuedAt,
                issuedAt.AddYears(1),
                DeviceCredentialState.Active),
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
        public Task<DeviceCredential?> ReadAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken) =>
            Task.FromResult<DeviceCredential?>(credential);
        public Task<DeviceCredentialMetadata?> ReadMetadataAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken) =>
            Task.FromResult<DeviceCredentialMetadata?>(credential.Metadata);
        public Task<bool> SaveAsync(DeviceCredential value, Guid? expectedCredentialId, CancellationToken cancellationToken) =>
            Task.FromResult(false);
        public Task<bool> MarkRevokedAsync(DeviceCredentialMetadata revoked, Guid expectedCredentialId, CancellationToken cancellationToken) =>
            Task.FromResult(false);
    }
}
