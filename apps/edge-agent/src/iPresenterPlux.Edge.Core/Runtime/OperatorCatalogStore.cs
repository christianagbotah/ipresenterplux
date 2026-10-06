using System.Text.Json;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class OperatorCatalogStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly string[] SensitiveMetadataFragments =
    [
        "token", "secret", "password", "credential", "pairing", "streamkey", "oauth", "authorization"
    ];

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private readonly string _tempPath;

    public OperatorCatalogStore(string directoryPath, string fileName = "operator-catalog.json")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directoryPath);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        if (Path.GetFileName(fileName) != fileName)
            throw new ArgumentException("Catalog file name must not contain a directory path.", nameof(fileName));

        Directory.CreateDirectory(directoryPath);
        _path = Path.Combine(directoryPath, fileName);
        _tempPath = _path + ".tmp";
        RecoverInterruptedWrite();
    }

    public async Task<OperatorCatalogSnapshot?> ReadAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await ReadUnsafeAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task WriteAsync(OperatorCatalogSnapshot snapshot, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.SchemaVersion != OperatorCatalogSnapshot.CurrentSchemaVersion)
            throw new ArgumentOutOfRangeException(nameof(snapshot), "Unsupported operator catalog schema version.");

        var safe = Normalize(snapshot);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await using (var stream = new FileStream(
                _tempPath,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None,
                32 * 1024,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, safe, JsonOptions, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                stream.Flush(flushToDisk: true);
            }
            File.Move(_tempPath, _path, overwrite: true);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> ClearServiceAsync(Guid? activeServiceId, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = await ReadUnsafeAsync(cancellationToken).ConfigureAwait(false);
            if (current is null) return false;
            if (current.Service?.ServiceId == activeServiceId) return false;

            if (File.Exists(_path)) File.Delete(_path);
            if (File.Exists(_tempPath)) File.Delete(_tempPath);
            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<OperatorCatalogSnapshot?> ReadUnsafeAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return null;
        try
        {
            await using var stream = new FileStream(
                _path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                32 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            var snapshot = await JsonSerializer.DeserializeAsync<OperatorCatalogSnapshot>(stream, JsonOptions, cancellationToken)
                .ConfigureAwait(false);
            if (snapshot is null || snapshot.SchemaVersion != OperatorCatalogSnapshot.CurrentSchemaVersion) return null;
            return Normalize(snapshot);
        }
        catch (JsonException)
        {
            return null;
        }
        catch (InvalidDataException)
        {
            return null;
        }
    }

    private static OperatorCatalogSnapshot Normalize(OperatorCatalogSnapshot snapshot)
    {
        var service = NormalizeService(snapshot.Service);
        var versions = (snapshot.BibleVersions ?? Array.Empty<OperatorBibleVersion>())
            .Select(NormalizeVersion)
            .Where(item => item is not null)
            .Cast<OperatorBibleVersion>()
            .Take(32)
            .ToArray();
        var items = NormalizeItems(snapshot.Items, 200);
        var scripture = NormalizeItems(snapshot.ScriptureQueue, 200);
        var revision = Clean(snapshot.CatalogRevision, 128);
        if (string.IsNullOrWhiteSpace(revision)) revision = "unknown";

        return snapshot with
        {
            SchemaVersion = OperatorCatalogSnapshot.CurrentSchemaVersion,
            CatalogRevision = revision,
            Service = service,
            BibleVersions = versions,
            Items = items,
            ScriptureQueue = scripture,
        };
    }

    private static OperatorCatalogService? NormalizeService(OperatorCatalogService? service)
    {
        if (service is null || service.ServiceId == Guid.Empty) return null;
        var title = Clean(service.Title, 200);
        var status = Clean(service.Status, 32);
        var version = Clean(service.ActiveBibleVersion, 32);
        if (string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(status)) return null;
        return service with { Title = title, Status = status, ActiveBibleVersion = version };
    }

    private static OperatorBibleVersion? NormalizeVersion(OperatorBibleVersion? version)
    {
        if (version is null) return null;
        var id = Clean(version.Id, 32);
        var name = Clean(version.Name, 120);
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) return null;
        return version with
        {
            Id = id,
            Name = name,
            Abbreviation = Clean(version.Abbreviation, 32),
            LanguageCode = Clean(version.LanguageCode, 16),
        };
    }

    private static IReadOnlyList<OperatorCatalogItem> NormalizeItems(
        IReadOnlyList<OperatorCatalogItem>? source,
        int limit)
    {
        return (source ?? Array.Empty<OperatorCatalogItem>())
            .Select(NormalizeItem)
            .Where(item => item is not null)
            .Cast<OperatorCatalogItem>()
            .Take(limit)
            .ToArray();
    }

    private static OperatorCatalogItem? NormalizeItem(OperatorCatalogItem? item)
    {
        if (item is null) return null;
        var id = Clean(item.ItemId, 128);
        var type = Clean(item.ItemType, 32);
        var body = CleanBody(item.Body, 12000);
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(body)) return null;
        return item with
        {
            ItemId = id,
            ItemType = type,
            Title = Clean(item.Title, 200),
            Body = body,
            Footer = NullIfEmpty(Clean(item.Footer, 500)),
            Metadata = NormalizeMetadata(item.Metadata),
        };
    }

    private static IReadOnlyDictionary<string, string> NormalizeMetadata(IReadOnlyDictionary<string, string>? metadata)
    {
        var safe = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (metadata is null) return safe;
        foreach (var pair in metadata.Take(16))
        {
            var key = Clean(pair.Key, 64);
            if (string.IsNullOrWhiteSpace(key) || IsSensitiveKey(key)) continue;
            var value = Clean(pair.Value, 500);
            if (!string.IsNullOrWhiteSpace(value)) safe[key] = value;
        }
        return safe;
    }

    private static bool IsSensitiveKey(string key) => SensitiveMetadataFragments.Any(
        fragment => key.Replace("_", "", StringComparison.Ordinal).Replace("-", "", StringComparison.Ordinal)
            .Contains(fragment, StringComparison.OrdinalIgnoreCase));

    private static string Clean(string? value, int limit)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var normalized = string.Join(" ", value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Trim();
        return normalized[..Math.Min(normalized.Length, limit)];
    }

    private static string CleanBody(string? value, int limit)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var normalized = string.Join("\n", value.Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Split('\n')
            .Select(line => string.Join(" ", line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Trim()))
            .Trim();
        return normalized[..Math.Min(normalized.Length, limit)];
    }

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private void RecoverInterruptedWrite()
    {
        if (!File.Exists(_path) && File.Exists(_tempPath))
            File.Move(_tempPath, _path);
        else if (File.Exists(_path) && File.Exists(_tempPath))
            File.Delete(_tempPath);
    }
}
