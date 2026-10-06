using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed record ContributionAudioBufferStatus(
    bool IsEnabled,
    Guid? ServiceId,
    long AcceptedFrames,
    long DroppedFrames);

public interface IContributionAudioSink
{
    bool TrySubmit(AudioFrame frame);
}

public interface IContributionAudioBuffer : IContributionAudioSink
{
    ContributionAudioBufferStatus Status { get; }

    void Enable(Guid serviceId);

    void Disable();

    IAsyncEnumerable<AudioFrame> ReadAllAsync(CancellationToken cancellationToken);
}
