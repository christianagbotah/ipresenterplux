using iPresenterPlux.Edge.Desktop;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class ProgramDisplaySelectionTests
{
    [Fact]
    public void SavedDisplayWinsWhenStillConnected()
    {
        var displays = new[]
        {
            new ProgramDisplayTarget("operator", "Operator", 0, 0, 1920, 1080, true),
            new ProgramDisplayTarget("projector", "Projector", 1920, 0, 1920, 1080, false)
        };

        var resolved = ProgramDisplaySelector.Resolve("projector", displays);

        Assert.Equal("projector", resolved.Target?.Id);
        Assert.False(resolved.UsedFallback);
        Assert.Equal(1920, resolved.Target?.X);
        Assert.Equal(1920, resolved.Target?.Width);
    }

    [Fact]
    public void MissingSavedDisplayFallsBackToPrimary()
    {
        var displays = new[]
        {
            new ProgramDisplayTarget("projector", "Projector", -1920, 0, 1920, 1080, false),
            new ProgramDisplayTarget("operator", "Operator", 0, 0, 2560, 1440, true)
        };

        var resolved = ProgramDisplaySelector.Resolve("old-projector", displays);

        Assert.Equal("operator", resolved.Target?.Id);
        Assert.True(resolved.UsedFallback);
        Assert.Equal(2560, resolved.Target?.Width);
        Assert.Equal(1440, resolved.Target?.Height);
    }

    [Fact]
    public void EmptyDisplayListProducesNoPlacement()
    {
        var resolved = ProgramDisplaySelector.Resolve("projector", Array.Empty<ProgramDisplayTarget>());

        Assert.Null(resolved.Target);
        Assert.True(resolved.UsedFallback);
    }
}
