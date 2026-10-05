namespace iPresenterPlux.Edge.Core.Runtime;

public sealed record ProgramDisplayConfiguration(
    bool AutoOpen,
    string? BrowserPath,
    ProgramWindowPlacement? Placement)
{
    public static ProgramDisplayConfiguration FromEnvironment(bool defaultAutoOpen)
    {
        var autoOpen = ReadBoolean("IPRESENTERPLUX_PROGRAM_AUTO_OPEN", defaultAutoOpen);
        var browserPath = Environment.GetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_BROWSER_PATH")?.Trim();
        if (string.IsNullOrWhiteSpace(browserPath)) browserPath = null;

        var position = ParsePair(Environment.GetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_POSITION"));
        var size = ParsePair(Environment.GetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_SIZE"));
        ProgramWindowPlacement? placement = null;
        if (position is { } point)
        {
            placement = size is { } dimensions
                ? new ProgramWindowPlacement(point.First, point.Second, dimensions.First, dimensions.Second).Validate()
                : new ProgramWindowPlacement(point.First, point.Second);
        }
        else if (size is not null)
        {
            throw new InvalidOperationException("IPRESENTERPLUX_PROGRAM_SIZE requires IPRESENTERPLUX_PROGRAM_POSITION.");
        }

        return new ProgramDisplayConfiguration(autoOpen, browserPath, placement);
    }

    private static bool ReadBoolean(string name, bool fallback)
    {
        var value = Environment.GetEnvironmentVariable(name)?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        return value switch
        {
            "1" or "true" or "yes" or "on" => true,
            "0" or "false" or "no" or "off" => false,
            _ => throw new InvalidOperationException($"{name} must be true/false, yes/no, on/off, or 1/0.")
        };
    }

    private static (int First, int Second)? ParsePair(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var parts = value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2 || !int.TryParse(parts[0], out var first) || !int.TryParse(parts[1], out var second))
            throw new InvalidOperationException("Program display position/size values must contain two comma-separated integers.");
        return (first, second);
    }
}
