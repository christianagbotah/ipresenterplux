using System.Net.Http.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class HttpSpeechRecognitionEngine(HttpClient httpClient) : ISpeechRecognitionEngine
{
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
}
