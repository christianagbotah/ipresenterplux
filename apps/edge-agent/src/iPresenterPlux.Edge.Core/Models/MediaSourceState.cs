namespace iPresenterPlux.Edge.Core.Models;

public sealed record MediaSourceState(
    string SourceId,
    string Name,
    string SourceType,
    string Status,
    DateTimeOffset ObservedAt,
    IReadOnlyDictionary<string, string> Metadata);
