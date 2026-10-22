using System.Net;
using System.Text.Json;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class PresentationThemeAssetCache
{
    public const string MetadataKey = "themeAssetsV1";
    private const int MaximumManifestLength = 16_384;
    private const long MaximumAssetBytes = 10 * 1024 * 1024;
    private static readonly IReadOnlyDictionary<string, string> MimeExtensions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["image/png"] = ".png",
        ["image/jpeg"] = ".jpg",
        ["image/webp"] = ".webp",
        ["image/gif"] = ".gif"
    };
    private static readonly IReadOnlyDictionary<string, string> ExtensionMimes = MimeExtensions.ToDictionary(pair => pair.Value, pair => pair.Key, StringComparer.OrdinalIgnoreCase);
    private readonly HttpClient? _httpClient;

    public PresentationThemeAssetCache(HttpClient? httpClient = null, string? directory = null)
    {
        _httpClient = httpClient;
        DirectoryPath = directory ?? DefaultDirectory;
        Directory.CreateDirectory(DirectoryPath);
    }

    public static string DefaultDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "iPresenterPlux", "theme-assets");

    public string DirectoryPath { get; }

    public async Task HydrateAsync(IReadOnlyDictionary<string, string>? metadata, CancellationToken cancellationToken)
    {
        if (_httpClient is null || metadata is null || !metadata.TryGetValue(MetadataKey, out var raw) ||
            string.IsNullOrWhiteSpace(raw) || raw.Length > MaximumManifestLength) return;

        Dictionary<string, string>? manifest;
        try { manifest = JsonSerializer.Deserialize<Dictionary<string, string>>(raw); }
        catch (JsonException) { return; }
        if (manifest is null || manifest.Count == 0 || manifest.Count > 4) return;

        foreach (var pair in manifest)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!Guid.TryParse(pair.Key, out var assetId) || !TryApprovedRemoteUri(pair.Value, out var uri)) continue;
            if (TryResolve(assetId, out _, out _)) continue;
            await TryDownloadAsync(assetId, uri!, cancellationToken).ConfigureAwait(false);
        }
    }

    public bool TryResolve(Guid assetId, out string path, out string contentType)
    {
        foreach (var pair in ExtensionMimes)
        {
            var candidate = Path.Combine(DirectoryPath, $"{assetId:N}{pair.Key}");
            if (!File.Exists(candidate)) continue;
            path = candidate;
            contentType = pair.Value;
            return true;
        }
        path = string.Empty;
        contentType = string.Empty;
        return false;
    }

    public IReadOnlyDictionary<string, string> AvailableLoopbackUrls(PresentationThemeAppearance theme)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (theme.Background.Kind == "image" && Guid.TryParse(theme.Background.Value, out var backgroundId) && TryResolve(backgroundId, out _, out _))
            result[backgroundId.ToString("D")] = $"/api/theme-assets/{backgroundId:D}";
        if (theme.Logo.MediaId is not null && Guid.TryParse(theme.Logo.MediaId, out var logoId) && TryResolve(logoId, out _, out _))
            result[logoId.ToString("D")] = $"/api/theme-assets/{logoId:D}";
        return result;
    }

    private async Task TryDownloadAsync(Guid assetId, Uri uri, CancellationToken cancellationToken)
    {
        string? tempPath = null;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            using var response = await _httpClient!.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) return;
            var mediaType = response.Content.Headers.ContentType?.MediaType;
            if (mediaType is null || !MimeExtensions.TryGetValue(mediaType, out var extension)) return;
            if (response.Content.Headers.ContentLength is > MaximumAssetBytes) return;

            tempPath = Path.Combine(DirectoryPath, $".{assetId:N}.{Guid.NewGuid():N}.tmp");
            await using var input = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            await using var output = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81_920, useAsync: true);
            var buffer = new byte[81_920];
            long total = 0;
            while (true)
            {
                var read = await input.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false);
                if (read == 0) break;
                total += read;
                if (total > MaximumAssetBytes) return;
                await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
            }
            await output.FlushAsync(cancellationToken).ConfigureAwait(false);
            output.Close();
            if (total == 0) return;
            File.Move(tempPath, Path.Combine(DirectoryPath, $"{assetId:N}{extension}"), true);
            tempPath = null;
        }
        catch (Exception error) when (error is HttpRequestException or IOException or UnauthorizedAccessException or NotSupportedException)
        {
            // Theme assets are enhancement-only; presentation content must continue with safe fallback styling.
        }
        finally
        {
            if (tempPath is not null)
            {
                try { File.Delete(tempPath); } catch { }
            }
        }
    }

    private static bool TryApprovedRemoteUri(string value, out Uri? uri)
    {
        uri = null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed) || parsed.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(parsed.UserInfo) || parsed.IsLoopback)
            return false;
        if (IPAddress.TryParse(parsed.Host, out var ip) && IsPrivate(ip)) return false;
        uri = parsed;
        return true;
    }

    private static bool IsPrivate(IPAddress address)
    {
        if (IPAddress.IsLoopback(address)) return true;
        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
            return bytes[0] == 10 || (bytes[0] == 172 && bytes[1] is >= 16 and <= 31) || (bytes[0] == 192 && bytes[1] == 168) || bytes[0] == 169 && bytes[1] == 254;
        return address.IsIPv6LinkLocal || address.IsIPv6SiteLocal;
    }
}
