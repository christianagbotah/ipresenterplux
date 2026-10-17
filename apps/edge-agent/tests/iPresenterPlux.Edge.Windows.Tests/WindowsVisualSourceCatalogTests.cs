using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Windows;
using Xunit;

namespace iPresenterPlux.Edge.Windows.Tests;

public sealed class WindowsVisualSourceCatalogTests
{
    private static readonly DateTimeOffset ObservedAt = DateTimeOffset.Parse("2026-10-17T12:30:00Z");

    [Fact]
    public async Task DuplicateNativeRecordsCollapseByStableSourceId()
    {
        var cameras = new WindowsCameraSourceCatalog(
            () =>
            [
                new WindowsNativeCamera("camera-symbolic-link-a", "USB Camera"),
                new WindowsNativeCamera("camera-symbolic-link-a", "USB Camera duplicate")
            ],
            new FixedTimeProvider(ObservedAt));
        var graphics = EmptyGraphics();
        var catalog = new WindowsVisualSourceCatalog(cameras, graphics);

        var sources = await catalog.ScanAsync(CancellationToken.None);

        var camera = Assert.Single(sources);
        Assert.Equal(VisualSourceKind.Camera, camera.Kind);
        Assert.Equal("USB Camera", camera.Name);
        Assert.Equal(VisualSourceIdentity.Create("windows", VisualSourceKind.Camera, "camera-symbolic-link-a"), camera.SourceId);
    }

    [Fact]
    public async Task DisplayOrderChangesDoNotChangeSourceIdentity()
    {
        var firstRecords = new[]
        {
            Display((nint)10, @"\\.\DISPLAY1", @"MONITOR\DEL40A9\{abc}", 1920, 1080, true),
            Display((nint)20, @"\\.\DISPLAY2", @"MONITOR\SAM1234\{def}", 2560, 1440, false)
        };
        var secondRecords = firstRecords.Reverse().ToArray();
        var clock = new FixedTimeProvider(ObservedAt);

        var first = await new WindowsGraphicsSourceCatalog(() => firstRecords, () => [], clock).ScanAsync(CancellationToken.None);
        var second = await new WindowsGraphicsSourceCatalog(() => secondRecords, () => [], clock).ScanAsync(CancellationToken.None);

        Assert.Equal(first.Select(source => source.SourceId).Order(), second.Select(source => source.SourceId).Order());
        Assert.All(first, source => Assert.Equal(VisualSourceKind.Display, source.Kind));
        Assert.Contains(first, source => source.Metadata.TryGetValue("displayPrimary", out var primary) && primary == "true");
    }

    [Fact]
    public async Task RelaunchedWindowWithNewHwndGetsNewSessionScopedSourceId()
    {
        var clock = new FixedTimeProvider(ObservedAt);
        var oldWindow = Window((nint)0x100, 4100, "POWERPNT", @"c:\program files\microsoft office\powerpnt.exe");
        var newWindow = oldWindow with { Handle = (nint)0x200 };

        var first = await new WindowsGraphicsSourceCatalog(() => [], () => [oldWindow], clock).ScanAsync(CancellationToken.None);
        var second = await new WindowsGraphicsSourceCatalog(() => [], () => [newWindow], clock).ScanAsync(CancellationToken.None);

        Assert.NotEqual(Assert.Single(first).SourceId, Assert.Single(second).SourceId);
    }

    [Fact]
    public async Task IpresenterPluxUtilityWindowsAreExcludedByDefault()
    {
        var windows = new[]
        {
            Window((nint)0x100, 100, "iPresenterPlux.Edge.Desktop", @"c:\apps\ipresenterplux.edge.desktop.exe"),
            Window((nint)0x200, 200, "POWERPNT", @"c:\program files\microsoft office\powerpnt.exe")
        };

        var sources = await new WindowsGraphicsSourceCatalog(() => [], () => windows, new FixedTimeProvider(ObservedAt)).ScanAsync(CancellationToken.None);

        var source = Assert.Single(sources);
        Assert.Equal("POWERPNT", source.Name);
        Assert.Equal(VisualSourceKind.Window, source.Kind);
    }

    [Fact]
    public async Task WindowDescriptorContainsSafeProcessMetadataOnly()
    {
        var native = Window((nint)0x123, 222, "Microsoft Excel", @"c:\program files\microsoft office\excel.exe");

        var source = Assert.Single(await new WindowsGraphicsSourceCatalog(() => [], () => [native], new FixedTimeProvider(ObservedAt)).ScanAsync(CancellationToken.None));

        Assert.Equal("Microsoft Excel", source.Name);
        Assert.Equal("Microsoft Excel", source.Metadata["processName"]);
        Assert.DoesNotContain("path", source.Metadata.Keys, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("title", source.Metadata.Keys, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("excel.exe", string.Join('|', source.Metadata.Values), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("hwnd:123", source.NativeKey, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CombinedCatalogReturnsStableKindThenNameOrdering()
    {
        var clock = new FixedTimeProvider(ObservedAt);
        var cameras = new WindowsCameraSourceCatalog(() => [new WindowsNativeCamera("cam-b", "Z Camera")], clock);
        var graphics = new WindowsGraphicsSourceCatalog(
            () => [Display((nint)2, @"\\.\DISPLAY1", "monitor-a", 1920, 1080, true)],
            () => [Window((nint)3, 333, "PowerPoint", @"c:\office\powerpnt.exe")],
            clock);

        var sources = await new WindowsVisualSourceCatalog(cameras, graphics).ScanAsync(CancellationToken.None);

        Assert.Equal([VisualSourceKind.Camera, VisualSourceKind.Display, VisualSourceKind.Window], sources.Select(source => source.Kind).ToArray());
    }

    private static WindowsGraphicsSourceCatalog EmptyGraphics() =>
        new(() => [], () => [], new FixedTimeProvider(ObservedAt));

    private static WindowsNativeDisplay Display(nint handle, string deviceName, string deviceId, int width, int height, bool primary) =>
        new(handle, deviceName, deviceId, 0, 0, width, height, primary);

    private static WindowsNativeWindow Window(nint handle, int processId, string processName, string executableIdentity) =>
        new(handle, processId, processName, executableIdentity);

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
