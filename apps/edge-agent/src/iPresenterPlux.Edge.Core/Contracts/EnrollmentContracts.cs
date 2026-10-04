namespace iPresenterPlux.Edge.Core.Contracts;

public enum DeviceCredentialState
{
    Active,
    RotationRequired,
    Revoked
}

// Metadata only: safe to persist separately from protected credential material.
public sealed record DeviceCredentialMetadata(
    AgentIdentity Identity,
    Guid CredentialId,
    DateTimeOffset IssuedAt,
    DateTimeOffset ExpiresAt,
    DeviceCredentialState State,
    Guid? ReplacesCredentialId = null,
    DateTimeOffset? RevokedAt = null);

// Deliberately not a record: diagnostic formatting must never expose sensitive values.
public sealed class PairingCodeExchangeRequest(string pairingCode, string deviceName, string softwareVersion)
{
    public string PairingCode { get; } = pairingCode;
    public string DeviceName { get; } = deviceName;
    public string SoftwareVersion { get; } = softwareVersion;
    public override string ToString() => nameof(PairingCodeExchangeRequest);
}

public sealed class DeviceCredential(DeviceCredentialMetadata metadata, ReadOnlyMemory<byte> material)
{
    public DeviceCredentialMetadata Metadata { get; } = metadata;
    public ReadOnlyMemory<byte> Material { get; } = material;
    public override string ToString() => nameof(DeviceCredential);
}
