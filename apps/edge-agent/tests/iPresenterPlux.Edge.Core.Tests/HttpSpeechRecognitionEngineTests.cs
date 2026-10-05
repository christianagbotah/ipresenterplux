using System.Net;
using System.Text;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Transport;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class HttpSpeechRecognitionEngineTests
{
    [Fact]
    public async Task HealthProbeMapsHealthyWorkerWithoutExposingModelPath()
    {
        using var http = new HttpClient(new StubHandler(_ => Json(HttpStatusCode.OK,
            """{"ok":true,"version":"0.1.0","engine":"faster-whisper","model":"/private/models/small","modelLoaded":false,"device":"cpu","diarization":"disabled","diarizationReady":false}""")))
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
        Assert.Equal("disabled", health.Diarization);
        Assert.False(health.DiarizationReady);
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

    [Fact]
    public async Task TranscriptionCarriesServiceScopeHeader()
    {
        var serviceId = Guid.Parse("00000000-0000-4000-8000-000000000003");
        using var http = new HttpClient(new StubHandler(request =>
        {
            Assert.True(request.Headers.TryGetValues("X-IPresenter-Service-Id", out var values));
            Assert.Equal(serviceId.ToString("D"), Assert.Single(values));
            return Json(HttpStatusCode.OK,
                """{"text":"Welcome church","language":"en","speakerId":"speaker-001","confidence":0.9}""");
        }))
        {
            BaseAddress = new Uri("http://127.0.0.1:8765")
        };
        var engine = new HttpSpeechRecognitionEngine(http);
        var chunk = new SpeechAudioChunk(
            new short[] { 1, 2, 3, 4 },
            16_000,
            DateTimeOffset.Parse("2026-10-05T10:00:00Z"),
            TimeSpan.FromMilliseconds(1),
            serviceId);

        var result = await engine.TranscribeAsync(chunk);

        Assert.Equal("Welcome church", result.Text);
        Assert.Equal("speaker-001", result.SpeakerId);
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
