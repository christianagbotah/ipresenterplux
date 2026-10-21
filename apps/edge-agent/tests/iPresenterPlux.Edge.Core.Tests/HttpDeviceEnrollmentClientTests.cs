using System.Net;
using System.Text;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Transport;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class HttpDeviceEnrollmentClientTests
{
    [Fact]
    public async Task ExchangePairingCodeAcceptsControlPlanePostgresTimestampStrings()
    {
        const string payload = """
            {
              "ok": true,
              "credential": "iplx_fixture_credential",
              "metadata": {
                "deviceId": "6736169e-fe70-4468-b04c-e89f1d623db8",
                "organizationId": "8b94d80b-0552-4430-9ffd-26fc19a090cb",
                "campusId": null,
                "deviceName": "Sanctuary Edge",
                "platform": "windows",
                "credentialId": "f340cafb-ea0d-4f82-b4ef-4a89400f3b19",
                "issuedAt": "2026-10-21 09:13:49.123456+00",
                "expiresAt": "2026-11-20 09:13:49.123456+00",
                "state": "active"
              }
            }
            """;
        using var http = new HttpClient(new StaticResponseHandler(payload))
        {
            BaseAddress = new Uri("https://control.example.test")
        };
        var client = new HttpDeviceEnrollmentClient(http);

        var credential = await client.ExchangePairingCodeAsync(
            new PairingCodeExchangeRequest("ABCD-EFGH-IJKL", "Sanctuary Edge", "1.0.0"),
            CancellationToken.None);

        Assert.Equal(new DateTimeOffset(2026, 10, 21, 9, 13, 49, TimeSpan.Zero).AddTicks(1_234_560), credential.Metadata.IssuedAt);
        Assert.Equal(new DateTimeOffset(2026, 11, 20, 9, 13, 49, TimeSpan.Zero).AddTicks(1_234_560), credential.Metadata.ExpiresAt);
        Assert.Equal(DeviceCredentialState.Active, credential.Metadata.State);
        Assert.Equal("iplx_fixture_credential", Encoding.UTF8.GetString(credential.Material.Span));
    }

    private sealed class StaticResponseHandler(string payload) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("/api/v1/edge/enroll", request.RequestUri?.AbsolutePath);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            });
        }
    }
}
