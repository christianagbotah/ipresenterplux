using System.Text;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Contracts;
using NSec.Cryptography;

namespace iPresenterPlux.Edge.Core.Security;

public static class EntitlementVerifier
{
    private const string Product = "ipresenterplux";
    private const string Audience = "edge-desktop";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static EntitlementValidation Verify(
        string envelope,
        IReadOnlyDictionary<string, byte[]> publicKeys,
        DateTimeOffset now,
        DateTimeOffset? lastTrustedNow)
    {
        var trustedNow = lastTrustedNow is { } previous && previous > now ? previous : now;
        if (string.IsNullOrWhiteSpace(envelope))
            return Invalid(trustedNow, "invalid_envelope");

        var parts = envelope.Split('.');
        if (parts.Length != 2 || parts.Any(string.IsNullOrWhiteSpace))
            return Invalid(trustedNow, "invalid_envelope");

        byte[] raw;
        byte[] signature;
        EntitlementPayload? payload;
        try
        {
            raw = DecodeBase64Url(parts[0]);
            signature = DecodeBase64Url(parts[1]);
            payload = JsonSerializer.Deserialize<EntitlementPayload>(raw, JsonOptions);
        }
        catch
        {
            return Invalid(trustedNow, "invalid_envelope");
        }

        if (payload is null || !PayloadIsWellFormed(payload))
            return Invalid(trustedNow, "invalid_payload");

        if (!publicKeys.TryGetValue(payload.SigningKeyId, out var keyBytes) || keyBytes is null)
            return new EntitlementValidation(EntitlementLeaseState.Invalid, payload, trustedNow, "unknown_signing_key");

        try
        {
            var algorithm = SignatureAlgorithm.Ed25519;
            using var publicKey = PublicKey.Import(algorithm, keyBytes, KeyBlobFormat.RawPublicKey);
            if (!algorithm.Verify(publicKey, raw, signature))
                return new EntitlementValidation(EntitlementLeaseState.Invalid, payload, trustedNow, "invalid_signature");
        }
        catch
        {
            return new EntitlementValidation(EntitlementLeaseState.Invalid, payload, trustedNow, "invalid_signature");
        }

        if (trustedNow <= payload.OnlineValidUntil)
            return new EntitlementValidation(EntitlementLeaseState.ValidOnline, payload, trustedNow);
        if (trustedNow <= payload.OfflineGraceUntil)
            return new EntitlementValidation(EntitlementLeaseState.OfflineGrace, payload, trustedNow);
        return new EntitlementValidation(EntitlementLeaseState.Expired, payload, trustedNow, "lease_expired");
    }

    private static EntitlementValidation Invalid(DateTimeOffset trustedNow, string code) =>
        new(EntitlementLeaseState.Invalid, null, trustedNow, code);

    private static bool PayloadIsWellFormed(EntitlementPayload payload)
    {
        if (payload.SchemaVersion != 1 ||
            !string.Equals(payload.Product, Product, StringComparison.Ordinal) ||
            !string.Equals(payload.Audience, Audience, StringComparison.Ordinal) ||
            !Guid.TryParse(payload.EntitlementId, out var entitlementId) || entitlementId == Guid.Empty ||
            !Guid.TryParse(payload.OrganizationId, out var organizationId) || organizationId == Guid.Empty ||
            !Guid.TryParse(payload.SubscriptionId, out var subscriptionId) || subscriptionId == Guid.Empty ||
            !Guid.TryParse(payload.ActivationId, out var activationId) || activationId == Guid.Empty ||
            string.IsNullOrWhiteSpace(payload.PlanCode) || payload.PlanCode.Length > 200 ||
            string.IsNullOrWhiteSpace(payload.InstallationId) || payload.InstallationId.Length > 200 ||
            string.IsNullOrWhiteSpace(payload.SigningKeyId) || payload.SigningKeyId.Length > 200 ||
            payload.IssuedAt == default || payload.OnlineValidUntil < payload.IssuedAt ||
            payload.OfflineGraceUntil < payload.OnlineValidUntil ||
            payload.Features is null || payload.Limits is null)
        {
            return false;
        }

        return payload.Limits.Values.All(double.IsFinite);
    }

    private static byte[] DecodeBase64Url(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += new string('=', (4 - normalized.Length % 4) % 4);
        return Convert.FromBase64String(normalized);
    }
}
