namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IServiceScopedMediaOutput
{
    Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken);
}
