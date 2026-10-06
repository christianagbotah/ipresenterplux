using iPresenterPlux.Edge.Core.Abstractions;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class OperatorCatalogCoordinator
{
    private readonly OperatorCatalogStore _store;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IOperatorCatalogClient? _client;
    private Guid? _activeServiceId;

    public OperatorCatalogCoordinator(OperatorCatalogStore store, IOperatorCatalogClient? client = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _client = client;
    }

    public void BindClient(IOperatorCatalogClient client) =>
        _client = client ?? throw new ArgumentNullException(nameof(client));

    public async Task SetActiveServiceAsync(Guid? activeServiceId, CancellationToken cancellationToken)
    {
        if (activeServiceId == Guid.Empty) activeServiceId = null;
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            _activeServiceId = activeServiceId;
            await _store.ClearServiceAsync(activeServiceId, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RefreshAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var client = _client ?? throw new InvalidOperationException("The operator catalog client is not bound.");
            var expectedServiceId = _activeServiceId;
            var snapshot = await client.GetCatalogAsync(cancellationToken).ConfigureAwait(false);
            var returnedServiceId = snapshot.Service?.ServiceId;
            if (returnedServiceId != expectedServiceId)
                throw new InvalidDataException("The operator catalog service scope did not match the active Edge service.");
            await _store.WriteAsync(snapshot, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task<OperatorCatalogSnapshot?> QueryAsync(CancellationToken cancellationToken) =>
        _store.ReadAsync(cancellationToken);

    public Guid? ActiveServiceId => _activeServiceId;
}
