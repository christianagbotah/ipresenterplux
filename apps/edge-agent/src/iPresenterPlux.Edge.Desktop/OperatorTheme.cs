using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace iPresenterPlux.Edge.Desktop;

/// <summary>
/// iPresenterPlux production-console design tokens and control factories.
/// Dark-first, compact, operator-grade: every value here exists so the desktop
/// shell, dialogs and future windows share one visual language instead of
/// re-deriving brushes and metrics per screen.
/// </summary>
public static class OperatorTheme
{
    // --- Surfaces ---
    public static readonly IBrush WindowBackground = Brush("#04070C");
    public static readonly IBrush Surface = Brush("#090E15");
    public static readonly IBrush SurfaceRaised = Brush("#121A26");
    public static readonly IBrush SurfaceOverlay = Brush("#17202E");
    public static readonly IBrush StageCanvas = Brush("#080D15");
    public static readonly IBrush Line = Brush("#222C39");
    public static readonly IBrush LineSoft = Brush("#171F29");
    public static readonly IBrush Splitter = Brush("#2A3648");

    // --- Text ---
    public static readonly IBrush Ink = Brush("#EEF2F8");
    public static readonly IBrush Muted = Brush("#93A0B4");
    public static readonly IBrush Faint = Brush("#61708A");

    // --- Accents & status ---
    public static readonly IBrush Gold = Brush("#E3B75C");
    public static readonly IBrush GoldInk = Brush("#191307");
    public static readonly IBrush PreviewAccent = Gold;
    public static readonly IBrush Live = Brush("#FF5C5C");
    public static readonly IBrush LiveInk = Brush("#FFECEC");
    public static readonly IBrush Good = Brush("#43E0A0");
    public static readonly IBrush Warning = Brush("#F0B75E");
    public static readonly IBrush Danger = Brush("#F47B7B");

    // Row state tints (subtle, never decorative).
    public static readonly IBrush RowLiveTint = Brush("#231318");
    public static readonly IBrush RowPreviewTint = Brush("#211C10");

    // Type coding (informational badges for cue kinds).
    public static readonly IBrush TypeScripture = Gold;
    public static readonly IBrush TypeSong = Brush("#8AB8F0");
    public static readonly IBrush TypeSlide = Brush("#B9A7F2");
    public static readonly IBrush TypeMedia = Brush("#F09A6E");
    public static readonly IBrush TypeNotice = Brush("#8FD4B0");
    public static readonly IBrush TypePlain = Muted;

    public const double RadiusControl = 6;
    public const double RadiusPanel = 8;
    public const double RadiusChip = 4;

    public const double FontMicro = 10;
    public const double FontSmall = 11;
    public const double FontBody = 12;
    public const double FontSection = 13;
    public const double FontTitle = 15;
    public const double FontDisplay = 19;

    public static SolidColorBrush Brush(string hex) => new(Color.Parse(hex));

    /// <summary>Uppercase micro-label used across panel headers.</summary>
    public static TextBlock SectionLabel(string text, IBrush? foreground = null) => new()
    {
        Text = text,
        FontSize = FontMicro,
        FontWeight = FontWeight.Bold,
        Foreground = foreground ?? Gold,
        LetterSpacing = 1.1
    };

    public static TextBlock Label(string text, double size, FontWeight weight, IBrush? foreground = null) => new()
    {
        Text = text,
        FontSize = size,
        FontWeight = weight,
        Foreground = foreground ?? Ink,
        TextWrapping = TextWrapping.Wrap
    };

    /// <summary>Compact status chip. Keep text short — chips are not sentences.</summary>
    public static Border Chip(string text, IBrush foreground, IBrush? background = null, string? tooltip = null)
    {
        var block = new TextBlock
        {
            Text = text,
            FontSize = FontMicro,
            FontWeight = FontWeight.Bold,
            Foreground = foreground,
            LetterSpacing = 0.8
        };
        var chip = new Border
        {
            Background = background ?? Brush("#00000000"),
            BorderBrush = foreground,
            BorderThickness = new Thickness(0, 0, 0, 0),
            CornerRadius = new CornerRadius(RadiusChip),
            Padding = new Thickness(6, 2),
            Child = block
        };
        if (tooltip is not null) ToolTip.SetTip(chip, tooltip);
        return chip;
    }

    /// <summary>Production toolbar button — compact, flat, keyboard-hint aware.</summary>
    public static Button ToolButton(string text, bool primary = false, string? tooltip = null)
    {
        var button = new Button
        {
            Content = text,
            MinHeight = 30,
            Padding = new Thickness(10, 4),
            Background = primary ? Gold : SurfaceRaised,
            Foreground = primary ? GoldInk : Ink,
            FontWeight = FontWeight.SemiBold,
            FontSize = FontBody,
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(RadiusControl)
        };
        if (tooltip is not null) ToolTip.SetTip(button, tooltip);
        return button;
    }

    /// <summary>Small square icon-ish toggle used for pane collapse affordances.</summary>
    public static Button IconToggle(string glyph, string tooltip, bool active = true)
    {
        var button = new Button
        {
            Content = new TextBlock
            {
                Text = glyph,
                FontSize = 12,
                FontWeight = FontWeight.Bold,
                Foreground = active ? Ink : Faint
            },
            MinWidth = 28,
            MinHeight = 26,
            Padding = new Thickness(4, 2),
            Background = SurfaceRaised,
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(RadiusChip)
        };
        ToolTip.SetTip(button, tooltip);
        return button;
    }

    /// <summary>Compact panel container used across the operator workspace.</summary>
    public static Border ConsolePanel(Control content, IBrush? background = null, Thickness? padding = null)
    {
        return new Border
        {
            Background = background ?? Surface,
            BorderBrush = LineSoft,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(RadiusPanel),
            Padding = padding ?? new Thickness(8),
            Child = content
        };
    }

    /// <summary>Compact text input consistent with the console metrics.</summary>
    public static TextBox Input(string placeholder, bool secret = false, double minHeight = 32)
    {
        return new TextBox
        {
            PlaceholderText = placeholder,
            MinHeight = minHeight,
            PasswordChar = secret ? '●' : '\0',
            FontSize = FontBody,
            Padding = new Thickness(8, 4, 8, 4)
        };
    }

    /// <summary>Cue type badge — three-letter code with type coding.</summary>
    public static (string Code, IBrush Color) CueTypeBadge(OperatorWorkspaceItem item)
    {
        var category = item.Category?.Trim();
        if (string.Equals(category, "Scripture", StringComparison.OrdinalIgnoreCase)) return ("SCR", TypeScripture);
        if (string.Equals(category, "Songs", StringComparison.OrdinalIgnoreCase)) return ("SNG", TypeSong);
        if (string.Equals(category, "Slides", StringComparison.OrdinalIgnoreCase)) return ("SLD", TypeSlide);
        if (string.Equals(category, "Media", StringComparison.OrdinalIgnoreCase)) return ("MED", TypeMedia);
        if (string.Equals(category, "Announcements", StringComparison.OrdinalIgnoreCase)) return ("NTC", TypeNotice);
        return ("CTN", TypePlain);
    }
}
