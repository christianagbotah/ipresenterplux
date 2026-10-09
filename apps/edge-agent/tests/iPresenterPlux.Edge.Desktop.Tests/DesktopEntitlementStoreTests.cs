using System.Text;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Desktop;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class DesktopEntitlementStoreTests
{
    [Fact]
    public async Task SecureVaultRoundTripsEntitlementCache()
    {
        var vault = new FakeProtectedEntitlementVault();
        var store = new DesktopEntitlementStore(vault);
        var cache = new DesktopEntitlementCache(
            ActivationId: "11111111-1111-4111-8111-111111111111",
            InstallationId: "installation-test-001",
            ActivationToken: "private-activation-token-value",
            Envelope: "signed.payload",
            LastTrustedNow: DateTimeOffset.Parse("2026-10-08T09:00:00Z"));

        await store.SaveAsync(cache, CancellationToken.None);
        var restored = await store.ReadAsync(CancellationToken.None);

        Assert.Equal(cache, restored);
        Assert.DoesNotContain(cache.ActivationToken, Encoding.UTF8.GetString(vault.LastWrittenBytes ?? []), StringComparison.Ordinal);
    }

    [Fact]
    public async Task CorruptedProtectedCacheIsRefused()
    {
        var vault = new FakeProtectedEntitlementVault();
        var store = new DesktopEntitlementStore(vault);
        var cache = new DesktopEntitlementCache(
            "11111111-1111-4111-8111-111111111111",
            "installation-test-001",
            "activation-token",
            "signed.payload",
            DateTimeOffset.Parse("2026-10-08T09:00:00Z"));

        await store.SaveAsync(cache, CancellationToken.None);
        vault.Corrupt();

        await Assert.ThrowsAsync<InvalidDataException>(() => store.ReadAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ClearRemovesProtectedEntitlementWithoutTouchingDeviceIdentity()
    {
        var vault = new FakeProtectedEntitlementVault();
        var store = new DesktopEntitlementStore(vault);
        await store.SaveAsync(new DesktopEntitlementCache(
            "11111111-1111-4111-8111-111111111111",
            "installation-test-001",
            "activation-token",
            "signed.payload",
            DateTimeOffset.Parse("2026-10-08T09:00:00Z")), CancellationToken.None);

        await store.ClearAsync(CancellationToken.None);

        Assert.Null(await store.ReadAsync(CancellationToken.None));
        Assert.Equal(1, vault.DeleteCount);
    }

    private sealed class FakeProtectedEntitlementVault : IProtectedEntitlementVault
    {
        private byte[]? _protected;
        private static readonly byte[] Mask = [0x31, 0x59, 0x26, 0x53, 0x58, 0x97];

        public byte[]? LastWrittenBytes { get; private set; }
        public int DeleteCount { get; private set; }

        public Task<byte[]?> ReadAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (_protected is null) return Task.FromResult<byte[]?>(null);
            return Task.FromResult<byte[]?>(Transform(_protected));
        }

        public Task WriteAsync(byte[] value, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            LastWrittenBytes = value.ToArray();
            _protected = Transform(value);
            return Task.CompletedTask;
        }

        public Task DeleteAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            _protected = null;
            DeleteCount++;
            return Task.CompletedTask;
        }

        public void Corrupt()
        {
            if (_protected is { Length: > 4 }) _protected[^3] ^= 0x7f;
        }

        private static byte[] Transform(byte[] value)
        {
            var output = new byte[value.Length];
            for (var i = 0; i < value.Length; i++) output[i] = (byte)(value[i] ^ Mask[i % Mask.Length]);
            return output;
        }
    }
}
