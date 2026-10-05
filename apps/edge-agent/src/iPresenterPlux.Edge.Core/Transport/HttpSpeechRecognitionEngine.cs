using System.Net.Http.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class HttpSpeechRecognitionEngine(HttpClient httpClient) : ISpeechRecognitionEngine, ISpeechRecognitionHealthProbe
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

    public async Task<SpeechRecognitionResult> TranscribeAsync(
        SpeechAudioChunk chunk,
        CancellationToken cancellationToken = default)
    {
        if (chunk.SampleRate <= 0 || chunk.Samples.IsEmpty)
            return new SpeechRecognitionResult(string.Empty);

        var samples = chunk.Samples.ToArray();
        var bytes = new byte[samples.Length * sizeof(short)];
        Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
        using var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new("application/octet-stream");
        content.Headers.Add("X-IPresenter-Sample-Rate", chunk.SampleRate.ToString(System.Globalization.CultureInfo.InvariantCulture));
        content.Headers.Add("X-IPresenter-Audio-Format", "pcm_s16le_mono");
        content.Headers.Add("X-IPresenter-Started-At", chunk.StartedAt.ToUniversalTime().ToString("O"));

        using var response = await _httpClient.PostAsync("/v1/transcribe", content, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var result = await response.Content.ReadFromJsonAsync<SpeechRecognitionResult>(cancellationToken: cancellationToken).ConfigureAwait(false);
        return result ?? throw new InvalidDataException("ASR worker returned an empty response.");
    }

    public async Task<SpeechRecognitionHealth> CheckHealthAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.GetAsync("/health", cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            return new SpeechRecognitionHealth("error");

        var health = await response.Content.ReadFromJsonAsync<WorkerHealthResponse>(cancellationToken: cancellationToken)
            .ConfigureAwait(false);
        if (health is null || !health.Ok)
            return new SpeechRecognitionHealth("error");

        return new SpeechRecognitionHealth(
            "ready",
            SafeToken(health.Version, 32),
            health.ModelLoaded,
            SafeToken(health.Engine, 32),
            SafeToken(health.Device, 32),
            SafeToken(health.Diarization, 32),
            health.DiarizationReady);
    }

    private static string? SafeToken(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        if (trimmed.Length > maxLength) trimmed = trimmed[..maxLength];
        return trimmed.All(character => char.IsLetterOrDigit(character) || character is '.' or '-' or '_' or ' ')
            ? trimmed
            : null;
    }
}
