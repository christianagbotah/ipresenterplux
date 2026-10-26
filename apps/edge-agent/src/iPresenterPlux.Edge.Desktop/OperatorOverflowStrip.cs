using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;

namespace iPresenterPlux.Edge.Desktop;

/// <summary>
/// Horizontal overflow strip for production toolbars:
/// <c>‹ [scrollable items] ›</c>.
///
/// Replaces plain horizontal StackPanels whose children overlap or clip once
/// the pane gets narrow (the Resource Deck category row is the primary user).
/// Behavior contract:
/// <list type="bullet">
/// <item>the left/right arrows enable only when content exists beyond that
/// side of the visible area — never a permanently visible scrollbar;</item>
/// <item>mouse-wheel and touchpad horizontal deltas scroll the strip along
/// the horizontal axis;</item>
/// <item>Left/Right arrow keys move focus between the item buttons;</item>
/// <item><see cref="EnsureVisible"/> keeps the active category on screen;</item>
/// <item>labels are never shrunk to unreadable sizes and never wrap.</item>
/// </list>
/// </summary>
public sealed class OperatorOverflowStrip : Grid
{
    private const double WheelStep = 96;

    private readonly Button _previous;
    private readonly Button _next;
    private readonly ScrollViewer _scroller;
    private readonly StackPanel _items;
    private Control? _anchored;
    private double _lastViewportWidth;
    private bool _reanchoring;

    public OperatorOverflowStrip()
    {
        ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto");
        ColumnSpacing = 2;

        _previous = NavButton("‹", "Previous resource category");
        _next = NavButton("›", "Next resource category");
        _items = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        _scroller = new ScrollViewer
        {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Hidden,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            Content = _items,
            Focusable = false
        };

        Children.Add(_previous);
        Grid.SetColumn(_scroller, 1);
        Children.Add(_scroller);
        Grid.SetColumn(_next, 2);
        Children.Add(_next);

        _scroller.ScrollChanged += (_, _) => UpdateNavigationState();
        _items.LayoutUpdated += (_, _) => UpdateNavigationState();
        // Re-anchor the tracked item whenever the viewport actually resized
        // (preset switch, splitter drag, window resize). LayoutUpdated fires
        // with final geometry, unlike SizeChanged whose Viewport lags one pass.
        // Manual scrolling never resizes the viewport, so browsing away from
        // the active category is never fought.
        LayoutUpdated += (_, _) => ReanchorAfterViewportChange();
        // Tunnel so the strip translates wheel input before the (vertical-disabled)
        // ScrollViewer drops it; touchpads deliver horizontal momentum as Delta.X.
        _scroller.AddHandler(PointerWheelChangedEvent, OnPointerWheel, RoutingStrategies.Tunnel);
        // Tunnel so Left/Right move between item buttons even while a button
        // has keyboard focus.
        AddHandler(KeyDownEvent, OnKeyDown, RoutingStrategies.Tunnel);
        UpdateNavigationState();
    }

    /// <summary>Item host — add toolbar buttons here.</summary>
    public IList<Control> Items => _items.Children;

    /// <summary>The horizontal item host (kept public for existing highlight loops).</summary>
    public StackPanel ItemHost => _items;

    /// <summary>True when the left arrow can scroll (content before the viewport).</summary>
    public bool PreviousArrowEnabled => _previous.IsEnabled;

    /// <summary>True when the right arrow can scroll (content after the viewport).</summary>
    public bool NextArrowEnabled => _next.IsEnabled;

    /// <summary>Current horizontal scroll offset (content coordinates).</summary>
    public double ScrollOffset => _scroller.Offset.X;

    /// <summary>
    /// Scrolls so <paramref name="child"/> is fully visible. Used after an
    /// item becomes active so the operator never loses sight of the selection.
    /// The item is aligned to the viewport's left edge so neighboring tabs never
    /// hang half-clipped at the boundary.
    /// </summary>
    public void EnsureVisible(Control child)
    {
        _anchored = child;
        var extent = _scroller.Extent.Width;
        var viewport = _scroller.Viewport.Width;
        if (viewport <= 0 || extent <= viewport) return;

        var bounds = child.Bounds;
        if (bounds.Width <= 0) return;
        var offset = _scroller.Offset.X;
        if (bounds.Left >= offset + 1 && bounds.Right <= offset + viewport - 1) return;
        ApplyAnchor(child);
    }

    /// <summary>
    /// Aligns <paramref name="child"/>'s left edge with the viewport start.
    /// Used when the viewport is resized (preset switch, splitter drag, window
    /// resize): the active item is re-anchored so no label hangs half-clipped
    /// at the left edge under the new geometry.
    /// </summary>
    public void AnchorToLeft(Control child)
    {
        _anchored = child;
        if (_scroller.Viewport.Width <= 0 || child.Bounds.Width <= 0) return;
        ApplyAnchor(child);
    }

    /// <summary>Scrolls so the anchored child's left edge starts the viewport (clamped).</summary>
    private void ApplyAnchor(Control child)
    {
        var extent = _scroller.Extent.Width;
        var viewport = _scroller.Viewport.Width;
        if (viewport <= 0) return;
        var max = Math.Max(extent - viewport, 0);
        var target = Math.Clamp(child.Bounds.Left, 0, max);
        // When the clamp lands mid-item (the anchor sits near the end and the
        // viewport cannot scroll far enough to left-align it), retreat to the
        // preceding item boundary so the left edge never cuts a label in half.
        // The anchor must remain fully visible, otherwise keep the clamp.
        if (target > 0.5 && !IsItemBoundary(target))
        {
            var boundary = LargestItemBoundaryAtOrBelow(target);
            if (boundary > 0.5 && child.Bounds.Right <= boundary + viewport)
                target = boundary;
        }
        _scroller.Offset = new Vector(target, 0);
        UpdateNavigationState();
    }

    private bool IsItemBoundary(double value) =>
        _items.Children.Any(child => child.Bounds.Width > 0 && Math.Abs(child.Bounds.Left - value) < 0.5);

    private double LargestItemBoundaryAtOrBelow(double value)
    {
        var best = 0.0;
        foreach (var child in _items.Children)
        {
            if (child.Bounds.Width <= 0) continue;
            var left = child.Bounds.Left;
            if (left <= value + 0.5 && left > best) best = left;
        }
        return best;
    }

    /// <summary>
    /// After a viewport resize, re-anchors the tracked item so its left edge
    /// starts the viewport — no label ever hangs half-clipped under the new
    /// geometry. Runs at most once per actual viewport change.
    /// </summary>
    private void ReanchorAfterViewportChange()
    {
        if (_reanchoring) return;
        UpdateNavigationState();
        var viewport = _scroller.Viewport.Width;
        if (Math.Abs(viewport - _lastViewportWidth) < 0.5) return;
        _lastViewportWidth = viewport;
        if (viewport <= 0 || _anchored is not { } anchor || anchor.Bounds.Width <= 0) return;
        _reanchoring = true;
        try { ApplyAnchor(anchor); }
        finally { _reanchoring = false; }
    }

    /// <summary>
    /// Recomputes arrow enabled states from the current extent, viewport and
    /// offset. Cheap; wired to scroll/size/layout events and safe to call
    /// anywhere (the harness tests drive it directly).
    /// </summary>
    public void UpdateNavigationState()
    {
        var extent = _scroller.Extent.Width;
        var viewport = _scroller.Viewport.Width;
        var overflow = extent - viewport > 1.0;
        var offset = _scroller.Offset.X;
        _previous.IsEnabled = overflow && offset > 0.5;
        _next.IsEnabled = overflow && offset < extent - viewport - 0.5;
    }

    /// <summary>
    /// Applies a wheel/touchpad delta to the horizontal axis. Exposed so the
    /// mapping is unit-testable without synthesizing pointer events.
    /// </summary>
    public void ApplyWheelDelta(Vector delta)
    {
        // Mice report vertical notches (Delta.Y), touchpads report horizontal
        // momentum (Delta.X). Prefer the dominant axis.
        var horizontal = Math.Abs(delta.X) >= Math.Abs(delta.Y) ? delta.X : -delta.Y;
        if (horizontal == 0) return;
        ScrollBy(horizontal * WheelStep);
    }

    private void ScrollBy(double amount)
    {
        var extent = _scroller.Extent.Width;
        var viewport = _scroller.Viewport.Width;
        var max = Math.Max(extent - viewport, 0);
        var target = Math.Clamp(_scroller.Offset.X + amount, 0, max);
        // Snap directionally to a whole item boundary: forward when scrolling
        // right, backward when scrolling left. A plain nearest-boundary snap
        // can oscillate just short of the far end; direction + final clamp
        // always makes progress and lands on a clean edge (or the exact end).
        double snapped = target;
        if (amount >= 0)
        {
            foreach (var child in _items.Children)
            {
                if (child.Bounds.Width <= 0) continue;
                if (child.Bounds.Left >= target - 0.5)
                {
                    snapped = child.Bounds.Left;
                    break;
                }
            }
        }
        else
        {
            foreach (var child in _items.Children)
            {
                if (child.Bounds.Width <= 0) continue;
                if (child.Bounds.Left <= target + 0.5) snapped = child.Bounds.Left;
                else break;
            }
        }
        _scroller.Offset = new Vector(Math.Clamp(snapped, 0, max), 0);
        UpdateNavigationState();
    }

    private void OnPointerWheel(object? sender, PointerWheelEventArgs args)
    {
        args.Handled = true;
        ApplyWheelDelta(args.Delta);
    }

    private void OnKeyDown(object? sender, KeyEventArgs args)
    {
        if (args.Key is not (Key.Left or Key.Right)) return;
        var buttons = _items.Children.OfType<Button>().ToList();
        if (buttons.Count == 0) return;
        var index = args.Source is Button source ? buttons.IndexOf(source) : -1;
        if (index < 0) return;
        var target = args.Key == Key.Left ? index - 1 : index + 1;
        if (target < 0 || target >= buttons.Count) return;
        args.Handled = true;
        buttons[target].Focus();
        EnsureVisible(buttons[target]);
    }

    private void GoToPrevious() => ScrollBy(-Math.Max(_scroller.Viewport.Width * 0.8, 64));

    private void GoToNext() => ScrollBy(Math.Max(_scroller.Viewport.Width * 0.8, 64));

    private Button NavButton(string glyph, string tooltip)
    {
        var button = new Button
        {
            Content = new TextBlock
            {
                Text = glyph,
                FontSize = 13,
                FontWeight = FontWeight.Bold
            },
            MinWidth = 22,
            MinHeight = 28,
            Padding = new Thickness(2, 2),
            Background = OperatorTheme.SurfaceRaised,
            Foreground = OperatorTheme.Ink,
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(OperatorTheme.RadiusChip),
            VerticalAlignment = VerticalAlignment.Stretch,
            Focusable = true
        };
        ToolTip.SetTip(button, tooltip);
        return button;
    }
}
