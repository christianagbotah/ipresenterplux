namespace iPresenterPlux.Edge.Core.Models;

public sealed record EdgeDeviceHealth(
    string DeviceId,
    string DeviceName,
    string Version,
    string Status,
    DateTimeOffset ObservedAt,
    double CpuPercent,
    double MemoryPercent,
    double? UplinkMbps,
    IReadOnlyDictionary<string, string> Capabilities);
