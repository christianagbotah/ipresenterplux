using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Journals;

/// <summary>Atomic snapshots for one Edge process. Invalid evidence is never reset automatically.</summary>
public sealed class FileCompletedCommandJournal : ICompletedCommandJournal
{
    private sealed record Entry(Guid OrganizationId, Guid DeviceId, ControlCommandResult Result);
    private sealed record Document(int SchemaVersion, List<Entry> Results);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly object _gate = new();
    private readonly string _path;
    private readonly int _capacity;

    public FileCompletedCommandJournal(string directoryPath, int capacity = 1000)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directoryPath);
        if (capacity is < 1 or > 1000) throw new ArgumentOutOfRangeException(nameof(capacity));
        Directory.CreateDirectory(directoryPath);
        _path = Path.Combine(directoryPath, "completed-commands.json");
        _capacity = capacity;
    }

    public ControlCommandResult? Find(Guid organizationId, Guid deviceId, string commandId)
    {
        ValidateKey(organizationId, deviceId, commandId);
        lock (_gate)
            return Read().Results.SingleOrDefault(e => e.OrganizationId == organizationId &&
                e.DeviceId == deviceId && e.Result.CommandId == commandId)?.Result;
    }

    public void Store(Guid organizationId, Guid deviceId, ControlCommandResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        ValidateKey(organizationId, deviceId, result.CommandId);
        ValidateResult(result);
        lock (_gate)
        {
            var document = Read();
            var existing = document.Results.SingleOrDefault(e => e.OrganizationId == organizationId &&
                e.DeviceId == deviceId && e.Result.CommandId == result.CommandId);
            if (existing is not null)
            {
                if (existing.Result != result) throw new InvalidDataException("Conflicting completed command result.");
                return;
            }
            var entries = document.Results.Append(new Entry(organizationId, deviceId, result))
                .TakeLast(_capacity).ToList();
            var temporaryPath = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            // Leave interrupted writes as evidence. Reads fail closed until an operator reconciles them.
            using (var stream = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write,
                FileShare.None, 32 * 1024, FileOptions.WriteThrough))
            {
                JsonSerializer.Serialize(stream, new Document(1, entries), JsonOptions);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporaryPath, _path, overwrite: true);
        }
    }

    private Document Read()
    {
        if (Directory.EnumerateFiles(Path.GetDirectoryName(_path)!, "completed-commands.json.*.tmp").Any())
            throw new InvalidDataException("Interrupted completed-command persistence requires reconciliation.");
        try
        {
            using var stream = File.OpenRead(_path);
            var document = JsonSerializer.Deserialize<Document>(stream, JsonOptions);
            if (document is null || document.SchemaVersion != 1 || document.Results is null ||
                document.Results.Count > 1000)
                throw new InvalidDataException("Invalid completed-command journal schema or size.");
            var keys = new HashSet<(Guid, Guid, string)>();
            foreach (var entry in document.Results)
            {
                if (entry is null || entry.Result is null) throw new InvalidDataException("Invalid journal entry.");
                ValidateKey(entry.OrganizationId, entry.DeviceId, entry.Result.CommandId);
                ValidateResult(entry.Result);
                if (!keys.Add((entry.OrganizationId, entry.DeviceId, entry.Result.CommandId)))
                    throw new InvalidDataException("Duplicate completed-command journal key.");
            }
            return document;
        }
        catch (FileNotFoundException)
        {
            return new Document(1, []);
        }
        catch (Exception error) when (error is JsonException or ArgumentException)
        {
            throw new InvalidDataException("Completed-command journal is corrupt; evidence was preserved.", error);
        }
    }

    private static void ValidateKey(Guid organizationId, Guid deviceId, string commandId)
    {
        if (organizationId == Guid.Empty || deviceId == Guid.Empty ||
            !Guid.TryParse(commandId, out var id) || id == Guid.Empty)
            throw new ArgumentException("Completed-command keys must contain nonempty IDs.");
    }

    private static void ValidateResult(ControlCommandResult result)
    {
        if (string.IsNullOrWhiteSpace(result.ResultingState) || result.ResultingState.Length > 4096 ||
            result.Error?.Length > 4096 || result.CompletedAt == default)
            throw new ArgumentException("Invalid completed-command result.");
    }
}
