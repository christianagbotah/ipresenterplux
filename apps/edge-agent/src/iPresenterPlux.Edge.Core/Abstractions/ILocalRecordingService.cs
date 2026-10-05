using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed record LocalRecordingStatus(
    bool IsRecording,
    Guid? ServiceId,
    string? RecordingId,
    string? DirectoryPath,
    DateTimeOffset? StartedAt,
    long FramesWritten,
    long DroppedFrames,
    string? ErrorCode);

public interface ILocalRecordingService : IAsyncDisposable
{
    LocalRecordingStatus Status { get; }
    Task<LocalRecordingStatus> StartAsync(Guid serviceId, CancellationToken cancellationToken);
    Task<LocalRecordingStatus> StopAsync(CancellationToken cancellationToken);
    Task HandleActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken);
    bool TrySubmit(AudioFrame frame);
}
