using System.Diagnostics;

namespace iPresenterPlux.Edge.Desktop;

public interface IEdgeChildProcess : IDisposable
{
    int Id { get; }
    bool HasExited { get; }
    int ExitCode { get; }
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
        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        if (!process.Start())
        {
            process.Dispose();
            throw new InvalidOperationException("edge_host_start_failed");
        }
        if (startInfo.RedirectStandardOutput) process.BeginOutputReadLine();
        if (startInfo.RedirectStandardError) process.BeginErrorReadLine();
        return new SystemEdgeChildProcess(process);
    }

    private sealed class SystemEdgeChildProcess(Process process) : IEdgeChildProcess
    {
        public int Id => process.Id;
        public bool HasExited => process.HasExited;
        public int ExitCode => process.ExitCode;
        public Task WaitForExitAsync(CancellationToken cancellationToken) => process.WaitForExitAsync(cancellationToken);
        public void Kill(bool entireProcessTree) => process.Kill(entireProcessTree);
        public void Dispose() => process.Dispose();
    }
}
