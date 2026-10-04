using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.Security;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class CredentialSecurityTests
{
    [Fact]
    public void VaultEnvelopeRoundTripsActiveCredentialAndRevocationTombstone()
    {
        var active = Credential(Guid.Parse("11111111-1111-1111-1111-111111111111"));
        var encoded = DeviceCredentialEnvelopeCodec.Encode(active);

        var restored = DeviceCredentialEnvelopeCodec.DecodeCredential(encoded);
        Assert.NotNull(restored);
        Assert.Equal(active.Metadata, restored.Metadata);
        Assert.Equal(active.Material.ToArray(), restored.Material.ToArray());

        var revoked = active.Metadata with
        {
            State = DeviceCredentialState.Revoked,
            RevokedAt = DateTimeOffset.Parse("2026-10-04T13:00:00Z")
        };
        var tombstone = DeviceCredentialEnvelopeCodec.EncodeRevoked(revoked);
        Assert.Equal(revoked, DeviceCredentialEnvelopeCodec.DecodeMetadata(tombstone));
        Assert.Null(DeviceCredentialEnvelopeCodec.DecodeCredential(tombstone));
    }

    [Fact]
    public async Task EnrollmentRotationAndRevocationCommitThroughCompareAndSwapStore()
    {
        var first = Credential(Guid.Parse("22222222-2222-2222-2222-222222222222"));
        var secondMetadata = first.Metadata with
        {
            CredentialId = Guid.Parse("33333333-3333-3333-3333-333333333333"),
            ReplacesCredentialId = first.Metadata.CredentialId,
            IssuedAt = first.Metadata.IssuedAt.AddDays(1),
            ExpiresAt = first.Metadata.ExpiresAt.AddDays(30)
        };
        var second = new DeviceCredential(secondMetadata, Encoding.UTF8.GetBytes("second-secret"));
        var revoked = second.Metadata with
        {
            State = DeviceCredentialState.Revoked,
            RevokedAt = second.Metadata.IssuedAt.AddHours(1)
        };

        var client = new FakeEnrollmentClient(first, second, revoked);
        var store = new FakeCredentialStore();
        var manager = new DeviceEnrollmentManager(client, store);

        var enrolled = await manager.EnrollAsync(
            new PairingCodeExchangeRequest("PAIR-CODE", "Edge", "1.0"),
            CancellationToken.None);
        Assert.Equal(first.Metadata.CredentialId, enrolled.Metadata.CredentialId);
        Assert.Equal(first.Metadata.CredentialId, store.Current?.Metadata.CredentialId);

        var rotated = await manager.RotateAsync(
            first.Metadata.Identity.OrganizationId,
            first.Metadata.Identity.DeviceId,
            CancellationToken.None);
        Assert.Equal(second.Metadata.CredentialId, rotated.Metadata.CredentialId);
        Assert.Equal(second.Metadata.CredentialId, store.Current?.Metadata.CredentialId);

        var revokedResult = await manager.RevokeAsync(
            first.Metadata.Identity.OrganizationId,
            first.Metadata.Identity.DeviceId,
            CancellationToken.None);
        Assert.Equal(DeviceCredentialState.Revoked, revokedResult.State);
        Assert.Null(store.Current);
        Assert.Equal(DeviceCredentialState.Revoked, store.Metadata?.State);
        Assert.Equal(second.Metadata.CredentialId, store.Metadata?.CredentialId);
    }

    private static DeviceCredential Credential(Guid credentialId)
    {
        var identity = new AgentIdentity(
            Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"),
            "Edge",
            "1.0");
        var issued = DateTimeOffset.Parse("2026-10-04T12:00:00Z");
        return new DeviceCredential(
            new DeviceCredentialMetadata(
                identity,
                credentialId,
                issued,
                issued.AddDays(30),
                DeviceCredentialState.Active),
            Encoding.UTF8.GetBytes("first-secret"));
    }

    private sealed class FakeEnrollmentClient(
        DeviceCredential enrollment,
        DeviceCredential rotation,
        DeviceCredentialMetadata revocation) : IDeviceEnrollmentClient
    {
        public Task<DeviceCredential> ExchangePairingCodeAsync(
            PairingCodeExchangeRequest request,
            CancellationToken cancellationToken) => Task.FromResult(enrollment);

        public Task<DeviceCredential> RotateCredentialAsync(
            DeviceCredential current,
            CancellationToken cancellationToken) => Task.FromResult(rotation);

        public Task<DeviceCredentialMetadata> RevokeCredentialAsync(
            DeviceCredential current,
            CancellationToken cancellationToken) => Task.FromResult(revocation);
    }

    private sealed class FakeCredentialStore : IDeviceCredentialStore
    {
        public DeviceCredential? Current { get; private set; }
        public DeviceCredentialMetadata? Metadata { get; private set; }

        public Task<DeviceCredential?> ReadAsync(
            Guid organizationId,
            Guid deviceId,
            CancellationToken cancellationToken) => Task.FromResult(Current);

        public Task<DeviceCredentialMetadata?> ReadMetadataAsync(
            Guid organizationId,
            Guid deviceId,
            CancellationToken cancellationToken) => Task.FromResult(Metadata);

        public Task<bool> SaveAsync(
            DeviceCredential credential,
            Guid? expectedCredentialId,
            CancellationToken cancellationToken)
        {
            var matches = Metadata is null
                ? expectedCredentialId is null
                : Metadata.CredentialId == expectedCredentialId;
            if (!matches) return Task.FromResult(false);

            Current = credential;
            Metadata = credential.Metadata;
            return Task.FromResult(true);
        }

        public Task<bool> MarkRevokedAsync(
            DeviceCredentialMetadata revoked,
            Guid expectedCredentialId,
            CancellationToken cancellationToken)
        {
            if (Metadata?.CredentialId != expectedCredentialId) return Task.FromResult(false);
            Current = null;
            Metadata = revoked;
            return Task.FromResult(true);
        }
    }
}
