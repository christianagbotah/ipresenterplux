using System.Text;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Security;
using NSec.Cryptography;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class EntitlementVerifierTests
{
    private static readonly DateTimeOffset IssuedAt = DateTimeOffset.Parse("2026-10-08T08:00:00Z");
    private static readonly DateTimeOffset OnlineUntil = DateTimeOffset.Parse("2026-10-09T08:00:00Z");
    private static readonly DateTimeOffset GraceUntil = DateTimeOffset.Parse("2026-10-16T08:00:00Z");

    [Fact]
    public void ValidLeaseIsAcceptedOnline()
    {
        var signed = SignedEnvelope();
        var result = EntitlementVerifier.Verify(
            signed.Envelope,
            new Dictionary<string, byte[]> { ["test-2026-10"] = signed.PublicKey },
            IssuedAt.AddHours(2),
            lastTrustedNow: null);

        Assert.Equal(EntitlementLeaseState.ValidOnline, result.State);
        Assert.True(result.IsUsable);
        Assert.Equal("pro", result.Payload?.PlanCode);
        Assert.True(result.Payload?.Features["streaming.web"]);
        Assert.Equal(IssuedAt.AddHours(2), result.TrustedNow);
    }

    [Fact]
    public void TamperedPayloadIsRejected()
    {
        var signed = SignedEnvelope();
        var parts = signed.Envelope.Split('.');
        var raw = DecodeBase64Url(parts[0]);
        var text = Encoding.UTF8.GetString(raw).Replace("\"pro\"", "\"enterprise\"", StringComparison.Ordinal);
        var tampered = $"{Base64Url(Encoding.UTF8.GetBytes(text))}.{parts[1]}";

        var result = EntitlementVerifier.Verify(
            tampered,
            new Dictionary<string, byte[]> { ["test-2026-10"] = signed.PublicKey },
            IssuedAt.AddHours(2),
            lastTrustedNow: null);

        Assert.Equal(EntitlementLeaseState.Invalid, result.State);
        Assert.False(result.IsUsable);
        Assert.Equal("invalid_signature", result.ErrorCode);
    }

    [Fact]
    public void UnknownSigningKeyIsRejected()
    {
        var signed = SignedEnvelope();
        var result = EntitlementVerifier.Verify(
            signed.Envelope,
            new Dictionary<string, byte[]>(),
            IssuedAt.AddHours(2),
            lastTrustedNow: null);

        Assert.Equal(EntitlementLeaseState.Invalid, result.State);
        Assert.Equal("unknown_signing_key", result.ErrorCode);
    }

    [Fact]
    public void LeaseUsesOfflineGraceOnlyAfterOnlineDeadline()
    {
        var signed = SignedEnvelope();
        var result = EntitlementVerifier.Verify(
            signed.Envelope,
            new Dictionary<string, byte[]> { ["test-2026-10"] = signed.PublicKey },
            OnlineUntil.AddHours(4),
            lastTrustedNow: null);

        Assert.Equal(EntitlementLeaseState.OfflineGrace, result.State);
        Assert.True(result.IsUsable);
        Assert.Equal(OnlineUntil.AddHours(4), result.TrustedNow);
    }

    [Fact]
    public void LeaseExpiresAfterOfflineGraceDeadline()
    {
        var signed = SignedEnvelope();
        var result = EntitlementVerifier.Verify(
            signed.Envelope,
            new Dictionary<string, byte[]> { ["test-2026-10"] = signed.PublicKey },
            GraceUntil.AddSeconds(1),
            lastTrustedNow: null);

        Assert.Equal(EntitlementLeaseState.Expired, result.State);
        Assert.False(result.IsUsable);
        Assert.Equal("lease_expired", result.ErrorCode);
    }

    [Fact]
    public void TrustedClockNeverMovesBackward()
    {
        var signed = SignedEnvelope();
        var lastTrusted = GraceUntil.AddMinutes(10);
        var result = EntitlementVerifier.Verify(
            signed.Envelope,
            new Dictionary<string, byte[]> { ["test-2026-10"] = signed.PublicKey },
            IssuedAt.AddHours(1),
            lastTrusted);

        Assert.Equal(lastTrusted, result.TrustedNow);
        Assert.Equal(EntitlementLeaseState.Expired, result.State);
        Assert.False(result.IsUsable);
    }

    private static SignedLease SignedEnvelope()
    {
        var rawJson = $$"""
        {"activationId":"44444444-4444-4444-8444-444444444444","audience":"edge-desktop","entitlementId":"11111111-1111-4111-8111-111111111111","features":{"scripture.local":true,"streaming.web":true},"installationId":"installation-test-001","issuedAt":"{{IssuedAt:O}}","limits":{"devices":2},"offlineGraceUntil":"{{GraceUntil:O}}","onlineValidUntil":"{{OnlineUntil:O}}","organizationId":"22222222-2222-4222-8222-222222222222","planCode":"pro","product":"ipresenterplux","schemaVersion":1,"signingKeyId":"test-2026-10","subscriptionId":"33333333-3333-4333-8333-333333333333"}
        """.Trim();
        var raw = Encoding.UTF8.GetBytes(rawJson);
        var algorithm = SignatureAlgorithm.Ed25519;
        using var key = Key.Create(algorithm, new KeyCreationParameters
        {
            ExportPolicy = KeyExportPolicies.AllowPlaintextExport
        });
        var signature = algorithm.Sign(key, raw);
        var publicKey = key.PublicKey.Export(KeyBlobFormat.RawPublicKey);
        return new SignedLease($"{Base64Url(raw)}.{Base64Url(signature)}", publicKey);
    }

    private static string Base64Url(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] DecodeBase64Url(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += new string('=', (4 - normalized.Length % 4) % 4);
        return Convert.FromBase64String(normalized);
    }

    private sealed record SignedLease(string Envelope, byte[] PublicKey);
}
