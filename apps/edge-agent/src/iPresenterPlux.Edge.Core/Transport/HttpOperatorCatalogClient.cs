using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class HttpOperatorCatalogClient(
    HttpClient httpClient,
    AgentIdentity identity,
    IDeviceCredentialStore credentialStore,
    TimeProvider? clock = null) : IOperatorCatalogClient
{
    private static readonly string[] SensitiveMetadataFragments =
    [
        "token", "secret", "password", "credential", "pairing", "streamkey", "oauth", "authorization"
    ];

    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
    private readonly AgentIdentity _identity = identity ?? throw new ArgumentNullException(nameof(identity));
    private readonly IDeviceCredentialStore _credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    public async Task<OperatorCatalogSnapshot> GetCatalogAsync(CancellationToken cancellationToken)
    {
        using var request = await CreateAuthenticatedRequestAsync(
            HttpMethod.Get,
            "/api/v1/edge/operator/catalog",
            cancellationToken).ConfigureAwait(false);
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<CatalogResponse>(cancellationToken: cancellationToken)
            .ConfigureAwait(false) ?? throw new InvalidDataException("The operator catalog response was empty.");
        if (!payload.Ok) throw new InvalidDataException("The operator catalog response was invalid.");
        if (payload.BibleVersions is null || payload.Items is null || payload.ScriptureQueue is null)
            throw new InvalidDataException("The operator catalog collections were missing.");
        if (payload.BibleVersions.Count > 32 || payload.Items.Count > 200 || payload.ScriptureQueue.Count > 200)
            throw new InvalidDataException("The operator catalog exceeded client safety limits.");
        if (string.IsNullOrWhiteSpace(payload.CatalogRevision) || payload.CatalogRevision.Length > 128)
            throw new InvalidDataException("The operator catalog revision was invalid.");
        if (payload.ObservedAt == default)
            throw new InvalidDataException("The operator catalog observation time was invalid.");

        var service = MapService(payload.Service);
        if (service is null && (payload.Items.Count > 0 || payload.ScriptureQueue.Count > 0))
            throw new InvalidDataException("Service-scoped catalog content was returned without an active service.");

        return new OperatorCatalogSnapshot(
            OperatorCatalogSnapshot.CurrentSchemaVersion,
            _clock.GetUtcNow(),
            payload.ObservedAt,
            payload.CatalogRevision,
            service,
            payload.BibleVersions.Select(MapVersion).ToArray(),
            payload.Items.Select(MapItem).ToArray(),
            payload.ScriptureQueue.Select(MapItem).ToArray());
    }

    public async Task<OperatorResolvedScripture> ResolveScriptureAsync(
        string reference,
        string? version,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reference);
        reference = reference.Trim();
        if (reference.Length > 120) throw new ArgumentOutOfRangeException(nameof(reference));
        if (version is not null)
        {
            version = version.Trim();
            if (version.Length is 0 or > 32) throw new ArgumentOutOfRangeException(nameof(version));
        }

        var path = $"/api/v1/edge/operator/scripture?reference={Uri.EscapeDataString(reference)}";
        if (version is not null) path += $"&version={Uri.EscapeDataString(version)}";
        using var request = await CreateAuthenticatedRequestAsync(HttpMethod.Get, path, cancellationToken).ConfigureAwait(false);
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<ScriptureResponse>(cancellationToken: cancellationToken)
            .ConfigureAwait(false) ?? throw new InvalidDataException("The scripture resolver response was empty.");
        if (!payload.Ok || payload.Item is null || payload.ObservedAt == default)
            throw new InvalidDataException("The scripture resolver response was invalid.");
        if (!Guid.TryParse(payload.Item.ServiceId, out var serviceId) || serviceId == Guid.Empty)
            throw new InvalidDataException("The scripture resolver service id was invalid.");

        return new OperatorResolvedScripture(serviceId, MapItem(payload.Item), payload.ObservedAt);
    }

    private async Task<HttpRequestMessage> CreateAuthenticatedRequestAsync(
        HttpMethod method,
        string path,
        CancellationToken cancellationToken)
    {
        var credential = await ReadUsableCredentialAsync(cancellationToken).ConfigureAwait(false);
        var token = Encoding.UTF8.GetString(credential.Material.Span);
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return request;
    }

    private async Task<DeviceCredential> ReadUsableCredentialAsync(CancellationToken cancellationToken)
    {
        var credential = await _credentialStore.ReadAsync(
            _identity.OrganizationId,
            _identity.DeviceId,
            cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException("The Edge device is not enrolled.");
        if (credential.Metadata.State == DeviceCredentialState.Revoked ||
            credential.Metadata.ExpiresAt <= _clock.GetUtcNow() ||
            credential.Material.IsEmpty)
        {
            throw new InvalidOperationException("The Edge device credential is not usable.");
        }
        return credential;
    }

    private static OperatorCatalogService? MapService(ServicePayload? service)
    {
        if (service is null) return null;
        if (!Guid.TryParse(service.ServiceId, out var serviceId) || serviceId == Guid.Empty)
            throw new InvalidDataException("The operator catalog service id was invalid.");
        if (service.Status is not ("ready" or "live"))
            throw new InvalidDataException("The operator catalog service state was invalid.");
        return new OperatorCatalogService(
            serviceId,
            RequiredText(service.Title, 200, "service title"),
            service.Status,
            OptionalText(service.ActiveBibleVersion, 32),
            service.ScheduledStart,
            service.StartedAt);
    }

    private static OperatorBibleVersion MapVersion(BibleVersionPayload version) => new(
        RequiredText(version.Id, 32, "Bible version id"),
        RequiredText(version.Name, 120, "Bible version name"),
        OptionalText(version.Abbreviation, 32),
        OptionalText(version.LanguageCode, 16));

    private static OperatorCatalogItem MapItem(ItemPayload item)
    {
        var metadata = ValidateMetadata(item.Metadata);
        return new OperatorCatalogItem(
            RequiredText(item.ItemId, 128, "catalog item id"),
            RequiredText(item.ItemType, 32, "catalog item type"),
            OptionalText(item.Title, 200),
            RequiredText(item.Body, 12000, "catalog item body", preserveNewLines: true),
            string.IsNullOrWhiteSpace(item.Footer) ? null : OptionalText(item.Footer, 500),
            metadata);
    }

    private static IReadOnlyDictionary<string, string> ValidateMetadata(IReadOnlyDictionary<string, string>? metadata)
    {
        if (metadata is null) return new Dictionary<string, string>();
        if (metadata.Count > 16) throw new InvalidDataException("Catalog item metadata exceeded client safety limits.");
        var safe = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in metadata)
        {
            var key = RequiredText(pair.Key, 64, "metadata key");
            var compactKey = key.Replace("_", "", StringComparison.Ordinal).Replace("-", "", StringComparison.Ordinal);
            if (SensitiveMetadataFragments.Any(fragment => compactKey.Contains(fragment, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("Sensitive metadata is not permitted in the operator catalog.");
            safe[key] = OptionalText(pair.Value, 500);
        }
        return safe;
    }

    private static string RequiredText(string? value, int maxLength, string field, bool preserveNewLines = false)
    {
        var result = NormalizeText(value, maxLength, preserveNewLines);
        if (string.IsNullOrWhiteSpace(result)) throw new InvalidDataException($"The {field} was invalid.");
        return result;
    }

    private static string OptionalText(string? value, int maxLength) => NormalizeText(value, maxLength, preserveNewLines: false);

    private static string NormalizeText(string? value, int maxLength, bool preserveNewLines)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        string normalized;
        if (preserveNewLines)
        {
            normalized = string.Join("\n", value.Replace("\r\n", "\n", StringComparison.Ordinal)
                .Replace('\r', '\n')
                .Split('\n')
                .Select(line => string.Join(" ", line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Trim()))
                .Trim();
        }
        else
        {
            normalized = string.Join(" ", value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Trim();
        }
        if (normalized.Length > maxLength)
            throw new InvalidDataException("Operator catalog text exceeded client safety limits.");
        return normalized;
    }

    private sealed record CatalogResponse(
        bool Ok,
        ServicePayload? Service,
        IReadOnlyList<BibleVersionPayload>? BibleVersions,
        IReadOnlyList<ItemPayload>? Items,
        IReadOnlyList<ItemPayload>? ScriptureQueue,
        string? CatalogRevision,
        DateTimeOffset ObservedAt);

    private sealed record ScriptureResponse(bool Ok, ResolvedItemPayload? Item, DateTimeOffset ObservedAt);

    private sealed record ServicePayload(
        string? ServiceId,
        string? Title,
        string? Status,
        string? ActiveBibleVersion,
        DateTimeOffset? ScheduledStart,
        DateTimeOffset? StartedAt);

    private sealed record BibleVersionPayload(string? Id, string? Name, string? Abbreviation, string? LanguageCode);

    private record ItemPayload(
        string? ItemId,
        string? ItemType,
        string? Title,
        string? Body,
        string? Footer,
        IReadOnlyDictionary<string, string>? Metadata);

    private sealed record ResolvedItemPayload(
        string? ItemId,
        string? ServiceId,
        string? ItemType,
        string? Title,
        string? Body,
        string? Footer,
        IReadOnlyDictionary<string, string>? Metadata)
        : ItemPayload(ItemId, ItemType, Title, Body, Footer, Metadata);
}
