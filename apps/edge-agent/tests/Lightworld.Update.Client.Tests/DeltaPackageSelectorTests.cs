using Lightworld.Update.Client;
using Xunit;

namespace Lightworld.Update.Client.Tests;

public sealed class DeltaPackageSelectorTests
{
    [Fact]
    public void SelectsExactMatchingDeltaOnlyWhenSmallerThanFullPackage()
    {
        var manifest = Manifest(fullSize: 10_000, [Delta("1.0.0", 2_000), Delta("0.9.0", 1_000)]);

        var selected = DeltaPackageSelector.Select("1.0.0", manifest);

        Assert.NotNull(selected);
        Assert.Equal("1.0.0", selected.FromVersion);
        Assert.Equal(2_000, selected.Size);
    }

    [Fact]
    public void FallsBackToFullWhenMatchingDeltaIsNotSmaller()
    {
        var manifest = Manifest(fullSize: 2_000, [Delta("1.0.0", 2_000)]);

        Assert.Null(DeltaPackageSelector.Select("1.0.0", manifest));
    }

    [Fact]
    public void FallsBackToFullWhenNoExactFromVersionExists()
    {
        var manifest = Manifest(fullSize: 10_000, [Delta("0.9.0", 1_000)]);

        Assert.Null(DeltaPackageSelector.Select("1.0.0", manifest));
    }

    private static ReleaseManifestV1 Manifest(long fullSize, IReadOnlyList<DeltaPackageManifest> deltas) => new(
        1,
        "ipresenterplux",
        "1.1.0",
        "beta",
        "windows",
        "x64",
        null,
        DateTimeOffset.UtcNow,
        "test",
        new FullPackageManifest("https://updates.example.test/full.zip", fullSize, new string('a', 64)),
        deltas,
        100);

    private static DeltaPackageManifest Delta(string fromVersion, long size) => new(
        fromVersion,
        $"https://updates.example.test/{fromVersion}.delta.zip",
        size,
        new string('b', 64));
}
