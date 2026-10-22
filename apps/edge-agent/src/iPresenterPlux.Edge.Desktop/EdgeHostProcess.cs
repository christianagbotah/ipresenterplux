using System.Diagnostics;

namespace iPresenterPlux.Edge.Desktop;

public interface IEdgeChildProcess : IDisposable
{
    int Id { get; }
    bool HasExited { get; }
    int ExitCode { get; }
    IReadOnlyList<string> RecentStandardError { get; }
    Task WaitForExitAsync(CancellationToken cancellationToken);
    void Kill(bool entireProcessTree);
}

public interface IEdgeChildProcessFactory
{
    IEdgeChildProcess Start(ProcessStartInfo startInfo);
}

public sealed class SystemEdgeChildProcessFactory : IEdgeChildProcessFactory
{
    public IEdgeChildProcess Start(ProcessStartInfo startInfo)
    {
        ArgumentNullException.ThrowIfNull(startInfo);
        var standardError = new BoundedLineBuffer(40);
        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        if (startInfo.RedirectStandardError)
            process.ErrorDataReceived += (_, args) => standardError.Add(args.Data);
        if (!process.Start())
        {
            process.Dispose();
            throw new InvalidOperationException("edge_host_start_failed");
        }
        if (startInfo.RedirectStandardOutput) process.BeginOutputReadLine();
        if (startInfo.RedirectStandardError) process.BeginErrorReadLine();
        return new SystemEdgeChildProcess(process, standardError);
    }

    private sealed class SystemEdgeChildProcess(Process process, BoundedLineBuffer standardError) : IEdgeChildProcess
    {
        public int Id => process.Id;
        public bool HasExited => process.HasExited;
        public int ExitCode => process.ExitCode;
        public IReadOnlyList<string> RecentStandardError => standardError.Snapshot();
        public Task WaitForExitAsync(CancellationToken cancellationToken) => process.WaitForExitAsync(cancellationToken);
        public void Kill(bool entireProcessTree) => process.Kill(entireProcessTree);
        public void Dispose() => process.Dispose();
    }

    private sealed class BoundedLineBuffer(int capacity)
    {
        private readonly object _gate = new();
        private readonly Queue<string> _lines = new();

        public void Add(string? line)
        {
            if (string.IsNullOrWhiteSpace(line)) return;
            lock (_gate)
            {
                _lines.Enqueue(line.Trim());
                while (_lines.Count > capacity) _lines.Dequeue();
            }
        }

        public IReadOnlyList<string> Snapshot()
        {
            lock (_gate) return _lines.ToArray();
        }
    }
}
