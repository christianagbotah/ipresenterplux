using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class StreamPublishingMediaOutputService(
    IMediaOutputService inner,
    IMasterStreamPublisher streamPublisher) : IMediaOutputService, IServiceScopedMediaOutput, IStreamPublishingMediaOutput
{
    private readonly IMediaOutputService _inner = inner ?? throw new ArgumentNullException(nameof(inner));

    public IMasterStreamPublisher StreamPublisher { get; } =
        streamPublisher ?? throw new ArgumentNullException(nameof(streamPublisher));

    public Task StartProgramOutputAsync(CancellationToken cancellationToken) =>
        _inner.StartProgramOutputAsync(cancellationToken);

    public Task StopProgramOutputAsync(CancellationToken cancellationToken) =>
        _inner.StopProgramOutputAsync(cancellationToken);

    public Task SetPreviewAsync(PresentationRenderItem item, CancellationToken cancellationToken) =>
        _inner.SetPreviewAsync(item, cancellationToken);

    public Task TakePreviewToProgramAsync(CancellationToken cancellationToken) =>
        _inner.TakePreviewToProgramAsync(cancellationToken);

    public Task ClearProgramAsync(CancellationToken cancellationToken) =>
        _inner.ClearProgramAsync(cancellationToken);

    public async Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken)
    {
        await StreamPublisher.HandleActiveServiceAsync(serviceId, cancellationToken).ConfigureAwait(false);
        if (_inner is IServiceScopedMediaOutput scoped)
            await scoped.SetActiveServiceAsync(serviceId, cancellationToken).ConfigureAwait(false);
    }
}
