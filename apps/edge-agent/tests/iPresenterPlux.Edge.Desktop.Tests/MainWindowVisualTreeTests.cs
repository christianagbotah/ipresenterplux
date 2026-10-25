using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Xunit;

[assembly: AvaloniaTestApplication(typeof(iPresenterPlux.Edge.Desktop.Tests.MainWindowVisualTreeTests.TestAppBuilder))]

namespace iPresenterPlux.Edge.Desktop.Tests;

/// <summary>
/// Executable UI-construction tests for MainWindow.
///
/// The Windows launch smoke on PR #110 caught a startup crash that none of the
/// source-string tests could see: the TAKE button was added to two different
/// containers (the previewActions WrapPanel AND the seam takeStack StackPanel),
/// which throws
/// <c>System.InvalidOperationException: The control Button already has a visual
/// parent WrapPanel while trying to add it as a child of StackPanel</c>
/// during window construction — before any test assertion on the source text
/// could matter. These tests build the REAL visual tree on the Avalonia headless
/// platform and pin the invariants that keep startup alive.
/// </summary>
public sealed class MainWindowVisualTreeTests
{
    public static class TestAppBuilder
    {
        public static AppBuilder BuildAvaloniaApp() =>
            AppBuilder.Configure<Application>()
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
        AssertNoControlAppearsTwiceInVisualTree(window);
    }

    [AvaloniaFact]
    public void TakeButtonIsConstructedExactlyOnceInTheVisualTree()
    {
        SkipWhereEntitlementVaultIsUnavailable();

        var window = new MainWindow();

        var takeButtons = FindDescendantButtons(window)
            .Where(b => string.Equals(b.Content as string, "TAKE", StringComparison.Ordinal))
            .ToList();

        // One physical TAKE control. Duplicating the same live action (a second
        // instance OR the same instance added twice) is a startup crash or a
        // contract bug — both must fail here.
        var take = Assert.Single(takeButtons);
        Assert.NotNull(take);
    }

    [AvaloniaFact]
    public void TakeButtonIsParentedByTheSeamStackPanelOnly()
    {
        SkipWhereEntitlementVaultIsUnavailable();

        var window = new MainWindow();

        var take = Assert.Single(FindDescendantButtons(window),
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

        var prepare = Assert.Single(FindDescendantButtons(window),
            b => string.Equals(b.Content as string, "Preview · F6", StringComparison.Ordinal));
        var previewActions = Assert.IsType<WrapPanel>(prepare.Parent);

        Assert.DoesNotContain(previewActions.Children,
            child => child is Button b && string.Equals(b.Content as string, "TAKE", StringComparison.Ordinal));
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
    /// Walks the whole visual tree and fails if any control is reachable through
    /// two different parents — the exact defect class behind the Windows startup
    /// crash. A control with two visual parents is yielded twice by the traversal.
    /// </summary>
    private static void AssertNoControlAppearsTwiceInVisualTree(MainWindow window)
    {
        var descendants = window.GetVisualDescendants().ToList();
        var duplicates = descendants
            .GroupBy(control => control)
            .Where(group => group.Count() > 1)
            .Select(group => group.First().GetType().Name)
            .ToList();

        Assert.True(
            duplicates.Count == 0,
            "MainWindow's visual tree contains controls with more than one visual parent: " +
            string.Join(", ", duplicates));
    }

    private static IReadOnlyList<Button> FindDescendantButtons(MainWindow window) =>
        window.GetVisualDescendants().OfType<Button>().ToList();
}
