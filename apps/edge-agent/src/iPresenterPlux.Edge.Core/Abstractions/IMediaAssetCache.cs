using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IMediaAssetCache
{
    Task<MediaAssetCacheEntry> PrepareAsync(Guid organizationId, PresentationMediaDescriptor descriptor, CancellationToken cancellationToken);
    bool TryGetReady(string cacheKey, out MediaAssetCacheEntry entry);
    IDisposable AcquireLease(string cacheKey);
}
