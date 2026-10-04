using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Security;

/// <summary>
/// Persists only non-secret Edge identity metadata. Credential material remains in the OS vault.
/// </summary>
public sealed class FileAgentIdentityStore : IAgentIdentityStore, IAsyncDisposable
{
    private sealed record Envelope(int SchemaVersion, AgentIdentity Identity);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private readonly string _tempPath;
    private bool _disposed;

    public FileAgentIdentityStore(string directoryPath, string fileName = "edge-identity.json")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directoryPath);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        if (Path.GetFileName(fileName) != fileName)
            throw new ArgumentException("Identity file name must not contain a directory path.", nameof(fileName));

        Directory.CreateDirectory(directoryPath);
        _path = Path.Combine(directoryPath, fileName);
        _tempPath = _path + ".tmp";
        RecoverInterruptedFirstWrite();
    }

    public async Task<AgentIdentity?> ReadAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            if (!File.Exists(_path)) return null;

            try
            {
                await using var stream = new FileStream(
                    _path,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read,
                    16 * 1024,
                    FileOptions.Asynchronous | FileOptions.SequentialScan);
                var envelope = await JsonSerializer.DeserializeAsync<Envelope>(stream, JsonOptions, cancellationToken)
                    .ConfigureAwait(false);
                if (envelope is null || envelope.SchemaVersion != 1)
                    throw new InvalidDataException("Edge identity metadata has an unsupported schema version.");
                Validate(envelope.Identity);
                return envelope.Identity;
            }
            catch (JsonException error)
            {
                throw new InvalidDataException("Edge identity metadata is corrupted; it was not overwritten.", error);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task SaveAsync(AgentIdentity identity, CancellationToken cancellationToken)
    {
        Validate(identity);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            await using (var stream = new FileStream(
                _tempPath,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None,
                16 * 1024,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(
                    stream,
                    new Envelope(1, identity),
                    JsonOptions,
                    cancellationToken).ConfigureAwait(false);
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

    public async Task ClearAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            if (File.Exists(_path)) File.Delete(_path);
            if (File.Exists(_tempPath)) File.Delete(_tempPath);
        }
        finally
        {
            _gate.Release();
        }
    }

    public ValueTask DisposeAsync()
    {
        if (!_disposed)
        {
            _disposed = true;
            _gate.Dispose();
        }
        return ValueTask.CompletedTask;
    }

    private void RecoverInterruptedFirstWrite()
    {
        if (!File.Exists(_path) && File.Exists(_tempPath))
            File.Move(_tempPath, _path);
        else if (File.Exists(_path) && File.Exists(_tempPath))
            File.Delete(_tempPath);
    }

    private static void Validate(AgentIdentity identity)
    {
        ArgumentNullException.ThrowIfNull(identity);
        if (identity.DeviceId == Guid.Empty || identity.OrganizationId == Guid.Empty)
            throw new ArgumentException("Edge identity requires organization and device IDs.", nameof(identity));
        ArgumentException.ThrowIfNullOrWhiteSpace(identity.DeviceName);
        ArgumentException.ThrowIfNullOrWhiteSpace(identity.SoftwareVersion);
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}
