using System.Text.Json;
using Lightworld.Update.Client;

namespace iPresenterPlux.Edge.Desktop.Update;

public sealed record StagedDesktopUpdate(
    string Version,
    string PackagePath,
    long Size,
    string Sha256,
    string ReleaseNotes,
    DateTimeOffset StagedAt,
    UpdatePackageKind PackageKind = UpdatePackageKind.Full,
    string? FullFallbackUrl = null,
    long? FullFallbackSize = null,
    string? FullFallbackSha256 = null);

public sealed class UpdateStateStore(string directory)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly string _directory = Path.GetFullPath(directory);
    public string StatePath => Path.Combine(_directory, "update-state.json");

    public async Task<StagedDesktopUpdate?> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(StatePath)) return null;
        try
        {
            await using var stream = File.OpenRead(StatePath);
            var update = await JsonSerializer.DeserializeAsync<StagedDesktopUpdate>(stream, JsonOptions, cancellationToken)
                .ConfigureAwait(false);
            return update is null ? null : Validate(update);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidDataException)
        {
            return null;
        }
    }

    public async Task SaveAsync(StagedDesktopUpdate update, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(update);
        var normalized = Validate(update);

        Directory.CreateDirectory(_directory);
        var temporary = StatePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(
                temporary,
                JsonSerializer.Serialize(normalized, JsonOptions),
                cancellationToken).ConfigureAwait(false);
            File.Move(temporary, StatePath, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        }
    }

    public Task ClearAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try { if (File.Exists(StatePath)) File.Delete(StatePath); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        return Task.CompletedTask;
    }

    private static StagedDesktopUpdate Validate(StagedDesktopUpdate update)
    {
        if (string.IsNullOrWhiteSpace(update.Version) ||
            string.IsNullOrWhiteSpace(update.PackagePath) ||
            update.Size < 0 ||
            update.Sha256 is not { Length: 64 } ||
            !update.Sha256.All(Uri.IsHexDigit) ||
            !Enum.IsDefined(update.PackageKind))
            throw new InvalidDataException("Staged update metadata is invalid.");

        string? fallbackUrl = null;
        string? fallbackSha = null;
        long? fallbackSize = null;
        if (update.PackageKind == UpdatePackageKind.Delta)
        {
            if (!Uri.TryCreate(update.FullFallbackUrl, UriKind.Absolute, out var fallback) || fallback.Scheme != Uri.UriSchemeHttps ||
                update.FullFallbackSize is null or <= 0 ||
                update.FullFallbackSha256 is not { Length: 64 } ||
                !update.FullFallbackSha256.All(Uri.IsHexDigit))
                throw new InvalidDataException("Delta fallback metadata is invalid.");
            fallbackUrl = fallback.AbsoluteUri;
            fallbackSize = update.FullFallbackSize;
            fallbackSha = update.FullFallbackSha256.ToLowerInvariant();
        }

        return update with
        {
            Version = update.Version.Trim(),
            PackagePath = Path.GetFullPath(update.PackagePath),
            Sha256 = update.Sha256.ToLowerInvariant(),
            FullFallbackUrl = fallbackUrl,
            FullFallbackSize = fallbackSize,
            FullFallbackSha256 = fallbackSha
        };
    }
}
