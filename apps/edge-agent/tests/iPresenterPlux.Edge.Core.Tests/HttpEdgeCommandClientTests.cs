using System.Net;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Transport;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class HttpEdgeCommandClientTests
{
    [Fact]
    public async Task PollsCommandsAndAcknowledgesWithDeviceCredential()
    {
        var serviceId = Guid.Parse("00000000-0000-4000-8000-000000000003");
        var commandId = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
        var identity = Identity();
        var store = new FixedCredentialStore(Credential(identity));
        var sawAck = false;
        using var http = new HttpClient(new StubHandler(request =>
        {
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal(new string('x', 48), request.Headers.Authorization?.Parameter);
            if (request.Method == HttpMethod.Get)
            {
                Assert.Equal("/api/v1/edge/commands", request.RequestUri?.AbsolutePath);
                return Json(HttpStatusCode.OK,
                    $$"""{"ok":true,"deviceId":"{{identity.DeviceId:D}}","commands":[{"commandId":"{{commandId:D}}","serviceId":"{{serviceId:D}}","type":"program.clear","issuedAt":"2026-10-05T20:00:00Z","arguments":{}}]}""");
            }

            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal($"/api/v1/edge/commands/{commandId:D}/ack", request.RequestUri?.AbsolutePath);
            var body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            Assert.Contains("\"success\":true", body);
            Assert.Contains("\"resultingState\":\"program_clear\"", body);
            sawAck = true;
            return Json(HttpStatusCode.OK, $$"""{"ok":true,"duplicate":false,"commandId":"{{commandId:D}}","state":"succeeded"}""");
        })) { BaseAddress = new Uri("http://127.0.0.1:3011") };

        var client = new HttpEdgeCommandClient(http, identity, store);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await using var commands = client.ReceiveCommandsAsync(cts.Token).GetAsyncEnumerator(cts.Token);
        Assert.True(await commands.MoveNextAsync());
        var command = commands.Current;
        Assert.Equal(commandId.ToString("D"), command.CommandId);
        Assert.Equal(serviceId.ToString("D"), command.ServiceId);
        Assert.Equal("program.clear", command.Type);

        await client.AcknowledgeCommandAsync(
            new ControlCommandResult(command.CommandId, true, "program_clear", null, DateTimeOffset.Parse("2026-10-05T20:00:01Z")),
            cts.Token);
        Assert.True(sawAck);
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
        public Task<DeviceCredential?> ReadAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken) => Task.FromResult<DeviceCredential?>(credential);
        public Task<DeviceCredentialMetadata?> ReadMetadataAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken) => Task.FromResult<DeviceCredentialMetadata?>(credential.Metadata);
        public Task<bool> SaveAsync(DeviceCredential value, Guid? expectedCredentialId, CancellationToken cancellationToken) => Task.FromResult(false);
        public Task<bool> MarkRevokedAsync(DeviceCredentialMetadata revoked, Guid expectedCredentialId, CancellationToken cancellationToken) => Task.FromResult(false);
    }
}
