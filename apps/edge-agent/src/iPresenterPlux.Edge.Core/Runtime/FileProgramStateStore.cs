using System.Text.Json;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed record PersistedProgramState(
    int SchemaVersion,
    PresentationRenderItem? Preview,
    PresentationRenderItem? Program);

public sealed class FileProgramStateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _statePath;
    private readonly string _tempPath;

    public FileProgramStateStore(string directoryPath, string fileName = "program-state.json")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directoryPath);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        if (Path.GetFileName(fileName) != fileName)
            throw new ArgumentException("Program state file name must not contain a directory path.", nameof(fileName));

        Directory.CreateDirectory(directoryPath);
        _statePath = Path.Combine(directoryPath, fileName);
        _tempPath = _statePath + ".tmp";
        RecoverInterruptedWrite();
    }

    public async Task<PersistedProgramState?> ReadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_statePath)) return null;
        try
        {
            await using var stream = new FileStream(
                _statePath, FileMode.Open, FileAccess.Read, FileShare.Read,
                32 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            var state = await JsonSerializer.DeserializeAsync<PersistedProgramState>(stream, JsonOptions, cancellationToken)
                .ConfigureAwait(false);
            if (state is null || state.SchemaVersion != 1)
                throw new InvalidDataException("Program state has an unsupported schema version.");
            return state;
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Program state is corrupted; it was not overwritten.", error);
        }
    }

    public async Task SaveAsync(PersistedProgramState state, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(state);
        if (state.SchemaVersion != 1) throw new ArgumentOutOfRangeException(nameof(state));

        await using (var stream = new FileStream(
            _tempPath, FileMode.Create, FileAccess.Write, FileShare.None,
            32 * 1024, FileOptions.Asynchronous | FileOptions.WriteThrough))
        {
            await JsonSerializer.SerializeAsync(stream, state, JsonOptions, cancellationToken).ConfigureAwait(false);
            await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            stream.Flush(flushToDisk: true);
        }
        File.Move(_tempPath, _statePath, overwrite: true);
    }

    private void RecoverInterruptedWrite()
    {
        if (!File.Exists(_statePath) && File.Exists(_tempPath))
            File.Move(_tempPath, _statePath);
        else if (File.Exists(_statePath) && File.Exists(_tempPath))
            File.Delete(_tempPath);
    }
}
