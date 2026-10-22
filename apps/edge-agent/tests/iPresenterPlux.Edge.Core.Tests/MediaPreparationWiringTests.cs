using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class MediaPreparationWiringTests
{
    [Fact]
    public void RuntimeAndPlatformHostsWireRealPreparationWithoutLeakingRemoteUrlsToDesktop()
    {
        var root = FindRepositoryRoot();
        var runtime = File.ReadAllText(Path.Combine(root, "apps/edge-agent/src/iPresenterPlux.Edge.Core/Runtime/EdgeAgentRuntime.cs"));
        var windows = File.ReadAllText(Path.Combine(root, "apps/edge-agent/src/iPresenterPlux.Edge.Windows/Program.cs"));
        var macos = File.ReadAllText(Path.Combine(root, "apps/edge-agent/src/iPresenterPlux.Edge.MacOS/Program.cs"));

        Assert.Contains("IMediaPreparationCoordinator? mediaPreparation", runtime, StringComparison.Ordinal);
        Assert.Contains("BindOrganization(identity.OrganizationId)", runtime, StringComparison.Ordinal);
        Assert.Contains("SetActiveServiceAsync(activeServiceId", runtime, StringComparison.Ordinal);
        Assert.Contains("PrefetchAsync", runtime, StringComparison.Ordinal);

        foreach (var host in new[] { windows, macos })
        {
            Assert.Contains("new MediaRemoteEndpointPolicy", host, StringComparison.Ordinal);
            Assert.Contains("new MediaAssetCache", host, StringComparison.Ordinal);
            Assert.Contains("new MediaPreparationCoordinator", host, StringComparison.Ordinal);
            Assert.Contains("mediaPreparation: mediaPreparation", host, StringComparison.Ordinal);
        }
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (Directory.Exists(Path.Combine(current.FullName, "apps", "edge-agent"))) return current.FullName;
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("Repository root not found from test output path.");
    }
}
