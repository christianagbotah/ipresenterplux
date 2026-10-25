using iPresenterPlux.Edge.Desktop;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class OperatorWorkspaceLayoutTests
{
    [Fact]
    public void PresetsOfferDistinctOperatorShapes()
    {
        var shapes = new[]
        {
            OperatorWorkspaceLayouts.ProductionShape,
            OperatorWorkspaceLayouts.ScriptureShape,
            OperatorWorkspaceLayouts.MediaShape,
            OperatorWorkspaceLayouts.StreamingShape
        };
        Assert.All(shapes, shape =>
        {
            Assert.True(shape.ScheduleColumn > 0);
            Assert.True(shape.PreviewColumn > 0);
            Assert.True(shape.ProgramColumn > 0);
            Assert.True(shape.ProductionRow > 0);
            Assert.True(shape.ResourceRow > 0);
        });
        Assert.Equal(4, shapes.Distinct().Count());

        // Scripture preset favors the schedule column; streaming favors the monitors.
        Assert.True(OperatorWorkspaceLayouts.ScriptureShape.ScheduleColumn >
                    OperatorWorkspaceLayouts.ProductionShape.ScheduleColumn);
        Assert.True(OperatorWorkspaceLayouts.StreamingShape.ProductionRow >
                    OperatorWorkspaceLayouts.ProductionShape.ProductionRow);
        // Media preset favors the resource deck.
        Assert.True(OperatorWorkspaceLayouts.MediaShape.ResourceRow >
                    OperatorWorkspaceLayouts.ProductionShape.ResourceRow);
    }

    [Theory]
    [InlineData("production", "Production")]
    [InlineData("scripture", "Scripture")]
    [InlineData("media", "Media")]
    [InlineData("streaming", "Streaming")]
    [InlineData("unknown", "Production")]
    [InlineData("", "Production")]
    public void PresetLabelsFallBackToProduction(string preset, string expected)
    {
        Assert.Equal(expected, OperatorWorkspaceLayouts.PresetLabel(preset));
    }

    [Theory]
    [InlineData("production", true)]
    [InlineData("scripture", true)]
    [InlineData("media", true)]
    [InlineData("streaming", true)]
    [InlineData("cockpit-supreme", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void PresetValidationAcceptsOnlyKnownPresets(string? preset, bool expected)
    {
        Assert.Equal(expected, OperatorWorkspaceLayouts.IsValidPreset(preset));
    }

    [Fact]
    public void ActualBoundsNormalizeIntoStableStarRatios()
    {
        var shape = OperatorWorkspaceLayouts.FromActualBounds(240, 380, 380, 560, 406);

        // 240/380/380 px on a 1000px row renormalizes to the 3-star column total.
        Assert.Equal(3.0, shape.ScheduleColumn + shape.PreviewColumn + shape.ProgramColumn, 3);
        Assert.True(shape.PreviewColumn > shape.ScheduleColumn);

        // 560/406 px on the workspace rows renormalizes to the 2.38-star row total.
        Assert.Equal(2.38, Math.Round(shape.ProductionRow + shape.ResourceRow, 3), 3);
    }

    [Fact]
    public void ActualBoundsClampExtremeGeometryIntoSafeRanges()
    {
        var shape = OperatorWorkspaceLayouts.FromActualBounds(1, 1, 4000, 1, 4000);
        Assert.True(shape.ScheduleColumn >= 0.2 && shape.ScheduleColumn <= 4.0);
        Assert.True(shape.PreviewColumn >= 0.2 && shape.PreviewColumn <= 4.0);
        Assert.True(shape.ProgramColumn >= 0.2 && shape.ProgramColumn <= 4.0);
        Assert.True(shape.ProductionRow >= 0.2 && shape.ProductionRow <= 4.0);
        Assert.True(shape.ResourceRow >= 0.2 && shape.ResourceRow <= 4.0);
    }

    [Fact]
    public async Task WorkspaceLayoutPersistsAcrossSettingsRoundTrips()
    {
        var directory = Path.Combine(
            Path.GetTempPath(), "ipresenterplux-desktop-settings-tests", Guid.NewGuid().ToString("N"));
        try
        {
            var store = new DesktopSettingsStore(directory);
            var settings = new DesktopSettings("https://control.example.test", "Sanctuary Edge") with
            {
                OperatorScheduleColumn = 1.1,
                OperatorPreviewColumn = 0.95,
                OperatorProgramColumn = 0.95,
                OperatorProductionRow = 1.9,
                OperatorResourceRow = 0.48,
                OperatorScheduleCollapsed = true,
                OperatorResourceDeckCollapsed = false,
                OperatorLayoutPreset = "scripture"
            };

            await store.SaveAsync(settings, CancellationToken.None);
            var loaded = await store.LoadAsync(CancellationToken.None);

            Assert.Equal(1.1, loaded.OperatorScheduleColumn);
            Assert.Equal(0.95, loaded.OperatorPreviewColumn);
            Assert.Equal(0.95, loaded.OperatorProgramColumn);
            Assert.Equal(1.9, loaded.OperatorProductionRow);
            Assert.Equal(0.48, loaded.OperatorResourceRow);
            Assert.True(loaded.OperatorScheduleCollapsed);
            Assert.False(loaded.OperatorResourceDeckCollapsed);
            Assert.Equal("scripture", loaded.OperatorLayoutPreset);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task LegacySettingsLoadWithDefaultWorkspaceLayout()
    {
        var directory = Path.Combine(
            Path.GetTempPath(), "ipresenterplux-desktop-settings-tests", Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(directory);
            var store = new DesktopSettingsStore(directory);
            await File.WriteAllTextAsync(store.SettingsPath,
                """
                {
                  "controlPlaneUrl": "https://control.example.test",
                  "deviceName": "Legacy Sanctuary Edge",
                  "programPort": 49321,
                  "installationId": "0123456789abcdef0123456789abcdef"
                }
                """);

            var loaded = await store.LoadAsync(CancellationToken.None);

            Assert.Null(loaded.OperatorScheduleColumn);
            Assert.Null(loaded.OperatorPreviewColumn);
            Assert.Null(loaded.OperatorProgramColumn);
            Assert.Null(loaded.OperatorProductionRow);
            Assert.Null(loaded.OperatorResourceRow);
            Assert.False(loaded.OperatorScheduleCollapsed);
            Assert.False(loaded.OperatorResourceDeckCollapsed);
            Assert.Equal("production", loaded.OperatorLayoutPreset);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void InvalidPresetAndStarValuesNormalizeSafely()
    {
        var settings = new DesktopSettings("https://control.example.test", "Sanctuary Edge") with
        {
            OperatorLayoutPreset = "cockpit-supreme",
            OperatorScheduleColumn = -5,
            OperatorPreviewColumn = 99
        };
        var normalized = settings.Normalize();
        Assert.Equal("production", normalized.OperatorLayoutPreset);
        Assert.Equal(0.2, normalized.OperatorScheduleColumn);
        Assert.Equal(4.0, normalized.OperatorPreviewColumn);
    }
}
