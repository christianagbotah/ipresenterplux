using System.Text.Json;

namespace iPresenterPlux.Edge.Desktop;

internal static class EntitlementPublicKeyCatalog
{
    private const string EnvironmentVariable = "IPRESENTERPLUX_ENTITLEMENT_PUBLIC_KEYS_JSON";

    public static IReadOnlyDictionary<string, byte[]> Load()
    {
        var json = Environment.GetEnvironmentVariable(EnvironmentVariable);
        if (string.IsNullOrWhiteSpace(json)) return new Dictionary<string, byte[]>(StringComparer.Ordinal);

        Dictionary<string, string>? configured;
        try
        {
            configured = JsonSerializer.Deserialize<Dictionary<string, string>>(json);
        }
        catch (JsonException error)
        {
            throw new InvalidOperationException("The entitlement public-key catalog is invalid.", error);
        }

        var keys = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var (keyId, encoded) in configured ?? [])
        {
            if (string.IsNullOrWhiteSpace(keyId) || keyId.Length > 80 || string.IsNullOrWhiteSpace(encoded))
                throw new InvalidOperationException("The entitlement public-key catalog contains an invalid entry.");
            byte[] raw;
            try
            {
                raw = Convert.FromBase64String(encoded);
            }
            catch (FormatException error)
            {
                throw new InvalidOperationException($"Entitlement public key '{keyId}' is not valid base64.", error);
            }
            if (raw.Length != 32)
                throw new InvalidOperationException($"Entitlement public key '{keyId}' must be a 32-byte Ed25519 public key.");
            keys[keyId] = raw;
        }
        return keys;
    }
}
