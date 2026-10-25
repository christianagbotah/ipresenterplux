using System.Collections;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.LogicalTree;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;
using Xunit;

[assembly: AvaloniaTestApplication(typeof(iPresenterPlux.Edge.Desktop.Tests.MainWindowVisualTreeTests.TestAppBuilder))]

namespace iPresenterPlux.Edge.Desktop.Tests;

/// <summary>
/// Executable UI-construction tests for MainWindow.
///
/// The Windows launch smoke on PR #110 caught startup crashes that none of the
/// source-string tests could see: the same Button instance was added to two
/// different containers (first TAKE → previewActions WrapPanel AND the seam
/// takeStack StackPanel; after that fix, Start Recording → headerActions
/// StackPanel AND programActions WrapPanel), which throws
/// <c>System.InvalidOperationException: The control Button already has a visual
/// parent …</c> during window construction — before any assertion on source
/// text could matter. These tests build the REAL shell on the Avalonia headless
/// platform and pin the invariants that keep startup alive.
///
/// Note on tree choice: MainWindow opens on the Activation tab and is never
/// shown here, so neither the visual tree nor the logical tree of the TabControl
/// has realized the Operator tab's content. Parent links, however, are wired at
/// construction time (that is exactly where the double-parent exception threw),
/// so these tests walk each constructed <c>TabItem.Content</c> subtree directly
/// and assert on the real object graph.
/// </summary>
public sealed class MainWindowVisualTreeTests
{
    public static class TestAppBuilder
    {
        // Mirrors Program.cs: minimal Application + FluentTheme + Dark variant.
        public static AppBuilder BuildAvaloniaApp() =>
            AppBuilder.Configure<Application>()
                .AfterSetup(builder =>
                {
                    if (builder.Instance is not { } app) return;
                    app.Styles.Add(new FluentTheme());
                    app.RequestedThemeVariant = ThemeVariant.Dark;
                })
                .UseHeadless(new AvaloniaHeadlessPlatformOptions());
    }

    [AvaloniaFact]
    public void MainWindowConstructionSurvivesStartupVisualTreeBuild()
    {
        SkipWhereEntitlementVaultIsUnavailable();

        // Constructing MainWindow runs the full v2.1 shell build: command bar,
        // rail, sidebar, PREVIEW|TAKE seam|PROGRAM stage row and the playout deck.
        // A visual-tree parenting failure anywhere throws right here.
        var window = new MainWindow();

        Assert.NotNull(window.Content);
        AssertNoControlAppearsTwiceInConstructedShell(window);
    }

    [AvaloniaFact]
    public void TakeButtonIsConstructedExactlyOnceInTheShell()
    {
        SkipWhereEntitlementVaultIsUnavailable();

        var window = new MainWindow();

        var takeButtons = FindConstructedButtons(window)
            .Where(b => string.Equals(b.Content as string, "TAKE", StringComparison.Ordinal))
            .ToList();

        // One physical TAKE control. Duplicating the same live action (a second
        // instance OR the same instance added twice) is a startup crash or a
        // contract bug — both must fail here.
        Assert.Single(takeButtons);
    }

    [AvaloniaFact]
    public void TakeButtonIsParentedByTheSeamStackPanelOnly()
    {
        SkipWhereEntitlementVaultIsUnavailable();

        var window = new MainWindow();

        var take = Assert.Single(FindConstructedButtons(window),
            b => string.Equals(b.Content as string, "TAKE", StringComparison.Ordinal));

        // The intended v2.1 layout is PREVIEW | TAKE seam | PROGRAM: TAKE lives on
        // the central seam stack, never inside the Preview action row.
        var seamStack = Assert.IsType<StackPanel>(take.Parent);
        Assert.IsType<Grid>(seamStack.Parent);
        Assert.Equal(2, seamStack.Children.Count); // TAKE + F8 hint
        Assert.Same(take, seamStack.Children[0]);
    }

    [AvaloniaFact]
    public void PreviewActionRowNeverOwnsTheTakeButton()
    {
        SkipWhereEntitlementVaultIsUnavailable();

        var window = new MainWindow();

        var prepare = Assert.Single(FindConstructedButtons(window),
            b => string.Equals(b.Content as string, "Preview · F6", StringComparison.Ordinal));
        var previewActions = Assert.IsType<WrapPanel>(prepare.Parent);

        Assert.DoesNotContain(previewActions.Children,
            child => child is Button b && string.Equals(b.Content as string, "TAKE", StringComparison.Ordinal));
    }

    [AvaloniaFact]
    public void StartRecordingLivesOnlyInTheCommandBar()
    {
        SkipWhereEntitlementVaultIsUnavailable();

        var window = new MainWindow();

        var record = Assert.Single(FindConstructedButtons(window),
            b => string.Equals(b.Content as string, "Start Recording", StringComparison.Ordinal));

        // The command bar (headerActions StackPanel next to GO LIVE) is _record's
        // single home; the program action row must not re-parent it.
        var headerActions = Assert.IsType<StackPanel>(record.Parent);
        Assert.Contains(record, headerActions.Children);
    }

    [AvaloniaFact]
    public void HeadlessHarnessCatchesTheDoubleParentingCrashClass()
    {
        // Pins the platform behavior our MainWindow construction tests rely on:
        // adding one control to a second container throws the exact
        // InvalidOperationException the Windows launch smoke surfaced, even in
        // the headless environment. If Avalonia ever stops enforcing this, the
        // guard tests above would be silently weakened — this test fails first.
        var wrap = new WrapPanel();
        var stack = new StackPanel();
        var button = new Button { Content = "TAKE" };
        wrap.Children.Add(button);

        var window = new Window { Content = wrap };
        Assert.NotNull(window);

        var crash = Assert.Throws<InvalidOperationException>(() => stack.Children.Add(button));
        Assert.Contains("already has a visual parent", crash.Message);
    }

    /// <summary>
    /// MainWindow construction goes through DesktopEntitlementStore.CreateDefault(),
    /// which requires Windows Credential Manager or macOS Keychain. The Edge desktop
    /// product only runs on those platforms (CI runs this suite on both), so on
    /// other OSes these construction tests skip instead of failing for the wrong
    /// reason — the launch-crash regression class is still executed for real in CI.
    /// </summary>
    private static void SkipWhereEntitlementVaultIsUnavailable()
    {
        if (!OperatingSystem.IsWindows() && !OperatingSystem.IsMacOS())
        {
            Assert.Skip("MainWindow construction needs the Windows Credential Manager / macOS Keychain entitlement vault; UI-construction tests execute on Windows and macOS CI.");
        }
    }

    /// <summary>
    /// Fails if any control appears twice across the constructed shell (all
    /// TabItem content subtrees) — a control reachable from two parents, i.e.
    /// the exact defect class behind the Windows startup crashes.
    /// </summary>
    private static void AssertNoControlAppearsTwiceInConstructedShell(MainWindow window)
    {
        var visited = new HashSet<object>();
        var duplicates = new List<string>();
        foreach (var control in ConstructedShellControls(window))
        {
            if (!visited.Add(control))
                duplicates.Add(control.GetType().Name);
        }

        Assert.True(
            duplicates.Count == 0,
            "MainWindow's constructed shell contains controls with more than one parent: " +
            string.Join(", ", duplicates));
    }

    private static IReadOnlyList<Button> FindConstructedButtons(MainWindow window) =>
        ConstructedShellControls(window).OfType<Button>().ToList();

    /// <summary>
    /// Enumerates the whole constructed shell: the TabControl itself and, for
    /// every TabItem, its Content subtree (self + logical descendants). This
    /// works without showing the window or realizing tab content, because every
    /// container wiring (and therefore every parenting bug) happens at
    /// construction time.
    /// </summary>
    private static IEnumerable<Control> ConstructedShellControls(MainWindow window)
    {
        var tabs = Assert.IsType<TabControl>(window.Content);
        yield return tabs;
        foreach (var item in (IEnumerable)tabs.ItemsSource!)
        {
            if (item is not TabItem { Content: Control content }) continue;
            yield return content;
            foreach (var logical in content.GetLogicalDescendants())
            {
                if (logical is Control control)
                    yield return control;
            }
        }
    }
}
