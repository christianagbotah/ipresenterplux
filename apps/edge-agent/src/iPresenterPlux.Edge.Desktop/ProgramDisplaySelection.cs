namespace iPresenterPlux.Edge.Desktop;

public sealed record ProgramDisplayTarget(
    string Id,
    string Label,
    int X,
    int Y,
    int Width,
    int Height,
    bool IsPrimary)
{
    public override string ToString() =>
        $"{Label} · {Width}×{Height}{(IsPrimary ? " · Primary" : string.Empty)}";
}

public sealed record ProgramDisplaySelectionResult(
    ProgramDisplayTarget? Target,
    bool UsedFallback);

public static class ProgramDisplaySelector
{
    public static ProgramDisplaySelectionResult Resolve(
        string? preferredId,
        IReadOnlyList<ProgramDisplayTarget> displays)
    {
        ArgumentNullException.ThrowIfNull(displays);
        var preferred = preferredId?.Trim();
        if (!string.IsNullOrWhiteSpace(preferred))
        {
            var exact = displays.FirstOrDefault(display =>
                display.Id.Equals(preferred, StringComparison.OrdinalIgnoreCase));
            if (exact is not null) return new ProgramDisplaySelectionResult(exact, false);
        }

        if (displays.Count == 0)
            return new ProgramDisplaySelectionResult(null, !string.IsNullOrWhiteSpace(preferred));

        var fallback = displays.FirstOrDefault(display => display.IsPrimary) ?? displays[0];
        return new ProgramDisplaySelectionResult(fallback, !string.IsNullOrWhiteSpace(preferred));
    }
}
