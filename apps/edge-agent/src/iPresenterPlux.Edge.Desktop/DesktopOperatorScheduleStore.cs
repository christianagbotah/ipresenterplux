using System.Text.Json;

namespace iPresenterPlux.Edge.Desktop;

public sealed class DesktopOperatorScheduleStore
{
    private const int MaxItems = 200;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly string _rootDirectory;
    private readonly string _path;

    public DesktopOperatorScheduleStore(string rootDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(rootDirectory);
        _rootDirectory = Path.GetFullPath(rootDirectory);
        _path = Path.Combine(_rootDirectory, "operator-schedule.json");
    }

    public async Task<IReadOnlyList<OperatorWorkspaceItem>> LoadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return Array.Empty<OperatorWorkspaceItem>();
        try
        {
            await using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read, 32 * 1024, useAsync: true);
            var items = await JsonSerializer.DeserializeAsync<OperatorWorkspaceItem[]>(stream, JsonOptions, cancellationToken).ConfigureAwait(false);
            if (items is null) return Array.Empty<OperatorWorkspaceItem>();
            return Normalize(items);
        }
        catch (Exception error) when (error is JsonException or IOException or UnauthorizedAccessException)
        {
            return Array.Empty<OperatorWorkspaceItem>();
        }
    }

    public async Task SaveAsync(IEnumerable<OperatorWorkspaceItem> items, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(items);
        var normalized = Normalize(items);
        Directory.CreateDirectory(_rootDirectory);
        var temporary = Path.Combine(_rootDirectory, $"operator-schedule-{Guid.NewGuid():N}.tmp");
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 32 * 1024, useAsync: true))
            {
                await JsonSerializer.SerializeAsync(stream, normalized, JsonOptions, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }
            File.Move(temporary, _path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private static OperatorWorkspaceItem[] Normalize(IEnumerable<OperatorWorkspaceItem> items)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<OperatorWorkspaceItem>(MaxItems);
        foreach (var item in items)
        {
            if (result.Count >= MaxItems) break;
            if (item is null || string.IsNullOrWhiteSpace(item.Id) || !seen.Add(item.Id)) continue;
            if (string.IsNullOrWhiteSpace(item.Title) || string.IsNullOrWhiteSpace(item.Body)) continue;
            result.Add(item);
        }
        return result.ToArray();
    }
}
