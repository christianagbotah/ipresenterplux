namespace iPresenterPlux.Edge.Desktop;

public sealed record DesktopSettings(
    string ControlPlaneUrl,
    string DeviceName,
    int ProgramPort = 49321)
{
    public static DesktopSettings CreateDefault() => new("", Environment.MachineName, 49321);

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
        return this with {
            ControlPlaneUrl = ControlPlaneUrl.Trim().TrimEnd('/'),
            DeviceName = deviceName
        };
    }
}
