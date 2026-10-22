using System.Diagnostics;
using Lightworld.Update.Helper;
using Xunit;

namespace Lightworld.Update.Helper.Tests;

public sealed class ParentProcessExitWaiterTests
{
    [Fact]
    public async Task WaitsUntilSpecifiedParentProcessExitsBeforeReturning()
    {
        using var process = StartShortLivedProcess();
        var started = Stopwatch.StartNew();

        await ParentProcessExitWaiter.WaitAsync(process.Id, TimeSpan.FromSeconds(5), CancellationToken.None);

        started.Stop();
        Assert.True(process.HasExited);
        Assert.True(started.Elapsed >= TimeSpan.FromMilliseconds(100), $"Wait returned too early after {started.Elapsed}.");
    }

    [Fact]
    public async Task MissingParentProcessIsAlreadySafeToProceed()
    {
        var impossiblePid = int.MaxValue;
        var started = Stopwatch.StartNew();

        await ParentProcessExitWaiter.WaitAsync(impossiblePid, TimeSpan.FromSeconds(2), CancellationToken.None);

        Assert.True(started.Elapsed < TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task TimeoutFailsClosedInsteadOfSwitchingWhileParentIsAlive()
    {
        using var process = StartShortLivedProcess(TimeSpan.FromSeconds(2));

        await Assert.ThrowsAsync<TimeoutException>(() =>
            ParentProcessExitWaiter.WaitAsync(process.Id, TimeSpan.FromMilliseconds(50), CancellationToken.None));

        if (!process.HasExited)
        {
            process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
        }
    }

    private static Process StartShortLivedProcess(TimeSpan? duration = null)
    {
        var wait = duration ?? TimeSpan.FromMilliseconds(350);
        ProcessStartInfo start;
        if (OperatingSystem.IsWindows())
        {
            start = new ProcessStartInfo("powershell.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true
            };
            start.ArgumentList.Add("-NoProfile");
            start.ArgumentList.Add("-NonInteractive");
            start.ArgumentList.Add("-Command");
            start.ArgumentList.Add($"Start-Sleep -Milliseconds {Math.Ceiling(wait.TotalMilliseconds)}");
        }
        else
        {
            start = new ProcessStartInfo("/bin/sh")
            {
                UseShellExecute = false
            };
            start.ArgumentList.Add("-c");
            start.ArgumentList.Add($"sleep {wait.TotalSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture)}");
        }

        return Process.Start(start) ?? throw new InvalidOperationException("Could not start helper test process.");
    }
}
