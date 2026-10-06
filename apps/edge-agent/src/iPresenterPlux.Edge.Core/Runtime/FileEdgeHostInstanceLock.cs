namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class FileEdgeHostInstanceLock : IDisposable
{
    private readonly FileStream _stream;
    private bool _disposed;

    private FileEdgeHostInstanceLock(FileStream stream) => _stream = stream;

    public static FileEdgeHostInstanceLock? TryAcquire(string dataDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataDirectory);
        Directory.CreateDirectory(dataDirectory);
        var path = Path.Combine(Path.GetFullPath(dataDirectory), "edge-host.lock");
        try
        {
            var stream = new FileStream(
                path,
                FileMode.OpenOrCreate,
                FileAccess.ReadWrite,
                FileShare.None,
                64,
                FileOptions.WriteThrough);
            stream.SetLength(0);
            using var writer = new StreamWriter(stream, leaveOpen: true);
            writer.Write(Environment.ProcessId);
            writer.Flush();
            stream.Flush(flushToDisk: true);
            stream.Position = 0;
            return new FileEdgeHostInstanceLock(stream);
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _stream.Dispose();
    }
}
