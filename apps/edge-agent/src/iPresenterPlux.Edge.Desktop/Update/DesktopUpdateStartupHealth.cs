namespace iPresenterPlux.Edge.Desktop.Update;

public static class DesktopUpdateStartupHealth
{
    public static async Task ReportWhenReadyAsync(
        Task settingsLoaded,
        Task localBootstrap,
        string healthToken,
        string installRoot,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(settingsLoaded);
        ArgumentNullException.ThrowIfNull(localBootstrap);
        if (string.IsNullOrWhiteSpace(healthToken) ||
            healthToken.Length > 200 ||
            healthToken.Any(character => !char.IsLetterOrDigit(character) && character is not '-' and not '_'))
            throw new InvalidDataException("Update health token is invalid.");
        ArgumentException.ThrowIfNullOrWhiteSpace(installRoot);

        await settingsLoaded.WaitAsync(cancellationToken).ConfigureAwait(false);
        await localBootstrap.WaitAsync(cancellationToken).ConfigureAwait(false);

        var stateDirectory = Path.Combine(Path.GetFullPath(installRoot), "state");
        Directory.CreateDirectory(stateDirectory);
        var marker = Path.Combine(stateDirectory, $"health-{healthToken}.ok");
        var temporary = marker + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temporary, healthToken, cancellationToken).ConfigureAwait(false);
            File.Move(temporary, marker, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        }
    }
}

public static class DesktopInstallLayout
{
    public static string? TryResolveInstallRoot(string baseDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseDirectory);
        var current = new DirectoryInfo(Path.GetFullPath(baseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)));
        return string.Equals(current.Name, "current", StringComparison.OrdinalIgnoreCase)
            ? current.Parent?.FullName
            : null;
    }
}
