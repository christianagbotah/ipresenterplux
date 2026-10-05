namespace iPresenterPlux.Edge.Core.Models;

public sealed record MediaSourceState(
    Guid? ServiceId,
    string SourceId,
    string Name,
    string SourceType,
    string Status,
    DateTimeOffset ObservedAt,
    IReadOnlyDictionary<string, string> Metadata);
