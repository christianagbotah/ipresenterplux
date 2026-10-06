using iPresenterPlux.Edge.Desktop;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class LocalOutputLinkPolicyTests
{
    [Theory]
    [InlineData(EdgeDesktopRuntimeState.Stopped, false, false)]
    [InlineData(EdgeDesktopRuntimeState.Starting, false, false)]
    [InlineData(EdgeDesktopRuntimeState.Active, true, true)]
    [InlineData(EdgeDesktopRuntimeState.Degraded, true, true)]
    [InlineData(EdgeDesktopRuntimeState.Stopping, true, false)]
    [InlineData(EdgeDesktopRuntimeState.Active, false, false)]
    public void LinkIsAvailableOnlyWhenTheRendererIsHealthyAndRuntimeIsUsable(
        EdgeDesktopRuntimeState state,
        bool localProgramHealthy,
        bool expected)
    {
        var snapshot = new EdgeDesktopSnapshot(
            state,
            state is EdgeDesktopRuntimeState.Active or EdgeDesktopRuntimeState.Degraded or EdgeDesktopRuntimeState.Stopping ? 4242 : null,
            null,
            state == EdgeDesktopRuntimeState.Active,
            localProgramHealthy,
            null,
            DateTimeOffset.UtcNow);

        Assert.Equal(expected, LocalOutputLinkPolicy.CanOpen(snapshot));
    }
}
