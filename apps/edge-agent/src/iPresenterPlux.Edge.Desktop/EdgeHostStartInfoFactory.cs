using System.Diagnostics;

namespace iPresenterPlux.Edge.Desktop;

public static class EdgeHostStartInfoFactory
{
    public static ProcessStartInfo Create(
        ShellPaths paths,
        DesktopSettings settings,
        string? pairingCode)
    {
        ArgumentNullException.ThrowIfNull(paths);
        ArgumentNullException.ThrowIfNull(settings);
        var normalized = settings.Normalize();
        if (!File.Exists(paths.RuntimeHostPath))
            throw new FileNotFoundException("The packaged Edge runtime is missing.", paths.RuntimeHostPath);

        var start = new ProcessStartInfo
        {
            FileName = paths.RuntimeHostPath,
            WorkingDirectory = Path.GetDirectoryName(paths.RuntimeHostPath) ?? AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        start.Environment["IPRESENTERPLUX_CONTROL_URL"] = normalized.ControlPlaneUrl;
        start.Environment["IPRESENTERPLUX_DEVICE_NAME"] = normalized.DeviceName;
        start.Environment["IPRESENTERPLUX_DATA_DIR"] = paths.EdgeDataDirectory;
        start.Environment["IPRESENTERPLUX_PROGRAM_PORT"] = normalized.ProgramPort.ToString(System.Globalization.CultureInfo.InvariantCulture);
        start.Environment["IPRESENTERPLUX_PROGRAM_AUTO_OPEN"] = "false";
        if (!string.IsNullOrWhiteSpace(pairingCode))
            start.Environment["IPRESENTERPLUX_PAIRING_CODE"] = pairingCode.Trim();
        else
            start.Environment.Remove("IPRESENTERPLUX_PAIRING_CODE");
        return start;
    }
}
