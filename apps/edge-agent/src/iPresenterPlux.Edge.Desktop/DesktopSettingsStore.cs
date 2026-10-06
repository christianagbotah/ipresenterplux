using System.Text.Json;

namespace iPresenterPlux.Edge.Desktop;

public sealed class DesktopSettingsStore(string settingsDirectory)
{
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };
    private readonly string _directory = Path.GetFullPath(settingsDirectory);
    public string SettingsPath => Path.Combine(_directory, "settings.json");

    public async Task<DesktopSettings> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(SettingsPath)) return DesktopSettings.CreateDefault();
        try
        {
            await using var stream = File.OpenRead(SettingsPath);
            return await JsonSerializer.DeserializeAsync<DesktopSettings>(stream, JsonOptions, cancellationToken)
                .ConfigureAwait(false) ?? DesktopSettings.CreateDefault();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            return DesktopSettings.CreateDefault();
        }
    }

    public async Task SaveAsync(DesktopSettings settings, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var normalized = settings.Normalize();
        Directory.CreateDirectory(_directory);
        var temporary = SettingsPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(
                temporary,
                JsonSerializer.Serialize(normalized, JsonOptions),
                cancellationToken).ConfigureAwait(false);
            File.Move(temporary, SettingsPath, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        }
    }
}
