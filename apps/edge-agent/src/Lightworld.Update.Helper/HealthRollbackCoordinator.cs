using System.Diagnostics;

namespace Lightworld.Update.Helper;

public sealed class HealthRollbackCoordinator
{
    private readonly string _installRoot;
    private readonly AtomicInstallSwitcher _switcher;
    private readonly TimeSpan _pollInterval;

    public HealthRollbackCoordinator(string installRoot, TimeSpan? pollInterval = null)
    {
        _installRoot = Path.GetFullPath(installRoot);
        _switcher = new AtomicInstallSwitcher(_installRoot);
        _pollInterval = pollInterval ?? TimeSpan.FromMilliseconds(250);
    }

    public string HealthMarkerPath(string token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Any(character => !char.IsLetterOrDigit(character) && character is not '-' and not '_'))
            throw new InvalidDataException("Health token contains invalid characters.");
        return Path.Combine(_installRoot, "state", $"health-{token}.ok");
    }

    public async Task<bool> ConfirmOrRollbackAsync(
        string healthToken,
        TimeSpan timeout,
        Func<bool> processStillRunning,
        CancellationToken cancellationToken)
    {
        var marker = HealthMarkerPath(healthToken);
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (File.Exists(marker))
            {
                var content = await File.ReadAllTextAsync(marker, cancellationToken).ConfigureAwait(false);
                if (CryptographicEquals(content.Trim(), healthToken)) return true;
            }
            if (!processStillRunning()) break;
            await Task.Delay(_pollInterval, cancellationToken).ConfigureAwait(false);
        }

        await _switcher.RollbackAsync(cancellationToken).ConfigureAwait(false);
        return false;
    }

    public async Task<bool> LaunchAndConfirmAsync(
        UpdatePlan rawPlan,
        Func<ProcessStartInfo, Process?> launcher,
        CancellationToken cancellationToken)
    {
        var plan = rawPlan.Normalize();
        var marker = HealthMarkerPath(plan.HealthToken);
        Directory.CreateDirectory(Path.GetDirectoryName(marker)!);
        if (File.Exists(marker)) File.Delete(marker);

        Process? process = null;
        try
        {
            var executable = Path.GetFullPath(Path.Combine(plan.InstallRoot, "current", plan.DesktopExeRelativePath));
            var currentRoot = Path.GetFullPath(Path.Combine(plan.InstallRoot, "current")) + Path.DirectorySeparatorChar;
            if (!executable.StartsWith(currentRoot, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Desktop executable escapes the current install directory.");
            var startInfo = new ProcessStartInfo(executable) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(executable)! };
            startInfo.ArgumentList.Add("--update-health-token");
            startInfo.ArgumentList.Add(plan.HealthToken);
            process = launcher(startInfo) ?? throw new InvalidOperationException("Updated desktop process did not start.");
            return await ConfirmOrRollbackAsync(
                plan.HealthToken,
                TimeSpan.FromSeconds(plan.HealthTimeoutSeconds),
                () => !process.HasExited,
                cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            await _switcher.RollbackAsync(CancellationToken.None).ConfigureAwait(false);
            return false;
        }
        finally
        {
            process?.Dispose();
        }
    }

    private static bool CryptographicEquals(string left, string right)
    {
        var leftBytes = System.Text.Encoding.UTF8.GetBytes(left);
        var rightBytes = System.Text.Encoding.UTF8.GetBytes(right);
        return leftBytes.Length == rightBytes.Length &&
            System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }
}
