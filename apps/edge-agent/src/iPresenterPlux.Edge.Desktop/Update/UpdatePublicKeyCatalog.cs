using System.Text.Json;

namespace iPresenterPlux.Edge.Desktop.Update;

internal static class UpdatePublicKeyCatalog
{
    private const string EnvironmentVariable = "IPRESENTERPLUX_UPDATE_PUBLIC_KEYS_JSON";
    private const string BundledCatalogFile = "update-public-keys.json";

    public static IReadOnlyDictionary<string, byte[]> Load()
    {
        var keys = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var bundledPath = Path.Combine(AppContext.BaseDirectory, BundledCatalogFile);
        if (File.Exists(bundledPath)) Merge(keys, File.ReadAllText(bundledPath), "bundled");
        var configured = Environment.GetEnvironmentVariable(EnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(configured)) Merge(keys, configured, "environment");
        return keys;
    }

    private static void Merge(Dictionary<string, byte[]> keys, string json, string source)
    {
        Dictionary<string, string>? configured;
        try { configured = JsonSerializer.Deserialize<Dictionary<string, string>>(json); }
        catch (JsonException error)
        {
            throw new InvalidOperationException($"The {source} update public-key catalog is invalid.", error);
        }

        foreach (var (keyId, encoded) in configured ?? [])
        {
            if (string.IsNullOrWhiteSpace(keyId) || keyId.Length > 80 || string.IsNullOrWhiteSpace(encoded))
                throw new InvalidOperationException("The update public-key catalog contains an invalid entry.");
            byte[] raw;
            try { raw = Convert.FromBase64String(encoded); }
            catch (FormatException error)
            {
                throw new InvalidOperationException($"Update public key '{keyId}' is not valid base64.", error);
            }
            if (raw.Length != 32)
                throw new InvalidOperationException($"Update public key '{keyId}' must be a 32-byte Ed25519 public key.");
            keys[keyId] = raw;
        }
    }
}
