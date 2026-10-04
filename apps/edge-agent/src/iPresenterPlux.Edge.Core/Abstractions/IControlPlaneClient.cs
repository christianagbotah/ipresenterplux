using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IEdgeEventPublisher
{
    Task PublishHealthAsync(Guid eventId, EdgeDeviceHealth health, CancellationToken cancellationToken);
    Task PublishTranscriptAsync(Guid eventId, TranscriptSegment segment, CancellationToken cancellationToken);
    Task PublishMediaSourceStateAsync(Guid eventId, MediaSourceState state, CancellationToken cancellationToken);
}

public interface IControlPlaneCommandStream
{
    IAsyncEnumerable<ControlCommand> ReceiveCommandsAsync(CancellationToken cancellationToken);
    Task AcknowledgeCommandAsync(ControlCommandResult result, CancellationToken cancellationToken);
}

public interface IControlPlaneClient : IEdgeEventPublisher, IControlPlaneCommandStream
{
}
