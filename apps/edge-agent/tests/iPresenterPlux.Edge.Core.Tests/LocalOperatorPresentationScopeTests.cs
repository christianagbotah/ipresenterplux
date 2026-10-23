using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class LocalOperatorPresentationScopeTests
{
    [Fact]
    public void LocalRehearsalUsesStableNonCloudPresentationScope()
    {
        var first = LocalOperatorPresentationScope.Resolve(null);
        var second = LocalOperatorPresentationScope.Resolve(null);

        Assert.NotEqual(Guid.Empty, first);
        Assert.Equal(first, second);
        Assert.True(LocalOperatorPresentationScope.IsRehearsal(first));
    }

    [Fact]
    public void ActiveCloudServiceRemainsItsOwnPresentationScope()
    {
        var serviceId = Guid.NewGuid();

        var resolved = LocalOperatorPresentationScope.Resolve(serviceId);

        Assert.Equal(serviceId, resolved);
        Assert.False(LocalOperatorPresentationScope.IsRehearsal(resolved));
    }
}
