using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.Layout;
using Avalonia.Media;

namespace iPresenterPlux.Edge.Desktop;

/// <summary>
/// Data templates that turn <see cref="OperatorRundownRow"/> into production-grade
/// schedule and library rows: type badge, title, reference line, drag affordance
/// and compact state chips (LIVE / PREVIEW / NEXT / media readiness).
/// Selection and click behavior stay owned by the hosting ListBox, so the
/// single-click Preview / double-click Program contracts are untouched.
/// </summary>
public static class OperatorRowTemplates
{
    public static IDataTemplate ScheduleRowTemplate(Func<OperatorRundownRow, ContextMenu?>? menuFactory = null) =>
        new FuncDataTemplate<OperatorRundownRow>((row, _) => row is null ? new Border() : BuildScheduleRow(row, menuFactory));

    public static IDataTemplate LibraryRowTemplate(Func<OperatorRundownRow, ContextMenu?>? menuFactory = null) =>
        new FuncDataTemplate<OperatorRundownRow>((row, _) => row is null ? new Border() : BuildLibraryRow(row, menuFactory));

    /// <summary>
    /// One compact context-menu entry. <see cref="Separator"/> entries render a
    /// divider; everything else is a labeled action with a short tooltip.
    /// </summary>
    public sealed record MenuEntry(string? Header, string? Tooltip, Action? Action)
    {
        public static MenuEntry Item(string header, string tooltip, Action action) => new(header, tooltip, action);

        public static MenuEntry Separator() => new(null, null, null);
    }

    /// <summary>Builds a compact context menu from the given entries.</summary>
    public static ContextMenu Menu(params MenuEntry[] entries)
    {
        var menu = new ContextMenu();
        foreach (var entry in entries)
        {
            if (entry.Header is null)
            {
                menu.Items.Add(new Separator());
                continue;
            }
            var captured = entry;
            var item = new MenuItem { Header = captured.Header };
            ToolTip.SetTip(item, captured.Tooltip);
            item.Click += (_, _) => captured.Action?.Invoke();
            menu.Items.Add(item);
        }
        return menu;
    }

    private static Control BuildScheduleRow(OperatorRundownRow row, Func<OperatorRundownRow, ContextMenu?>? menuFactory)
    {
        var grid = new Grid { ColumnSpacing = 8, MinHeight = 40 };
        grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));       // grip
        grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));       // sequence
        grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));       // type badge
        grid.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star))); // text
        grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));       // state chips

        var grip = new TextBlock
        {
            Text = "≡",
            FontSize = 12,
            Foreground = OperatorTheme.Faint,
            VerticalAlignment = VerticalAlignment.Center
        };
        ToolTip.SetTip(grip, "Drag handle placeholder — use Move Up / Move Down or Ctrl+Up / Ctrl+Down to reorder.");
        grid.Children.Add(grip);

        var sequence = new TextBlock
        {
            Text = row.Sequence.ToString("00"),
            FontSize = OperatorTheme.FontSmall,
            FontWeight = FontWeight.Bold,
            Foreground = OperatorTheme.Faint,
            VerticalAlignment = VerticalAlignment.Center,
            MinWidth = 20
        };
        Grid.SetColumn(sequence, 1);
        grid.Children.Add(sequence);

        var typeBadge = TypeBadge(row.Item);
        Grid.SetColumn(typeBadge, 2);
        grid.Children.Add(typeBadge);

        var cueText = CueText(row.Item, showBody: true);
        Grid.SetColumn(cueText, 3);
        grid.Children.Add(cueText);

        var chips = StateChips(row);
        Grid.SetColumn(chips, 4);
        grid.Children.Add(chips);

        if (row.IsCurrent)
            return AttachMenu(RowShell(grid, OperatorTheme.RowLiveTint, OperatorTheme.Live), row, menuFactory);
        if (row.IsPreview)
            return AttachMenu(RowShell(grid, OperatorTheme.RowPreviewTint, OperatorTheme.PreviewAccent), row, menuFactory);
        return AttachMenu(RowShell(grid, null, null), row, menuFactory);
    }

    private static Control BuildLibraryRow(OperatorRundownRow row, Func<OperatorRundownRow, ContextMenu?>? menuFactory)
    {
        var grid = new Grid { ColumnSpacing = 8, MinHeight = 46 };
        grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));       // type badge
        grid.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(1, GridUnitType.Star))); // text
        grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));       // state chips
        grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));

        var badge = TypeBadge(row.Item);
        Grid.SetRowSpan(badge, 3);
        grid.Children.Add(badge);

        var text = new TextBlock
        {
            Text = row.Item.Title,
            FontSize = OperatorTheme.FontBody,
            FontWeight = FontWeight.SemiBold,
            Foreground = OperatorTheme.Ink,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);

        var body = new TextBlock
        {
            Text = FirstLine(row.Item.Body),
            FontSize = OperatorTheme.FontSmall,
            Foreground = OperatorTheme.Muted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(body, 1);
        Grid.SetRow(body, 1);
        grid.Children.Add(body);

        var footer = new TextBlock
        {
            Text = FooterText(row.Item),
            FontSize = OperatorTheme.FontMicro,
            Foreground = OperatorTheme.Faint,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(footer, 1);
        Grid.SetRow(footer, 2);
        grid.Children.Add(footer);

        var chips = StateChips(row);
        Grid.SetColumn(chips, 2);
        Grid.SetRow(chips, 0);
        Grid.SetRowSpan(chips, 3);
        grid.Children.Add(chips);

        if (row.IsCurrent)
            return AttachMenu(RowShell(grid, OperatorTheme.RowLiveTint, OperatorTheme.Live), row, menuFactory);
        if (row.IsPreview)
            return AttachMenu(RowShell(grid, OperatorTheme.RowPreviewTint, OperatorTheme.PreviewAccent), row, menuFactory);
        return AttachMenu(RowShell(grid, null, null), row, menuFactory);
    }

    private static Border AttachMenu(Border shell, OperatorRundownRow row, Func<OperatorRundownRow, ContextMenu?>? menuFactory)
    {
        if (menuFactory is not null)
            shell.ContextMenu = menuFactory(row);
        return shell;
    }

    private static Border RowShell(Control content, IBrush? tint, IBrush? edge)
    {
        return new Border
        {
            Background = tint ?? OperatorTheme.SurfaceRaised,
            BorderBrush = edge,
            BorderThickness = edge is null ? new Thickness(1, 1, 1, 1) : new Thickness(1),
            CornerRadius = new CornerRadius(OperatorTheme.RadiusChip),
            Padding = new Thickness(8, 3),
            Margin = new Thickness(1, 0, 1, 2),
            Child = content
        };
    }

    private static Border TypeBadge(OperatorWorkspaceItem item)
    {
        var (code, color) = OperatorTheme.CueTypeBadge(item);
        return new Border
        {
            Background = ColorOverlay(color, 0.14),
            CornerRadius = new CornerRadius(OperatorTheme.RadiusChip),
            Padding = new Thickness(5, 2),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock
            {
                Text = code,
                FontSize = OperatorTheme.FontMicro,
                FontWeight = FontWeight.Bold,
                Foreground = color
            }
        };
    }

    private static StackPanel CueText(OperatorWorkspaceItem item, bool showBody)
    {
        var panel = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        var title = new TextBlock
        {
            Text = item.Title,
            FontSize = OperatorTheme.FontBody,
            FontWeight = FontWeight.SemiBold,
            Foreground = OperatorTheme.Ink,
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        panel.Children.Add(title);
        if (showBody)
        {
            var detail = new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(item.Footer)
                    ? FirstLine(item.Body)
                    : $"{FirstLine(item.Body)} · {item.Footer}",
                FontSize = OperatorTheme.FontSmall,
                Foreground = OperatorTheme.Muted,
                TextTrimming = TextTrimming.CharacterEllipsis
            };
            panel.Children.Add(detail);
        }
        return panel;
    }

    private static StackPanel StateChips(OperatorRundownRow row)
    {
        var chips = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center
        };

        if (row.IsCurrent)
        {
            var live = OperatorTheme.Chip("LIVE", OperatorTheme.LiveInk, ColorOverlay(OperatorTheme.Live, 0.85),
                "This cue is currently live on Program.");
            live.Padding = new Thickness(6, 2);
            chips.Children.Add(live);
        }
        if (row.IsPreview)
        {
            chips.Children.Add(OperatorTheme.Chip("PREVIEW", OperatorTheme.PreviewAccent,
                ColorOverlay(OperatorTheme.PreviewAccent, 0.12), "This cue is prepared in Preview."));
        }
        if (row.IsNext)
        {
            chips.Children.Add(OperatorTheme.Chip("NEXT", OperatorTheme.Muted, null, "Next cue after the current Program item."));
        }
        if (!string.IsNullOrWhiteSpace(row.MediaStatus))
        {
            var warn = OperatorTheme.Chip(row.MediaStatus, OperatorTheme.Warning,
                ColorOverlay(OperatorTheme.Warning, 0.1), "Media preparation state for this cue.");
            chips.Children.Add(warn);
        }
        return chips;
    }

    private static string FirstLine(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return string.Empty;
        var text = body.Replace("\r", string.Empty);
        var line = text.Split('\n')[0].Trim();
        return line.Length > 92 ? line[..92] + "…" : line;
    }

    private static string FooterText(OperatorWorkspaceItem item)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(item.Footer)) parts.Add(item.Footer);
        parts.Add(item.Category);
        if (item.IsSynced) parts.Add("synced");
        return string.Join(" · ", parts);
    }

    private static IBrush ColorOverlay(IBrush source, double alpha)
    {
        if (source is not SolidColorBrush solid) return source;
        var color = solid.Color;
        return new SolidColorBrush(Color.FromArgb(
            (byte)Math.Clamp((int)(alpha * 255), 0, 255), color.R, color.G, color.B));
    }
}
