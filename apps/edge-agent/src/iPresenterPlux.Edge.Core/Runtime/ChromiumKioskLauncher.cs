using System.Diagnostics;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed record ProgramWindowPlacement(int X, int Y, int? Width = null, int? Height = null)
{
    public ProgramWindowPlacement Validate()
    {
        if (Width is <= 0 || Height is <= 0)
            throw new ArgumentOutOfRangeException(nameof(Width), "Window dimensions must be positive when supplied.");
        return this;
    }
}

public sealed class ChromiumKioskLauncher : IAsyncDisposable
{
    private readonly IReadOnlyList<string> _candidatePaths;
    private readonly string _profileDirectory;
    private Process? _process;
    private bool _disposed;

    public ChromiumKioskLauncher(IEnumerable<string> candidatePaths, string profileDirectory)
    {
        ArgumentNullException.ThrowIfNull(candidatePaths);
        ArgumentException.ThrowIfNullOrWhiteSpace(profileDirectory);
        _candidatePaths = candidatePaths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(path => path.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        _profileDirectory = Path.GetFullPath(profileDirectory);
        Directory.CreateDirectory(_profileDirectory);
    }

    public string? ActiveExecutable { get; private set; }
    public bool IsRunning => _process is { HasExited: false };
    public int? ActiveProcessId
    {
        get
        {
            try { return _process is { HasExited: false } process ? process.Id : null; }
            catch (InvalidOperationException) { return null; }
        }
    }

    public async Task<bool> LaunchAsync(
        Uri programUri,
        ProgramWindowPlacement? placement = null,
        CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        ArgumentNullException.ThrowIfNull(programUri);
        if (!programUri.IsLoopback || programUri.Scheme != Uri.UriSchemeHttp)
            throw new ArgumentException("The managed Program browser may open only the local HTTP renderer.", nameof(programUri));
        placement?.Validate();

        await StopAsync(cancellationToken).ConfigureAwait(false);
        var executable = ResolveExecutable();
        if (executable is null) return false;

        var start = new ProcessStartInfo
        {
            FileName = executable,
            UseShellExecute = false,
            CreateNoWindow = false
        };
        start.ArgumentList.Add("--kiosk");
        start.ArgumentList.Add(programUri.AbsoluteUri);
        start.ArgumentList.Add($"--user-data-dir={_profileDirectory}");
        start.ArgumentList.Add("--no-first-run");
        start.ArgumentList.Add("--no-default-browser-check");
        start.ArgumentList.Add("--disable-session-crashed-bubble");
        start.ArgumentList.Add("--disable-infobars");
        if (placement is not null)
        {
            start.ArgumentList.Add($"--window-position={placement.X},{placement.Y}");
            if (placement.Width is { } width && placement.Height is { } height)
                start.ArgumentList.Add($"--window-size={width},{height}");
        }

        try
        {
            _process = Process.Start(start);
            if (_process is null) return false;
            ActiveExecutable = executable;
            await Task.Delay(250, cancellationToken).ConfigureAwait(false);
            if (_process.HasExited)
            {
                _process.Dispose();
                _process = null;
                ActiveExecutable = null;
                return false;
            }
            return true;
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            _process?.Dispose();
            _process = null;
            ActiveExecutable = null;
            return false;
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        var process = _process;
        _process = null;
        ActiveExecutable = null;
        if (process is null) return;
        try
        {
            if (!process.HasExited)
            {
                if (process.CloseMainWindow())
                {
                    try { await process.WaitForExitAsync(cancellationToken).WaitAsync(TimeSpan.FromSeconds(2), cancellationToken).ConfigureAwait(false); }
                    catch (TimeoutException) { }
                }
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                    await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
                }
            }
        }
        catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            // Display shutdown must never block Edge shutdown.
        }
        finally { process.Dispose(); }
    }

    private string? ResolveExecutable()
    {
        foreach (var path in _candidatePaths)
        {
            if (Path.IsPathFullyQualified(path) && File.Exists(path)) return path;
        }
        return null;
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await StopAsync(CancellationToken.None).ConfigureAwait(false);
    }
}
