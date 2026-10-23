using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class HttpEdgeSpeechRecognitionEngine(
    HttpClient httpClient,
    AgentIdentity identity,
    IDeviceCredentialStore credentialStore,
    TimeProvider? clock = null) : ISpeechRecognitionEngine, ISpeechRecognitionHealthProbe
{
    private sealed record WorkerHealthResponse(
        bool Ok,
        string? Version,
        string? Engine,
        string? Model,
        bool ModelLoaded,
        string? Device,
        string? Diarization,
        bool DiarizationReady);

    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
    private readonly AgentIdentity _identity = identity ?? throw new ArgumentNullException(nameof(identity));
    private readonly IDeviceCredentialStore _credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    public async Task<SpeechRecognitionResult> TranscribeAsync(
        SpeechAudioChunk chunk,
        CancellationToken cancellationToken = default)
    {
        if (chunk.SampleRate <= 0 || chunk.Samples.IsEmpty)
            return new SpeechRecognitionResult(string.Empty);

        var samples = chunk.Samples.ToArray();
        var bytes = new byte[samples.Length * sizeof(short)];
        Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
        using var request = await CreateRequestAsync(HttpMethod.Post, "/api/v1/edge/asr/transcribe", cancellationToken).ConfigureAwait(false);
        request.Content = new ByteArrayContent(bytes);
        request.Content.Headers.ContentType = new("application/octet-stream");
        request.Content.Headers.Add("X-IPresenter-Sample-Rate", chunk.SampleRate.ToString(System.Globalization.CultureInfo.InvariantCulture));
        request.Content.Headers.Add("X-IPresenter-Audio-Format", "pcm_s16le_mono");
        request.Content.Headers.Add("X-IPresenter-Started-At", chunk.StartedAt.ToUniversalTime().ToString("O"));
        if (chunk.ServiceId is { } serviceId)
            request.Content.Headers.Add("X-IPresenter-Service-Id", serviceId.ToString("D"));

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<SpeechRecognitionResult>(cancellationToken: cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidDataException("Control Plane ASR gateway returned an empty response.");
    }

    public async Task<SpeechRecognitionHealth> CheckHealthAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var request = await CreateRequestAsync(HttpMethod.Get, "/api/v1/edge/asr/health", cancellationToken).ConfigureAwait(false);
            using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) return new SpeechRecognitionHealth("offline");
            var health = await response.Content.ReadFromJsonAsync<WorkerHealthResponse>(cancellationToken: cancellationToken).ConfigureAwait(false);
            if (health is null || !health.Ok) return new SpeechRecognitionHealth("error");
            return new SpeechRecognitionHealth(
                "ready",
                SafeToken(health.Version, 32),
                health.ModelLoaded,
                SafeToken(health.Engine, 32),
                SafeToken(health.Device, 32),
                SafeToken(health.Diarization, 32),
                health.DiarizationReady);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (HttpRequestException) { return new SpeechRecognitionHealth("offline"); }
        catch (TaskCanceledException) { return new SpeechRecognitionHealth("offline"); }
    }

    private async Task<HttpRequestMessage> CreateRequestAsync(HttpMethod method, string path, CancellationToken cancellationToken)
    {
        var credential = await _credentialStore.ReadAsync(_identity.OrganizationId, _identity.DeviceId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException("The Edge device is not enrolled.");
        if (credential.Metadata.State == DeviceCredentialState.Revoked ||
            credential.Metadata.ExpiresAt <= _clock.GetUtcNow() || credential.Material.IsEmpty)
            throw new InvalidOperationException("The Edge device credential is not usable.");
        var token = Encoding.UTF8.GetString(credential.Material.Span);
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return request;
    }

    private static string? SafeToken(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        if (trimmed.Length > maxLength) trimmed = trimmed[..maxLength];
        return trimmed.All(character => char.IsLetterOrDigit(character) || character is '.' or '-' or '_' or ' ')
            ? trimmed : null;
    }
}
