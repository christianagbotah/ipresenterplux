using System.Net;
using System.Net.Http.Headers;

namespace Lightworld.Update.Client;

public sealed class ResumableDownloader(HttpClient httpClient)
{
    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));

    public async Task DownloadAsync(
        Uri source,
        string destination,
        long expectedSize,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentException.ThrowIfNullOrWhiteSpace(destination);
        if (!source.IsAbsoluteUri) throw new ArgumentException("Update source must be an absolute URI.", nameof(source));
        if (source.Scheme != Uri.UriSchemeHttps && !source.IsLoopback)
            throw new InvalidOperationException("Remote update downloads must use HTTPS.");
        if (expectedSize < 0) throw new ArgumentOutOfRangeException(nameof(expectedSize));

        var fullDestination = Path.GetFullPath(destination);
        Directory.CreateDirectory(Path.GetDirectoryName(fullDestination)!);
        var existing = File.Exists(fullDestination) ? new FileInfo(fullDestination).Length : 0L;
        if (existing > expectedSize)
        {
            File.Delete(fullDestination);
            existing = 0;
        }
        if (existing == expectedSize) return;

        using var request = new HttpRequestMessage(HttpMethod.Get, source);
        if (existing > 0) request.Headers.Range = new RangeHeaderValue(existing, null);
        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            .ConfigureAwait(false);

        if (response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable && existing > 0)
        {
            File.Delete(fullDestination);
            await DownloadAsync(source, fullDestination, expectedSize, cancellationToken).ConfigureAwait(false);
            return;
        }

        response.EnsureSuccessStatusCode();
        var append = existing > 0 && response.StatusCode == HttpStatusCode.PartialContent;
        if (append && response.Content.Headers.ContentRange?.From is { } rangeFrom && rangeFrom != existing)
        {
            File.Delete(fullDestination);
            await DownloadAsync(source, fullDestination, expectedSize, cancellationToken).ConfigureAwait(false);
            return;
        }

        var mode = append ? FileMode.Append : FileMode.Create;
        await using var destinationStream = new FileStream(fullDestination, mode, FileAccess.Write, FileShare.Read,
            128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await using var sourceStream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        await sourceStream.CopyToAsync(destinationStream, 128 * 1024, cancellationToken).ConfigureAwait(false);
        await destinationStream.FlushAsync(cancellationToken).ConfigureAwait(false);

        var completedSize = new FileInfo(fullDestination).Length;
        if (completedSize != expectedSize)
            throw new InvalidDataException($"Update download is incomplete. Expected {expectedSize} bytes, found {completedSize}.");
    }
}
