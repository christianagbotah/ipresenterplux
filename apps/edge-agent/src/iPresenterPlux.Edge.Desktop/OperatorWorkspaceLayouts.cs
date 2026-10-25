namespace iPresenterPlux.Edge.Desktop;

/// <summary>
/// Named operator workspace presets for the Studio Shell. Splitters remain
/// fully adjustable at runtime; presets are one-click starting points and the
/// operator's manual adjustments are persisted across launches via
/// DesktopSettings. Geometry: a 52px icon rail, a resizable library sidebar,
/// the PREVIEW | PROGRAM stage row (splitter + TAKE on the seam), and the
/// playout deck row below the stage.
/// </summary>
public static class OperatorWorkspaceLayouts
{
    public const string Production = "production";
    public const string Scripture = "scripture";
    public const string Media = "media";
    public const string Streaming = "streaming";

    public sealed record LayoutShape(
        double SidebarColumn,
        double PreviewColumn,
        double ProgramColumn,
        double StageRow,
        double DeckRow);

    // Studio default: ~402px sidebar at 1920, stage row 60/40 (PGM|PST seam),
    // deck slightly taller than the stage so the playout surfaces dominate.
    public static readonly LayoutShape ProductionShape = new(1.0, 2.15, 1.45, 1.0, 1.32);
    public static readonly LayoutShape ScriptureShape = new(1.25, 1.85, 0.95, 1.25, 1.05);
    public static readonly LayoutShape MediaShape = new(0.70, 1.45, 1.45, 1.15, 1.15);
    public static readonly LayoutShape StreamingShape = new(0.70, 1.35, 1.35, 1.55, 0.75);

    public static readonly IReadOnlyList<string> PresetNames =
        new[] { Production, Scripture, Media, Streaming };

    public static string PresetLabel(string preset) => preset switch
    {
        Scripture => "Scripture",
        Media => "Media",
        Streaming => "Streaming",
        _ => "Studio"
    };

    public static bool IsValidPreset(string? preset) =>
        preset is not null && PresetNames.Contains(preset, StringComparer.Ordinal);

    public static LayoutShape Shape(string preset) => preset switch
    {
        Scripture => ScriptureShape,
        Media => MediaShape,
        Streaming => StreamingShape,
        _ => ProductionShape
    };

    /// <summary>
    /// Converts actual rendered pane widths/heights back into star ratios so a
    /// saved layout survives window size changes. Ratios are normalized against
    /// the default star totals, keeping splitter semantics stable.
    /// </summary>
    public static LayoutShape FromActualBounds(
        double sidebarWidth,
        double previewWidth,
        double programWidth,
        double stageHeight,
        double deckHeight)
    {
        const double columnTotal = 4.6;
        const double rowTotal = 2.32;

        var columnSum = Math.Max(sidebarWidth + previewWidth + programWidth, 1);
        var rowSum = Math.Max(stageHeight + deckHeight, 1);

        return new LayoutShape(
            ClampStar(sidebarWidth / columnSum * columnTotal),
            ClampStar(previewWidth / columnSum * columnTotal),
            ClampStar(programWidth / columnSum * columnTotal),
            ClampStar(stageHeight / rowSum * rowTotal),
            ClampStar(deckHeight / rowSum * rowTotal));
    }

    private static double ClampStar(double value) => Math.Clamp(Math.Round(value, 4), 0.2, 4.0);
}
