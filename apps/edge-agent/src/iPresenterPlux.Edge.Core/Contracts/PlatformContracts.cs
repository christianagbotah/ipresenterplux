namespace iPresenterPlux.Edge.Core.Contracts;

public enum EdgePlatform
{
    Windows,
    MacOS
}

public sealed record PlatformCapability(
    string Key,
    string DisplayName,
    string Status,
    string? Detail = null);

public sealed record PlatformProfile(
    EdgePlatform Platform,
    string Architecture,
    IReadOnlyList<PlatformCapability> Capabilities);
