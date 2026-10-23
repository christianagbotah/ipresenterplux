using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed record OperatorResolvedScripture(
    Guid ServiceId,
    OperatorCatalogItem Item,
    DateTimeOffset ObservedAt);

public sealed record OperatorResolvedLibraryItem(
    OperatorCatalogItem Item,
    DateTimeOffset ObservedAt);

public interface IOperatorCatalogClient
{
    Task<OperatorCatalogSnapshot> GetCatalogAsync(CancellationToken cancellationToken);

    Task<OperatorResolvedScripture> ResolveScriptureAsync(
        string reference,
        string? version,
        CancellationToken cancellationToken);

    Task<OperatorResolvedLibraryItem> ResolveLibraryItemAsync(
        string itemId,
        CancellationToken cancellationToken) =>
        throw new NotSupportedException("Organization library item resolution is not supported by this client.");
}
