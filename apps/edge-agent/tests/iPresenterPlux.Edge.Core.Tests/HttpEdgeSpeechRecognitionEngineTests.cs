using System.Net;
using System.Text;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.Transport;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class HttpEdgeSpeechRecognitionEngineTests
{
    [Fact]
    public async Task TranscribesThroughAuthenticatedControlPlaneGateway()
    {
        var identity = Identity();
        var token = new string('t', 48);
        var serviceId = Guid.Parse("11111111-1111-4111-8111-111111111111");
        using var http = new HttpClient(new StubHandler(async request =>
        {
            Assert.Equal("/api/v1/edge/asr/transcribe", request.RequestUri?.AbsolutePath);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal(token, request.Headers.Authorization?.Parameter);
            Assert.Equal("16000", request.Content?.Headers.GetValues("X-IPresenter-Sample-Rate").Single());
            Assert.Equal("pcm_s16le_mono", request.Content?.Headers.GetValues("X-IPresenter-Audio-Format").Single());
            Assert.Equal(serviceId.ToString("D"), request.Content?.Headers.GetValues("X-IPresenter-Service-Id").Single());
            var bytes = await request.Content!.ReadAsByteArrayAsync();
            Assert.Equal(8, bytes.Length);
            return Json(HttpStatusCode.OK, new { text = "John 3:16", language = "en", confidence = 0.99 });
        })) { BaseAddress = new Uri("https://control.example.test") };
        var engine = new HttpEdgeSpeechRecognitionEngine(http, identity, new FixedCredentialStore(Credential(identity, token)));

        var result = await engine.TranscribeAsync(new SpeechAudioChunk(
            new short[] { 1, 2, 3, 4 }, 16000, DateTimeOffset.Parse("2026-10-23T12:00:00Z"), TimeSpan.FromSeconds(1), serviceId));

        Assert.Equal("John 3:16", result.Text);
        Assert.Equal("en", result.Language);
        Assert.Equal(0.99, result.Confidence);
    }

    [Fact]
    public async Task HealthUsesAuthenticatedGatewayWithoutThrowingOnWorkerFailure()
    {
        var identity = Identity();
        var token = new string('h', 48);
        using var http = new HttpClient(new StubHandler(request => Task.FromResult(
            request.RequestUri?.AbsolutePath == "/api/v1/edge/asr/health"
                ? Json(HttpStatusCode.ServiceUnavailable, new { ok = false, error = "worker unavailable" })
                : Json(HttpStatusCode.NotFound, new { ok = false })))) { BaseAddress = new Uri("https://control.example.test") };
        var engine = new HttpEdgeSpeechRecognitionEngine(http, identity, new FixedCredentialStore(Credential(identity, token)));

        var health = await engine.CheckHealthAsync();

        Assert.Equal("offline", health.Status);
    }

    [Fact]
    public void EdgeRuntimeFallsBackToAuthenticatedControlPlaneAsrWhenNoExplicitEngineWasInjected()
    {
        var source = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Core", "Runtime", "EdgeAgentRuntime.cs"));
        Assert.Contains("_speechRecognitionEngine ??= new HttpEdgeSpeechRecognitionEngine(_httpClient, identity, _credentialStore)", source, StringComparison.Ordinal);
    }

    private static AgentIdentity Identity() => new(
        Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"),
        "Edge", "1.0");

    private static DeviceCredential Credential(AgentIdentity identity, string token)
    {
        var issuedAt = DateTimeOffset.Parse("2026-10-23T00:00:00Z");
        return new DeviceCredential(
            new DeviceCredentialMetadata(identity, Guid.NewGuid(), issuedAt, issuedAt.AddYears(1), DeviceCredentialState.Active),
            Encoding.UTF8.GetBytes(token));
    }

    private static HttpResponseMessage Json(HttpStatusCode status, object body) => new(status)
    {
        Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
    };

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> handler) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => handler(request);
    }

    private sealed class FixedCredentialStore(DeviceCredential credential) : IDeviceCredentialStore
    {
        public Task<DeviceCredential?> ReadAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken) => Task.FromResult<DeviceCredential?>(credential);
        public Task<DeviceCredentialMetadata?> ReadMetadataAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken) => Task.FromResult<DeviceCredentialMetadata?>(credential.Metadata);
        public Task<bool> SaveAsync(DeviceCredential value, Guid? expectedCredentialId, CancellationToken cancellationToken) => Task.FromResult(false);
        public Task<bool> MarkRevokedAsync(DeviceCredentialMetadata revoked, Guid expectedCredentialId, CancellationToken cancellationToken) => Task.FromResult(false);
    }

    private static string FindSourceFile(params string[] pathParts)
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine([current.FullName, .. pathParts]);
            if (File.Exists(candidate)) return candidate;
            current = current.Parent;
        }
        throw new FileNotFoundException("Could not locate EdgeAgentRuntime.cs from the test output directory.");
    }
}
