using System.Text.Json;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Security;

/// <summary>
/// Encodes credential metadata plus secret material for storage inside an OS-protected credential vault.
/// The returned bytes are sensitive whenever <see cref="DeviceCredential"/> material is present.
/// </summary>
public static class DeviceCredentialEnvelopeCodec
{
    private sealed record Envelope(
        DeviceCredentialMetadata Metadata,
        string? MaterialBase64);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static byte[] Encode(DeviceCredential credential)
    {
        ArgumentNullException.ThrowIfNull(credential);
        if (credential.Material.IsEmpty)
            throw new ArgumentException("Active credential material must not be empty.", nameof(credential));
        if (credential.Metadata.State == DeviceCredentialState.Revoked)
            throw new ArgumentException("Revoked credentials must be stored as metadata-only tombstones.", nameof(credential));

        return JsonSerializer.SerializeToUtf8Bytes(
            new Envelope(credential.Metadata, Convert.ToBase64String(credential.Material.Span)),
            JsonOptions);
    }

    public static byte[] EncodeRevoked(DeviceCredentialMetadata metadata)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        if (metadata.State != DeviceCredentialState.Revoked || metadata.RevokedAt is null)
            throw new ArgumentException("Revocation tombstones require Revoked state and RevokedAt.", nameof(metadata));

        return JsonSerializer.SerializeToUtf8Bytes(new Envelope(metadata, null), JsonOptions);
    }

    public static DeviceCredentialMetadata DecodeMetadata(ReadOnlySpan<byte> envelopeBytes) =>
        DecodeEnvelope(envelopeBytes).Metadata;

    public static DeviceCredential? DecodeCredential(ReadOnlySpan<byte> envelopeBytes)
    {
        var envelope = DecodeEnvelope(envelopeBytes);
        if (envelope.Metadata.State == DeviceCredentialState.Revoked ||
            string.IsNullOrWhiteSpace(envelope.MaterialBase64))
        {
            return null;
        }

        try
        {
            return new DeviceCredential(
                envelope.Metadata,
                Convert.FromBase64String(envelope.MaterialBase64));
        }
        catch (FormatException error)
        {
            throw new InvalidDataException("Credential vault material is corrupted.", error);
        }
    }

    private static Envelope DecodeEnvelope(ReadOnlySpan<byte> envelopeBytes)
    {
        if (envelopeBytes.IsEmpty) throw new InvalidDataException("Credential vault entry is empty.");

        try
        {
            return JsonSerializer.Deserialize<Envelope>(envelopeBytes, JsonOptions)
                ?? throw new InvalidDataException("Credential vault entry is empty.");
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Credential vault entry is corrupted.", error);
        }
    }
}
