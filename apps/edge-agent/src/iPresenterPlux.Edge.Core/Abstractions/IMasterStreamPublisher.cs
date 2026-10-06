namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed record MasterStreamStatus(
    bool IsPublishing,
    Guid? ServiceId,
    string State,
    DateTimeOffset? StartedAt,
    long? BitrateBps,
    double? FramesPerSecond,
    long DroppedFrames,
    int ReconnectCount,
    DateTimeOffset? LastSuccessfulSendAt,
    string? ErrorCode);

public interface IMasterStreamPublisher : IAsyncDisposable
{
    MasterStreamStatus Status { get; }

    Task<MasterStreamStatus> StartAsync(Guid serviceId, CancellationToken cancellationToken);

    Task<MasterStreamStatus> StopAsync(CancellationToken cancellationToken);

    Task HandleActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken);
}
