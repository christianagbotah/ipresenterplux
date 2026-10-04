using System.Security.Cryptography;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Security;

namespace iPresenterPlux.Edge.MacOS;

public sealed class MacOSCredentialStore(
    MacOSNativeMediaBridge? bridge = null) : IDeviceCredentialStore, IDisposable
{
    private const string KeychainService = "com.lightworldtech.ipresenterplux.edge";
    private readonly MacOSNativeMediaBridge _bridge = bridge ?? new MacOSNativeMediaBridge();
    private readonly SemaphoreSlim _gate = new(1, 1);
    private bool _disposed;

    public async Task<DeviceCredential?> ReadAsync(
        Guid organizationId,
        Guid deviceId,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var raw = _bridge.ReadKeychainItem(KeychainService, AccountName(organizationId, deviceId));
            if (raw is null) return null;
            try
            {
                return DeviceCredentialEnvelopeCodec.DecodeCredential(raw);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(raw);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<DeviceCredentialMetadata?> ReadMetadataAsync(
        Guid organizationId,
        Guid deviceId,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var raw = _bridge.ReadKeychainItem(KeychainService, AccountName(organizationId, deviceId));
            if (raw is null) return null;
            try
            {
                return DeviceCredentialEnvelopeCodec.DecodeMetadata(raw);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(raw);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> SaveAsync(
        DeviceCredential credential,
        Guid? expectedCredentialId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(credential);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var account = AccountName(
                credential.Metadata.Identity.OrganizationId,
                credential.Metadata.Identity.DeviceId);
            var existing = ReadMetadataRaw(account);
            if (!MatchesExpectation(existing, expectedCredentialId)) return false;

            var encoded = DeviceCredentialEnvelopeCodec.Encode(credential);
            try
            {
                _bridge.WriteKeychainItem(KeychainService, account, encoded);
                return true;
            }
            finally
            {
                CryptographicOperations.ZeroMemory(encoded);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> MarkRevokedAsync(
        DeviceCredentialMetadata revoked,
        Guid expectedCredentialId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(revoked);
        if (expectedCredentialId == Guid.Empty)
            throw new ArgumentException("Expected credential ID must be nonempty.", nameof(expectedCredentialId));

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var account = AccountName(revoked.Identity.OrganizationId, revoked.Identity.DeviceId);
            var existing = ReadMetadataRaw(account);
            if (existing?.CredentialId != expectedCredentialId) return false;

            var encoded = DeviceCredentialEnvelopeCodec.EncodeRevoked(revoked);
            try
            {
                _bridge.WriteKeychainItem(KeychainService, account, encoded);
                return true;
            }
            finally
            {
                CryptographicOperations.ZeroMemory(encoded);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _gate.Dispose();
    }

    private DeviceCredentialMetadata? ReadMetadataRaw(string account)
    {
        var raw = _bridge.ReadKeychainItem(KeychainService, account);
        if (raw is null) return null;
        try
        {
            return DeviceCredentialEnvelopeCodec.DecodeMetadata(raw);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(raw);
        }
    }

    private static bool MatchesExpectation(
        DeviceCredentialMetadata? existing,
        Guid? expectedCredentialId) =>
        existing is null
            ? expectedCredentialId is null
            : expectedCredentialId == existing.CredentialId;

    private static string AccountName(Guid organizationId, Guid deviceId)
    {
        if (organizationId == Guid.Empty || deviceId == Guid.Empty)
            throw new ArgumentException("Organization and device IDs must be nonempty.");
        return $"{organizationId:N}/{deviceId:N}";
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}
