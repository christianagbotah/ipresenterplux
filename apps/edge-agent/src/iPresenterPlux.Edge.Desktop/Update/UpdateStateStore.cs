using System.Text.Json;

namespace iPresenterPlux.Edge.Desktop.Update;

public sealed record StagedDesktopUpdate(
    string Version,
    string PackagePath,
    long Size,
    string Sha256,
    string ReleaseNotes,
    DateTimeOffset StagedAt);

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
            return await JsonSerializer.DeserializeAsync<StagedDesktopUpdate>(stream, JsonOptions, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    public async Task SaveAsync(StagedDesktopUpdate update, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(update);
        if (string.IsNullOrWhiteSpace(update.Version) ||
            string.IsNullOrWhiteSpace(update.PackagePath) ||
            update.Size < 0 ||
            update.Sha256.Length != 64 ||
            !update.Sha256.All(Uri.IsHexDigit))
            throw new InvalidDataException("Staged update metadata is invalid.");

        Directory.CreateDirectory(_directory);
        var temporary = StatePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(
                temporary,
                JsonSerializer.Serialize(update with
                {
                    PackagePath = Path.GetFullPath(update.PackagePath),
                    Sha256 = update.Sha256.ToLowerInvariant()
                }, JsonOptions),
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
}
