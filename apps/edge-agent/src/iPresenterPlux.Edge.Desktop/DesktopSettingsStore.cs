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
        if (!File.Exists(SettingsPath))
        {
            var created = DesktopSettings.CreateDefault();
            await TryPersistLoadedSettingsAsync(created, cancellationToken).ConfigureAwait(false);
            return created;
        }

        try
        {
            DesktopSettings loaded;
            await using (var stream = File.OpenRead(SettingsPath))
            {
                loaded = await JsonSerializer.DeserializeAsync<DesktopSettings>(stream, JsonOptions, cancellationToken)
                    .ConfigureAwait(false) ?? DesktopSettings.CreateDefault();
            }

            var migrated = MigrateUpdateSettings(loaded, out var changed);
            if (changed) await TryPersistLoadedSettingsAsync(migrated, cancellationToken).ConfigureAwait(false);
            return migrated;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            return DesktopSettings.CreateDefault();
        }
    }

    public async Task SaveAsync(DesktopSettings settings, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(settings);
        await WriteAtomicAsync(settings.Normalize(), cancellationToken).ConfigureAwait(false);
    }

    private static DesktopSettings MigrateUpdateSettings(DesktopSettings settings, out bool changed)
    {
        changed = false;
        var installationId = settings.InstallationId;
        var updateChannel = settings.UpdateChannel;
        var updateHubUrl = settings.UpdateHubUrl;

        if (string.IsNullOrWhiteSpace(installationId))
        {
            installationId = Guid.NewGuid().ToString("N");
            changed = true;
        }
        if (string.IsNullOrWhiteSpace(updateChannel))
        {
            updateChannel = "stable";
            changed = true;
        }
        if (string.IsNullOrWhiteSpace(updateHubUrl))
        {
            updateHubUrl = "https://updates.lightworldtech.com";
            changed = true;
        }

        return settings with
        {
            InstallationId = installationId,
            UpdateChannel = updateChannel,
            UpdateHubUrl = updateHubUrl
        };
    }

    private async Task TryPersistLoadedSettingsAsync(DesktopSettings settings, CancellationToken cancellationToken)
    {
        try
        {
            await WriteAtomicAsync(settings, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // Settings loading remains non-fatal on read-only/corrupt host profiles.
            // A writable profile will persist the identity on the next load/save.
        }
    }

    private async Task WriteAtomicAsync(DesktopSettings settings, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_directory);
        var temporary = SettingsPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(
                temporary,
                JsonSerializer.Serialize(settings, JsonOptions),
                cancellationToken).ConfigureAwait(false);
            File.Move(temporary, SettingsPath, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        }
    }
}
