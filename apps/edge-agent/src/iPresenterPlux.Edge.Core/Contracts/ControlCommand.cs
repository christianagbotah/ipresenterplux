namespace iPresenterPlux.Edge.Core.Contracts;

public sealed record ControlCommand(
    string CommandId,
    string ServiceId,
    string Type,
    DateTimeOffset IssuedAt,
    IReadOnlyDictionary<string, string> Arguments);

public sealed record ControlCommandResult(
    string CommandId,
    bool Success,
    string ResultingState,
    string? Error,
    DateTimeOffset CompletedAt);
