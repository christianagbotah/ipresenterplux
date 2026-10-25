namespace iPresenterPlux.Edge.Desktop;

public sealed record DesktopSettings(
    string ControlPlaneUrl,
    string DeviceName,
    int ProgramPort = 49321,
    string InstallationId = "",
    string UpdateChannel = "stable",
    string UpdateHubUrl = "https://updates.lightworldtech.com",
    string? ProgramDisplayId = null,
    int? ProgramDisplayX = null,
    int? ProgramDisplayY = null,
    int? ProgramDisplayWidth = null,
    int? ProgramDisplayHeight = null,
    double? OperatorSidebarColumn = null,
    double? OperatorPreviewColumn = null,
    double? OperatorProgramColumn = null,
    double? OperatorStageRow = null,
    double? OperatorDeckRow = null,
    bool OperatorSidebarCollapsed = false,
    bool OperatorResourceDeckCollapsed = false,
    string OperatorLayoutPreset = "production")
{
    public static DesktopSettings CreateDefault() => new(
        "",
        Environment.MachineName,
        49321,
        Guid.NewGuid().ToString("N"),
        "stable",
        "https://updates.lightworldtech.com");

    public Uri ValidateControlPlaneUri()
    {
        if (!Uri.TryCreate(ControlPlaneUrl?.Trim(), UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            throw new InvalidOperationException("Enter an absolute HTTP(S) Control Plane URL.");
        if (uri.Scheme != Uri.UriSchemeHttps && !uri.IsLoopback)
            throw new InvalidOperationException("Remote Control Plane URLs must use HTTPS.");
        return uri;
    }

    public Uri ValidateUpdateHubUri()
    {
        if (!Uri.TryCreate(UpdateHubUrl?.Trim(), UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            throw new InvalidOperationException("Enter an absolute HTTP(S) Update Hub URL.");
        if (uri.Scheme != Uri.UriSchemeHttps && !uri.IsLoopback)
            throw new InvalidOperationException("Remote Update Hub URLs must use HTTPS.");
        return uri;
    }

    public DesktopSettings Normalize()
    {
        _ = ValidateControlPlaneUri();
        var updateHub = ValidateUpdateHubUri();
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
        var updateChannel = string.IsNullOrWhiteSpace(UpdateChannel) ? "stable" : UpdateChannel.Trim().ToLowerInvariant();
        if (updateChannel is not "stable" and not "beta")
            throw new InvalidOperationException("Update channel must be stable or beta.");

        var programDisplayId = string.IsNullOrWhiteSpace(ProgramDisplayId) ? null : ProgramDisplayId.Trim();
        if (programDisplayId is { Length: > 240 })
            throw new InvalidOperationException("Program display identity is too long.");
        if (programDisplayId is not null &&
            (ProgramDisplayX is null || ProgramDisplayY is null ||
             ProgramDisplayWidth is null || ProgramDisplayHeight is null ||
             ProgramDisplayWidth <= 0 || ProgramDisplayHeight <= 0))
            throw new InvalidOperationException("Program display placement requires a valid position and positive dimensions.");

        var operatorLayoutPreset = OperatorWorkspaceLayouts.IsValidPreset(OperatorLayoutPreset)
            ? OperatorLayoutPreset!
            : OperatorWorkspaceLayouts.Production;

        return this with {
            ControlPlaneUrl = ControlPlaneUrl.Trim().TrimEnd('/'),
            DeviceName = deviceName,
            InstallationId = installationId,
            UpdateChannel = updateChannel,
            UpdateHubUrl = updateHub.ToString().TrimEnd('/'),
            ProgramDisplayId = programDisplayId,
            ProgramDisplayX = programDisplayId is null ? null : ProgramDisplayX,
            ProgramDisplayY = programDisplayId is null ? null : ProgramDisplayY,
            ProgramDisplayWidth = programDisplayId is null ? null : ProgramDisplayWidth,
            ProgramDisplayHeight = programDisplayId is null ? null : ProgramDisplayHeight,
            OperatorSidebarColumn = ClampStar(OperatorSidebarColumn),
            OperatorPreviewColumn = ClampStar(OperatorPreviewColumn),
            OperatorProgramColumn = ClampStar(OperatorProgramColumn),
            OperatorStageRow = ClampStar(OperatorStageRow),
            OperatorDeckRow = ClampStar(OperatorDeckRow),
            OperatorSidebarCollapsed = OperatorSidebarCollapsed,
            OperatorResourceDeckCollapsed = OperatorResourceDeckCollapsed,
            OperatorLayoutPreset = operatorLayoutPreset
        };
    }

    private static double? ClampStar(double? value) =>
        value is null ? null : Math.Clamp(value.Value, 0.2, 4.0);

    public DesktopSettings NormalizeUpdateSettings()
    {
        var updateHub = ValidateUpdateHubUri();
        var installationId = string.IsNullOrWhiteSpace(InstallationId)
            ? Guid.NewGuid().ToString("N")
            : InstallationId.Trim();
        if (installationId.Length is < 16 or > 200)
            throw new InvalidOperationException("Installation identity must be between 16 and 200 characters.");
        var updateChannel = string.IsNullOrWhiteSpace(UpdateChannel) ? "stable" : UpdateChannel.Trim().ToLowerInvariant();
        if (updateChannel is not "stable" and not "beta")
            throw new InvalidOperationException("Update channel must be stable or beta.");
        return this with {
            InstallationId = installationId,
            UpdateChannel = updateChannel,
            UpdateHubUrl = updateHub.ToString().TrimEnd('/')
        };
    }
}
