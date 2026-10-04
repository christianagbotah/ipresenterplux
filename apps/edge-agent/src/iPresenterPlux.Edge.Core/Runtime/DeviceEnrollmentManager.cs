using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class DeviceEnrollmentManager(
    IDeviceEnrollmentClient client,
    IDeviceCredentialStore store,
    IAgentIdentityStore? identityStore = null)
{
    private readonly IDeviceEnrollmentClient _client = client ?? throw new ArgumentNullException(nameof(client));
    private readonly IDeviceCredentialStore _store = store ?? throw new ArgumentNullException(nameof(store));
    private readonly IAgentIdentityStore? _identityStore = identityStore;

    public async Task<DeviceCredential> EnrollAsync(
        PairingCodeExchangeRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var credential = await _client.ExchangePairingCodeAsync(request, cancellationToken).ConfigureAwait(false);
        var identity = credential.Metadata.Identity;
        var existing = await _store.ReadMetadataAsync(
            identity.OrganizationId,
            identity.DeviceId,
            cancellationToken).ConfigureAwait(false);

        var saved = await _store.SaveAsync(
            credential,
            existing?.CredentialId,
            cancellationToken).ConfigureAwait(false);

        if (!saved)
            throw new InvalidOperationException("The Edge credential changed locally during enrollment.");

        if (_identityStore is not null)
            await _identityStore.SaveAsync(identity, cancellationToken).ConfigureAwait(false);

        return credential;
    }

    public async Task<DeviceCredential> RotateAsync(
        Guid organizationId,
        Guid deviceId,
        CancellationToken cancellationToken)
    {
        var current = await _store.ReadAsync(organizationId, deviceId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException("The Edge device is not enrolled or its credential is revoked.");

        var next = await _client.RotateCredentialAsync(current, cancellationToken).ConfigureAwait(false);
        if (next.Metadata.Identity.OrganizationId != organizationId ||
            next.Metadata.Identity.DeviceId != deviceId ||
            next.Metadata.ReplacesCredentialId != current.Metadata.CredentialId)
        {
            throw new InvalidDataException("The control plane returned a credential for an unexpected device or rotation chain.");
        }

        var saved = await _store.SaveAsync(
            next,
            current.Metadata.CredentialId,
            cancellationToken).ConfigureAwait(false);

        if (!saved)
        {
            throw new InvalidOperationException(
                "The new Edge credential could not be committed locally. The previous credential remains usable only for its rotation grace period.");
        }

        if (_identityStore is not null)
            await _identityStore.SaveAsync(next.Metadata.Identity, cancellationToken).ConfigureAwait(false);

        return next;
    }

    public async Task<DeviceCredentialMetadata> RevokeAsync(
        Guid organizationId,
        Guid deviceId,
        CancellationToken cancellationToken)
    {
        var current = await _store.ReadAsync(organizationId, deviceId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException("The Edge device has no active credential to revoke.");

        var revoked = await _client.RevokeCredentialAsync(current, cancellationToken).ConfigureAwait(false);
        if (revoked.Identity.OrganizationId != organizationId ||
            revoked.Identity.DeviceId != deviceId ||
            revoked.CredentialId != current.Metadata.CredentialId ||
            revoked.State != DeviceCredentialState.Revoked)
        {
            throw new InvalidDataException("The control plane returned an invalid credential revocation response.");
        }

        var saved = await _store.MarkRevokedAsync(
            revoked,
            current.Metadata.CredentialId,
            cancellationToken).ConfigureAwait(false);

        if (!saved)
            throw new InvalidOperationException("The server revoked the credential, but the local revocation tombstone could not be committed.");

        return revoked;
    }
}
