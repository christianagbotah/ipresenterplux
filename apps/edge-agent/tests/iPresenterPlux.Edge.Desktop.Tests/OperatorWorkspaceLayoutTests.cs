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
            Assert.True(shape.SidebarColumn > 0);
            Assert.True(shape.PreviewColumn > 0);
            Assert.True(shape.ProgramColumn > 0);
            Assert.True(shape.StageRow > 0);
            Assert.True(shape.DeckRow > 0);
        });
        Assert.Equal(4, shapes.Distinct().Count());

        // Scripture preset favors the library sidebar; streaming favors a tall stage.
        Assert.True(OperatorWorkspaceLayouts.ScriptureShape.SidebarColumn >
                    OperatorWorkspaceLayouts.ProductionShape.SidebarColumn);
        Assert.True(OperatorWorkspaceLayouts.StreamingShape.StageRow >
                    OperatorWorkspaceLayouts.ProductionShape.StageRow);
        // Studio default: the stage row is 60/40-ish (preview wider than program)
        // and the playout deck is taller than the stage.
        Assert.True(OperatorWorkspaceLayouts.ProductionShape.PreviewColumn >
                    OperatorWorkspaceLayouts.ProductionShape.ProgramColumn);
        Assert.True(OperatorWorkspaceLayouts.ProductionShape.DeckRow >
                    OperatorWorkspaceLayouts.ProductionShape.StageRow);
        // Media preset keeps both monitors perfectly balanced.
        Assert.Equal(OperatorWorkspaceLayouts.MediaShape.PreviewColumn,
            OperatorWorkspaceLayouts.MediaShape.ProgramColumn);
    }

    [Theory]
    [InlineData("production", "Studio")]
    [InlineData("scripture", "Scripture")]
    [InlineData("media", "Media")]
    [InlineData("streaming", "Streaming")]
    [InlineData("unknown", "Studio")]
    [InlineData("", "Studio")]
    public void PresetLabelsFallBackToStudio(string preset, string expected)
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
        var shape = OperatorWorkspaceLayouts.FromActualBounds(400, 880, 590, 430, 566);

        // 400/880/590 px renormalizes to the 4.6-star column total (rail excluded).
        Assert.Equal(4.6, shape.SidebarColumn + shape.PreviewColumn + shape.ProgramColumn, 3);
        Assert.True(shape.PreviewColumn > shape.SidebarColumn);
        Assert.True(shape.PreviewColumn > shape.ProgramColumn);

        // 430/566 px on the body rows renormalizes to the 2.32-star row total.
        Assert.Equal(2.32, Math.Round(shape.StageRow + shape.DeckRow, 3), 3);
    }

    [Fact]
    public void ActualBoundsClampExtremeGeometryIntoSafeRanges()
    {
        var shape = OperatorWorkspaceLayouts.FromActualBounds(1, 1, 4000, 1, 4000);
        Assert.True(shape.SidebarColumn >= 0.2 && shape.SidebarColumn <= 4.0);
        Assert.True(shape.PreviewColumn >= 0.2 && shape.PreviewColumn <= 4.0);
        Assert.True(shape.ProgramColumn >= 0.2 && shape.ProgramColumn <= 4.0);
        Assert.True(shape.StageRow >= 0.2 && shape.StageRow <= 4.0);
        Assert.True(shape.DeckRow >= 0.2 && shape.DeckRow <= 4.0);
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
                OperatorSidebarColumn = 1.0,
                OperatorPreviewColumn = 2.15,
                OperatorProgramColumn = 1.45,
                OperatorStageRow = 1.0,
                OperatorDeckRow = 1.32,
                OperatorSidebarCollapsed = true,
                OperatorResourceDeckCollapsed = false,
                OperatorLayoutPreset = "scripture",
                OperatorDeckLeftColumn = 0.8,
                OperatorDeckRightColumn = 1.2,
                OperatorSidebarMode = "scripture"
            };

            await store.SaveAsync(settings, CancellationToken.None);
            var loaded = await store.LoadAsync(CancellationToken.None);

            Assert.Equal(1.0, loaded.OperatorSidebarColumn);
            Assert.Equal(2.15, loaded.OperatorPreviewColumn);
            Assert.Equal(1.45, loaded.OperatorProgramColumn);
            Assert.Equal(1.0, loaded.OperatorStageRow);
            Assert.Equal(1.32, loaded.OperatorDeckRow);
            Assert.True(loaded.OperatorSidebarCollapsed);
            Assert.False(loaded.OperatorResourceDeckCollapsed);
            Assert.Equal("scripture", loaded.OperatorLayoutPreset);
            Assert.Equal(0.8, loaded.OperatorDeckLeftColumn);
            Assert.Equal(1.2, loaded.OperatorDeckRightColumn);
            Assert.Equal("scripture", loaded.OperatorSidebarMode);
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

            Assert.Null(loaded.OperatorSidebarColumn);
            Assert.Null(loaded.OperatorPreviewColumn);
            Assert.Null(loaded.OperatorProgramColumn);
            Assert.Null(loaded.OperatorStageRow);
            Assert.Null(loaded.OperatorDeckRow);
            Assert.False(loaded.OperatorSidebarCollapsed);
            Assert.False(loaded.OperatorResourceDeckCollapsed);
            Assert.Equal("production", loaded.OperatorLayoutPreset);
            // v2.2 additions default safely for pre-v2.2 settings files.
            Assert.Null(loaded.OperatorDeckLeftColumn);
            Assert.Null(loaded.OperatorDeckRightColumn);
            Assert.Equal("schedule", loaded.OperatorSidebarMode);
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
            OperatorSidebarColumn = -5,
            OperatorPreviewColumn = 99
        };
        var normalized = settings.Normalize();
        Assert.Equal("production", normalized.OperatorLayoutPreset);
        Assert.Equal(0.2, normalized.OperatorSidebarColumn);
        Assert.Equal(4.0, normalized.OperatorPreviewColumn);
    }

    [Fact]
    public void InvalidSidebarModeAndDeckColumnsNormalizeSafely()
    {
        var settings = new DesktopSettings("https://control.example.test", "Sanctuary Edge") with
        {
            OperatorSidebarMode = "hologram",
            OperatorDeckLeftColumn = -3,
            OperatorDeckRightColumn = 500
        };
        var normalized = settings.Normalize();

        Assert.Equal("schedule", normalized.OperatorSidebarMode);
        Assert.Equal(0.2, normalized.OperatorDeckLeftColumn);
        Assert.Equal(4.0, normalized.OperatorDeckRightColumn);
    }

    [Fact]
    public void EveryPresetShapeCarriesUsableDeckColumnRatios()
    {
        foreach (var preset in OperatorWorkspaceLayouts.PresetNames)
        {
            var shape = OperatorWorkspaceLayouts.Shape(preset);
            Assert.InRange(shape.DeckLeftColumn, 0.2, 4.0);
            Assert.InRange(shape.DeckRightColumn, 0.2, 4.0);
            Assert.InRange(shape.SidebarColumn, 0.2, 4.0);
            Assert.InRange(shape.PreviewColumn, 0.2, 4.0);
            Assert.InRange(shape.ProgramColumn, 0.2, 4.0);
            Assert.InRange(shape.StageRow, 0.2, 4.0);
            Assert.InRange(shape.DeckRow, 0.2, 4.0);
        }
    }

    [Fact]
    public void PresetsSelectTheirSidebarModeWithinTheSameWorkspace()
    {
        Assert.Equal("schedule", OperatorWorkspaceLayouts.SidebarModeForPreset(OperatorWorkspaceLayouts.Production));
        Assert.Equal("scripture", OperatorWorkspaceLayouts.SidebarModeForPreset(OperatorWorkspaceLayouts.Scripture));
        Assert.Equal("media", OperatorWorkspaceLayouts.SidebarModeForPreset(OperatorWorkspaceLayouts.Media));
        Assert.Equal("schedule", OperatorWorkspaceLayouts.SidebarModeForPreset(OperatorWorkspaceLayouts.Streaming));
        Assert.True(OperatorWorkspaceLayouts.IsValidSidebarMode("media"));
        Assert.False(OperatorWorkspaceLayouts.IsValidSidebarMode("tournament"));
    }

    [Fact]
    public void DeckColumnRatiosFromActualBoundsStayClamped()
    {
        var (left, right) = OperatorWorkspaceLayouts.DeckColumnsFromActualBounds(120, 680);
        Assert.InRange(left, 0.2, 4.0);
        Assert.InRange(right, 0.2, 4.0);
        // The ratios are normalized against the 1.02/0.98 default total (2.0).
        Assert.True(left < right);

        var (extremeLeft, extremeRight) = OperatorWorkspaceLayouts.DeckColumnsFromActualBounds(1, 10000);
        Assert.Equal(0.2, extremeLeft);
        Assert.InRange(extremeRight, 1.9, 4.0);
    }
}
