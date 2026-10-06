namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed record ContributionStreamTransportStatus(
    bool IsPublishing,
    string State,
    long? BitrateBps,
    double? FramesPerSecond,
    long DroppedFrames,
    int ReconnectCount,
    DateTimeOffset? LastSuccessfulSendAt,
    string? ErrorCode);

public interface IContributionStreamTransport : IAsyncDisposable
{
    ContributionStreamTransportStatus Status { get; }

    Task<ContributionStreamTransportStatus> StartAsync(
        StreamContributionGrant grant,
        CancellationToken cancellationToken);

    Task<ContributionStreamTransportStatus> StopAsync(CancellationToken cancellationToken);
}
