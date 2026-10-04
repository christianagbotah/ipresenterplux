using System.Net;
using System.Text;
using iPresenterPlux.Edge.Core.Transport;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class HttpSpeechRecognitionEngineTests
{
    [Fact]
    public async Task HealthProbeMapsHealthyWorkerWithoutExposingModelPath()
    {
        using var http = new HttpClient(new StubHandler(_ => Json(HttpStatusCode.OK,
            """{"ok":true,"version":"0.1.0","engine":"faster-whisper","model":"/private/models/small","modelLoaded":false,"device":"cpu"}""")))
        {
            BaseAddress = new Uri("http://127.0.0.1:8765")
        };
        var engine = new HttpSpeechRecognitionEngine(http);

        var health = await engine.CheckHealthAsync();

        Assert.Equal("ready", health.Status);
        Assert.Equal("0.1.0", health.Version);
        Assert.Equal("faster-whisper", health.Engine);
        Assert.Equal("cpu", health.Device);
        Assert.False(health.ModelLoaded);
    }

    [Fact]
    public async Task HealthProbeReturnsErrorForNonSuccessResponse()
    {
        using var http = new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)))
        {
            BaseAddress = new Uri("http://127.0.0.1:8765")
        };
        var engine = new HttpSpeechRecognitionEngine(http);

        var health = await engine.CheckHealthAsync();

        Assert.Equal("error", health.Status);
        Assert.Null(health.Version);
    }

    [Fact]
    public async Task HealthProbeDropsUnsafeDiagnosticTokens()
    {
        using var http = new HttpClient(new StubHandler(_ => Json(HttpStatusCode.OK,
            """{"ok":true,"version":"secret/path","engine":"faster-whisper","model":"small","modelLoaded":true,"device":"cuda:0"}""")))
        {
            BaseAddress = new Uri("http://127.0.0.1:8765")
        };
        var engine = new HttpSpeechRecognitionEngine(http);

        var health = await engine.CheckHealthAsync();

        Assert.Equal("ready", health.Status);
        Assert.Null(health.Version);
        Assert.Equal("faster-whisper", health.Engine);
        Assert.Null(health.Device);
        Assert.True(health.ModelLoaded);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) => new(status)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json")
    };

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(send(request));
        }
    }
}
