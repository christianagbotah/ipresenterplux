using System.Text.Json;
using System.Text.RegularExpressions;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed record PresentationThemeBackground(string Kind, string Value);
public sealed record PresentationThemeLowerThird(string Mode, string Position);
public sealed record PresentationThemeLogo(string? MediaId, string Position, double SizePercent);
public sealed record PresentationThemeAppearance(
    int Version,
    PresentationThemeBackground Background,
    string PrimaryTextColor,
    string SecondaryTextColor,
    string FontFamily,
    double TitleSizeScale,
    double BodySizeScale,
    double FooterSizeScale,
    string HorizontalAlignment,
    string VerticalAlignment,
    bool Shadow,
    double BackingOpacity,
    double SafeAreaPercent,
    string Animation,
    PresentationThemeLowerThird LowerThird,
    PresentationThemeLogo Logo);

public static partial class PresentationThemeMetadata
{
    public const string MetadataKey = "themeAppearanceV1";
    private const int MaximumPayloadLength = 8192;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly HashSet<string> GradientTokens = new(StringComparer.Ordinal) { "midnight", "violet_pink", "navy_teal", "ivory_rose" };
    private static readonly HashSet<string> Fonts = new(StringComparer.Ordinal) { "Inter", "Arial", "Verdana", "Trebuchet MS", "Georgia", "Times New Roman", "Noto Sans", "Noto Serif" };
    private static readonly HashSet<string> Horizontal = new(StringComparer.Ordinal) { "left", "center", "right" };
    private static readonly HashSet<string> Vertical = new(StringComparer.Ordinal) { "top", "center", "bottom" };
    private static readonly HashSet<string> Animations = new(StringComparer.Ordinal) { "instant", "fade", "slide", "zoom" };
    private static readonly HashSet<string> LowerThirdModes = new(StringComparer.Ordinal) { "off", "auto", "always" };
    private static readonly HashSet<string> LowerThirdPositions = new(StringComparer.Ordinal) { "bottom_left", "bottom_center", "bottom_right" };
    private static readonly HashSet<string> LogoPositions = new(StringComparer.Ordinal) { "top_left", "top_right", "bottom_left", "bottom_right" };

    public static PresentationThemeAppearance Default { get; } = new(
        1,
        new("gradient", "midnight"),
        "#ffffff",
        "#e5b95e",
        "Inter",
        1,
        1,
        1,
        "center",
        "center",
        true,
        0.18,
        6,
        "fade",
        new("auto", "bottom_left"),
        new(null, "top_right", 8));

    public static PresentationThemeAppearance Resolve(IReadOnlyDictionary<string, string>? metadata)
    {
        if (metadata is null || !metadata.TryGetValue(MetadataKey, out var raw) ||
            string.IsNullOrWhiteSpace(raw) || raw.Length > MaximumPayloadLength)
            return Default;

        try
        {
            var parsed = JsonSerializer.Deserialize<PresentationThemeAppearance>(raw, JsonOptions);
            return IsValid(parsed) ? parsed! : Default;
        }
        catch (JsonException)
        {
            return Default;
        }
    }

    private static bool IsValid(PresentationThemeAppearance? theme)
    {
        if (theme is null || theme.Version != 1 || theme.Background is null || theme.LowerThird is null || theme.Logo is null)
            return false;
        if (!ValidBackground(theme.Background) || !HexColor().IsMatch(theme.PrimaryTextColor ?? string.Empty) || !HexColor().IsMatch(theme.SecondaryTextColor ?? string.Empty))
            return false;
        if (!Fonts.Contains(theme.FontFamily ?? string.Empty) || !Horizontal.Contains(theme.HorizontalAlignment ?? string.Empty) || !Vertical.Contains(theme.VerticalAlignment ?? string.Empty))
            return false;
        if (!Animations.Contains(theme.Animation ?? string.Empty) || !LowerThirdModes.Contains(theme.LowerThird.Mode ?? string.Empty) || !LowerThirdPositions.Contains(theme.LowerThird.Position ?? string.Empty))
            return false;
        if (!LogoPositions.Contains(theme.Logo.Position ?? string.Empty) || (theme.Logo.MediaId is not null && !Guid.TryParse(theme.Logo.MediaId, out _)))
            return false;
        return InRange(theme.TitleSizeScale, 0.5, 2.5)
            && InRange(theme.BodySizeScale, 0.5, 2.25)
            && InRange(theme.FooterSizeScale, 0.5, 1.75)
            && InRange(theme.BackingOpacity, 0, 1)
            && InRange(theme.SafeAreaPercent, 0, 15)
            && InRange(theme.Logo.SizePercent, 1, 30);
    }

    private static bool ValidBackground(PresentationThemeBackground background) => background.Kind switch
    {
        "solid" => HexColor().IsMatch(background.Value ?? string.Empty),
        "gradient" => GradientTokens.Contains(background.Value ?? string.Empty),
        "image" => Guid.TryParse(background.Value, out _),
        _ => false
    };

    private static bool InRange(double value, double min, double max) => double.IsFinite(value) && value >= min && value <= max;

    [GeneratedRegex("^#[0-9a-f]{6}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HexColor();
}
