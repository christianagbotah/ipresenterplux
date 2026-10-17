using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class VisualSourceIdentityTests
{
    [Fact]
    public void SamePlatformKindAndNativeKeyProduceStableId()
    {
        var first = VisualSourceIdentity.Create("windows", VisualSourceKind.Camera, @"\\?\usb#vid_1234&pid_5678#abc");
        var second = VisualSourceIdentity.Create("windows", VisualSourceKind.Camera, @"\\?\usb#vid_1234&pid_5678#abc");

        Assert.Equal(first, second);
        Assert.StartsWith("visual:camera:", first, StringComparison.Ordinal);
        Assert.Matches("^visual:camera:[0-9a-f]{32}$", first);
    }

    [Fact]
    public void DifferentKindOrNativeKeyProducesDifferentId()
    {
        var camera = VisualSourceIdentity.Create("windows", VisualSourceKind.Camera, "native-a");
        var display = VisualSourceIdentity.Create("windows", VisualSourceKind.Display, "native-a");
        var otherCamera = VisualSourceIdentity.Create("windows", VisualSourceKind.Camera, "native-b");

        Assert.NotEqual(camera, display);
        Assert.NotEqual(camera, otherCamera);
    }

    [Fact]
    public void SourceIdNeverLeaksRawNativeKey()
    {
        const string nativeKey = @"C:\Users\Pastor\Secret\capture-device-title";

        var sourceId = VisualSourceIdentity.Create("windows", VisualSourceKind.Window, nativeKey);

        Assert.DoesNotContain("users", sourceId, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secret", sourceId, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("capture-device-title", sourceId, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(sourceId, sourceId.ToLowerInvariant());
        Assert.True(sourceId.Length <= 64);
    }
}
