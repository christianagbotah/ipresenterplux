using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IDeviceEnrollmentClient
{
    // The server consumes a short-lived pairing code once and assigns tenant/device identity.
    Task<DeviceCredential> ExchangePairingCodeAsync(PairingCodeExchangeRequest request, CancellationToken cancellationToken);
    Task<DeviceCredential> RotateCredentialAsync(DeviceCredential current, CancellationToken cancellationToken);
    Task<DeviceCredentialMetadata> RevokeCredentialAsync(DeviceCredential current, CancellationToken cancellationToken);
}

public interface IDeviceCredentialStore
{
    // Implementations must protect material at rest using the platform credential vault.
    Task<DeviceCredential?> ReadAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken);
    // Atomic compare-and-swap; null expects no existing credential. Reject stale rotations.
    Task<bool> SaveAsync(DeviceCredential credential, Guid? expectedCredentialId, CancellationToken cancellationToken);
    // Atomically persist a revocation tombstone and erase material, retaining device identity.
    Task<bool> MarkRevokedAsync(DeviceCredentialMetadata revoked, Guid expectedCredentialId, CancellationToken cancellationToken);
    Task<DeviceCredentialMetadata?> ReadMetadataAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken);
}
