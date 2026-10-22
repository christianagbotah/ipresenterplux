using NSec.Cryptography;

namespace Lightworld.Update.Client;

public sealed class UpdateManifestVerifier
{
    private static readonly SignatureAlgorithm Algorithm = SignatureAlgorithm.Ed25519;
    private readonly IReadOnlyDictionary<string, byte[]> _publicKeys;

    public UpdateManifestVerifier(IReadOnlyDictionary<string, byte[]> publicKeys)
    {
        ArgumentNullException.ThrowIfNull(publicKeys);
        _publicKeys = publicKeys.ToDictionary(
            pair => pair.Key,
            pair => pair.Value.ToArray(),
            StringComparer.Ordinal);
    }

    public void Verify(ReadOnlySpan<byte> canonicalManifest, ReadOnlySpan<byte> signature, string keyId)
    {
        if (string.IsNullOrWhiteSpace(keyId) || !_publicKeys.TryGetValue(keyId, out var rawPublicKey))
            throw new InvalidDataException("The update manifest was signed with an unknown Lightworld key.");
        if (rawPublicKey.Length != 32)
            throw new InvalidDataException("The configured Lightworld update public key is invalid.");

        try
        {
            var publicKey = PublicKey.Import(Algorithm, rawPublicKey, KeyBlobFormat.RawPublicKey);
            if (!Algorithm.Verify(publicKey, canonicalManifest, signature))
                throw new InvalidDataException("The update manifest signature is invalid.");
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception error) when (error is FormatException or ArgumentException or NotSupportedException)
        {
            throw new InvalidDataException("The configured Lightworld update public key is invalid.", error);
        }
    }
}
