using System.Diagnostics;
using iPresenterPlux.Edge.Desktop;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class EdgeRuntimeDiagnosticsTests
{
    [Fact]
    public void SnapshotCarriesAUserSafeRuntimeDiagnostic()
    {
        Assert.Contains(typeof(EdgeDesktopSnapshot).GetProperties(), property => property.Name == "DiagnosticMessage");
    }

    [Fact]
    public void SystemChildProcessCapturesRedirectedStandardErrorInsteadOfDiscardingIt()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "EdgeHostProcess.cs"));

        Assert.Contains("ErrorDataReceived +=", source, StringComparison.Ordinal);
        Assert.Contains("RecentStandardError", source, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SystemChildProcessCapturesActualStandardError()
    {
        var start = new ProcessStartInfo
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        if (OperatingSystem.IsWindows())
        {
            start.FileName = "cmd.exe";
            start.ArgumentList.Add("/d");
            start.ArgumentList.Add("/c");
            start.ArgumentList.Add("echo diagnostic-marker 1>&2 & exit /b 9");
        }
        else
        {
            start.FileName = "/bin/sh";
            start.ArgumentList.Add("-c");
            start.ArgumentList.Add("echo diagnostic-marker >&2; exit 9");
        }

        using var child = new SystemEdgeChildProcessFactory().Start(start);
        await child.WaitForExitAsync(CancellationToken.None);
        await Task.Delay(50); // DataReceived callbacks are asynchronous.

        Assert.Contains(child.RecentStandardError, line => line.Contains("diagnostic-marker", StringComparison.Ordinal));
    }

    [Fact]
    public void SetupStatusSurfacesTheChildRuntimeDiagnostic()
    {
        var source = File.ReadAllText(FindSourceFile("apps", "edge-agent", "src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));
        Assert.Contains("snapshot.DiagnosticMessage", source, StringComparison.Ordinal);
    }

    private static string FindSourceFile(params string[] pathParts)
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine([current.FullName, .. pathParts]);
            if (File.Exists(candidate)) return candidate;
            current = current.Parent;
        }

        throw new FileNotFoundException("Could not locate desktop source from the test output directory.");
    }
}
