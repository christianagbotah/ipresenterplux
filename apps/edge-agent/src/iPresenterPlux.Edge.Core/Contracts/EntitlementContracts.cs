using System.Text.Json.Serialization;

namespace iPresenterPlux.Edge.Core.Contracts;

public enum EntitlementLeaseState
{
    Invalid = 0,
    ValidOnline = 1,
    OfflineGrace = 2,
    Expired = 3
}

public sealed record EntitlementPayload
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; init; }

    [JsonPropertyName("product")]
    public string Product { get; init; } = string.Empty;

    [JsonPropertyName("audience")]
    public string Audience { get; init; } = string.Empty;

    [JsonPropertyName("entitlementId")]
    public string EntitlementId { get; init; } = string.Empty;

    [JsonPropertyName("organizationId")]
    public string OrganizationId { get; init; } = string.Empty;

    [JsonPropertyName("subscriptionId")]
    public string SubscriptionId { get; init; } = string.Empty;

    [JsonPropertyName("planCode")]
    public string PlanCode { get; init; } = string.Empty;

    [JsonPropertyName("activationId")]
    public string ActivationId { get; init; } = string.Empty;

    [JsonPropertyName("installationId")]
    public string InstallationId { get; init; } = string.Empty;

    [JsonPropertyName("issuedAt")]
    public DateTimeOffset IssuedAt { get; init; }

    [JsonPropertyName("onlineValidUntil")]
    public DateTimeOffset OnlineValidUntil { get; init; }

    [JsonPropertyName("offlineGraceUntil")]
    public DateTimeOffset OfflineGraceUntil { get; init; }

    [JsonPropertyName("features")]
    public Dictionary<string, bool> Features { get; init; } = new(StringComparer.Ordinal);

    [JsonPropertyName("limits")]
    public Dictionary<string, double> Limits { get; init; } = new(StringComparer.Ordinal);

    [JsonPropertyName("signingKeyId")]
    public string SigningKeyId { get; init; } = string.Empty;
}

public sealed record EntitlementValidation(
    EntitlementLeaseState State,
    EntitlementPayload? Payload,
    DateTimeOffset TrustedNow,
    string? ErrorCode = null)
{
    public bool IsUsable => State is EntitlementLeaseState.ValidOnline or EntitlementLeaseState.OfflineGrace;
}

public sealed record DesktopEntitlementCache(
    string ActivationId,
    string InstallationId,
    string ActivationToken,
    string Envelope,
    DateTimeOffset LastTrustedNow);
