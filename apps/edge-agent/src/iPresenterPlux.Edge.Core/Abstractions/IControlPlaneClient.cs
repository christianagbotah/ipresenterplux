using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IControlPlaneClient
{
    Task PublishHealthAsync(EdgeDeviceHealth health, CancellationToken cancellationToken);
    Task PublishTranscriptAsync(TranscriptSegment segment, CancellationToken cancellationToken);
    Task PublishMediaSourceStateAsync(MediaSourceState state, CancellationToken cancellationToken);
    IAsyncEnumerable<ControlCommand> ReceiveCommandsAsync(CancellationToken cancellationToken);
    Task AcknowledgeCommandAsync(ControlCommandResult result, CancellationToken cancellationToken);
}
