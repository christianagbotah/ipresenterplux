namespace iPresenterPlux.Edge.Desktop;

/// <summary>
/// Named operator workspace presets. Splitters remain fully adjustable at
/// runtime; presets are one-click starting points and the operator's manual
/// adjustments are persisted across launches via DesktopSettings.
/// </summary>
public static class OperatorWorkspaceLayouts
{
    public const string Production = "production";
    public const string Scripture = "scripture";
    public const string Media = "media";
    public const string Streaming = "streaming";

    public sealed record LayoutShape(
        double ScheduleColumn,
        double PreviewColumn,
        double ProgramColumn,
        double ProductionRow,
        double ResourceRow);

    public static readonly LayoutShape ProductionShape = new(0.72, 1.14, 1.14, 1.38, 1.0);
    public static readonly LayoutShape ScriptureShape = new(0.95, 1.35, 0.70, 1.55, 0.80);
    public static readonly LayoutShape MediaShape = new(0.60, 1.20, 1.20, 0.90, 1.50);
    public static readonly LayoutShape StreamingShape = new(0.55, 1.225, 1.225, 1.70, 0.68);

    public static readonly IReadOnlyList<string> PresetNames =
        new[] { Production, Scripture, Media, Streaming };

    public static string PresetLabel(string preset) => preset switch
    {
        Scripture => "Scripture",
        Media => "Media",
        Streaming => "Streaming",
        _ => "Production"
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
        double scheduleWidth,
        double previewWidth,
        double programWidth,
        double productionHeight,
        double resourceHeight)
    {
        const double columnTotal = 3.0;
        const double rowTotal = 2.38;

        var columnSum = Math.Max(scheduleWidth + previewWidth + programWidth, 1);
        var rowSum = Math.Max(productionHeight + resourceHeight, 1);

        return new LayoutShape(
            ClampStar(scheduleWidth / columnSum * columnTotal),
            ClampStar(previewWidth / columnSum * columnTotal),
            ClampStar(programWidth / columnSum * columnTotal),
            ClampStar(productionHeight / rowSum * rowTotal),
            ClampStar(resourceHeight / rowSum * rowTotal));
    }

    private static double ClampStar(double value) => Math.Clamp(Math.Round(value, 4), 0.2, 4.0);
}
