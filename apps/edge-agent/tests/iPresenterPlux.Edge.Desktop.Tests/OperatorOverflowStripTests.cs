using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

/// <summary>
/// Executable behavior tests for the resource-category overflow strip.
/// These run on every OS (no entitlement vault involved): they build the real
/// control on the Avalonia headless platform, lay it out at narrow widths and
/// pin the production contract — arrows enable only when content exists
/// beyond the visible area, wheel/touchpad deltas scroll horizontally, and
/// the active category can always be brought into view.
/// </summary>
public sealed class OperatorOverflowStripTests
{
    [AvaloniaFact]
    public void ArrowsStayDisabledWhenAllContentFits()
    {
        var (window, strip) = CreateStrip(width: 400, buttons: 2);

        Assert.False(strip.PreviousArrowEnabled);
        Assert.False(strip.NextArrowEnabled);
        Assert.Equal(0, strip.ScrollOffset);
    }

    [AvaloniaFact]
    public void RightArrowEnablesWhenContentExtendsBeyondTheViewport()
    {
        var (window, strip) = CreateStrip(width: 200, buttons: 12);

        Assert.False(strip.PreviousArrowEnabled);
        Assert.True(strip.NextArrowEnabled);
    }

    [AvaloniaFact]
    public void ScrollingToEndFlipsTheArrowStates()
    {
        var (window, strip) = CreateStrip(width: 200, buttons: 12);
        // Scrolling snaps to whole item boundaries; keep scrolling until the
        // right arrow finally disables at the end.
        for (var i = 0; i < 12; i++)
        {
            strip.ApplyWheelDelta(new Vector(0, -20)); // mouse wheel down → scroll right
            Dispatcher.UIThread.RunJobs();
        }
        strip.UpdateNavigationState();

        Assert.True(strip.PreviousArrowEnabled);
        Assert.False(strip.NextArrowEnabled);
        Assert.True(strip.ScrollOffset > 0);
    }

    [AvaloniaFact]
    public void WheelScrollingSnapsToWholeItemBoundaries()
    {
        var (window, strip) = CreateStrip(width: 200, buttons: 12);
        // A short wheel nudge lands mid-list: the offset must sit exactly on
        // an item's left edge — never half-way through a tab label.
        strip.ApplyWheelDelta(new Vector(0, -0.4));
        Dispatcher.UIThread.RunJobs();

        var boundaries = strip.Items.Cast<Control>().Select(item => item.Bounds.Left).ToList();
        Assert.Contains(strip.ScrollOffset, boundaries);
    }

    [AvaloniaFact]
    public void TouchpadHorizontalDeltasScrollTheStrip()
    {
        var (window, strip) = CreateStrip(width: 200, buttons: 12);

        strip.ApplyWheelDelta(new Vector(3, 0)); // touchpad swipe right
        Dispatcher.UIThread.RunJobs();

        Assert.True(strip.ScrollOffset > 0);
        Assert.True(strip.PreviousArrowEnabled);
    }

    [AvaloniaFact]
    public void EnsureVisibleBringsTheActiveCategoryIntoView()
    {
        var (window, strip) = CreateStrip(width: 200, buttons: 12);

        var last = Assert.IsType<Button>(strip.Items[^1]);
        Assert.True(last.Bounds.Right > 200); // the last category starts off-screen

        strip.EnsureVisible(last);
        Dispatcher.UIThread.RunJobs();

        // The strip scrolled so the last item's right edge fits the viewport.
        Assert.True(strip.ScrollOffset > 0);
        Assert.True(last.Bounds.Right - strip.ScrollOffset <= 200 + 1);
    }

    [AvaloniaFact]
    public void ItemsKeepExactlyOneParentInsideTheStrip()
    {
        var (window, strip) = CreateStrip(width: 300, buttons: 6);

        // Each item is parented by the strip's item host exactly once — the
        // double-parenting defect class guarded by MainWindowVisualTreeTests
        // cannot appear here either.
        var hosts = strip.Items.Cast<Control>().Select(item => item.Parent).Distinct().ToList();
        Assert.Single(hosts);
        Assert.Same(strip.ItemHost, hosts[0]);
    }

    /// <summary>
    /// Builds the strip inside a shown headless window so templates, layout and
    /// ScrollViewer extents are realized exactly as in the running app.
    /// </summary>
    private static (Window Window, OperatorOverflowStrip Strip) CreateStrip(int width, int buttons)
    {
        var strip = new OperatorOverflowStrip();
        for (var i = 0; i < buttons; i++)
        {
            strip.Items.Add(new Button
            {
                Content = $"Category {i}",
                MinWidth = 88,
                MinHeight = 28
            });
        }
        var window = new Window
        {
            Content = strip,
            Width = width,
            Height = 44
        };
        window.Show();
        for (var i = 0; i < 8; i++)
        {
            Dispatcher.UIThread.RunJobs();
            Thread.Sleep(10);
        }
        strip.UpdateNavigationState();
        return (window, strip);
    }
}
