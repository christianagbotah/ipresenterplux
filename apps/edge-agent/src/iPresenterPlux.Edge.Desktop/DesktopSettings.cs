namespace iPresenterPlux.Edge.Desktop;

public sealed record DesktopSettings(
    string ControlPlaneUrl,
    string DeviceName,
    int ProgramPort = 49321,
    string InstallationId = "")
{
    public static DesktopSettings CreateDefault() => new("", Environment.MachineName, 49321, Guid.NewGuid().ToString("N"));

    public Uri ValidateControlPlaneUri()
    {
        if (!Uri.TryCreate(ControlPlaneUrl?.Trim(), UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            throw new InvalidOperationException("Enter an absolute HTTP(S) Control Plane URL.");
        if (uri.Scheme != Uri.UriSchemeHttps && !uri.IsLoopback)
            throw new InvalidOperationException("Remote Control Plane URLs must use HTTPS.");
        return uri;
    }

    public DesktopSettings Normalize()
    {
        _ = ValidateControlPlaneUri();
        var deviceName = DeviceName?.Trim();
        if (string.IsNullOrWhiteSpace(deviceName) || deviceName.Length > 120)
            throw new InvalidOperationException("Device name must be between 1 and 120 characters.");
        if (ProgramPort is < 1024 or > 65535)
            throw new InvalidOperationException("Program port must be between 1024 and 65535.");
        var installationId = string.IsNullOrWhiteSpace(InstallationId)
            ? Guid.NewGuid().ToString("N")
            : InstallationId.Trim();
        if (installationId.Length is < 16 or > 200)
            throw new InvalidOperationException("Installation identity must be between 16 and 200 characters.");
        return this with {
            ControlPlaneUrl = ControlPlaneUrl.Trim().TrimEnd('/'),
            DeviceName = deviceName,
            InstallationId = installationId
        };
    }
}
