namespace iPresenterPlux.Edge.Desktop;

/// <summary>
/// A single operator-facing suggestion produced by the heuristic assistant.
/// Suggestions are advisory only: the desktop operator always confirms via the
/// existing Preview → TAKE contract, and nothing here mutates Program.
/// </summary>
public sealed record OperatorSuggestion(
    string Id,
    string Title,
    string Detail,
    string? ActionLabel,
    string ActionKind,
    string? RelatedItemId)
{
    public const string ActionPreview = "preview";
    public const string ActionRecord = "record";
    public const string ActionResumeMedia = "resume-media";
    public const string ActionObserve = "observe";
}

/// <summary>
/// Deterministic, offline "AI Director" heuristics for the Studio Shell deck.
/// The panel is intentionally conservative: it reads the current rundown and
/// edge snapshot and surfaces at most three next-best actions. There is no
/// cloud call, no model inference, and no direct Program mutation — every
/// suggestion that changes output routes through Preview first.
/// </summary>
public static class OperatorSuggestions
{
    public const int MaxSuggestions = 3;

    public static IReadOnlyList<OperatorSuggestion> Evaluate(
        bool outputRunning,
        bool isRecording,
        bool programHasItem,
        bool mediaPaused,
        IReadOnlyList<OperatorRundownRow> rows,
        IEnumerable<string>? dismissedIds = null)
    {
        var dismissed = dismissedIds as ICollection<string> ?? new HashSet<string>(dismissedIds ?? Array.Empty<string>());
        var suggestions = new List<OperatorSuggestion>();

        var next = rows.FirstOrDefault(r => r.IsNext) ?? rows.FirstOrDefault(r => !r.IsCurrent);
        var current = rows.FirstOrDefault(r => r.IsCurrent);

        if (outputRunning && !isRecording)
        {
            suggestions.Add(new OperatorSuggestion(
                "record-off",
                "Service is live — recording is off",
                "Output is running but no recording is active. Start a local recording so the service is archived.",
                "START RECORDING",
                OperatorSuggestion.ActionRecord,
                null));
        }

        var downloading = rows.FirstOrDefault(r => string.Equals(r.MediaStatus, "DOWNLOADING", StringComparison.OrdinalIgnoreCase));
        if (downloading is not null)
        {
            suggestions.Add(new OperatorSuggestion(
                "media-downloading",
                "Media is still downloading",
                $"\u201c{downloading.Item.Title}\u201d is not ready yet. Give it a moment before it reaches the stage.",
                null,
                OperatorSuggestion.ActionObserve,
                downloading.Item.Id));
        }

        if (mediaPaused)
        {
            suggestions.Add(new OperatorSuggestion(
                "media-paused",
                "Playback is paused",
                "The live media item is paused. Resume it or clear Program to move on.",
                "RESUME MEDIA",
                OperatorSuggestion.ActionResumeMedia,
                null));
        }

        if (!programHasItem && next is not null)
        {
            suggestions.Add(new OperatorSuggestion(
                "program-clear",
                "Program is clear",
                $"Load \u201c{next.Item.Title}\u201d into Preview so TAKE is one key away.",
                "LOAD INTO PREVIEW",
                OperatorSuggestion.ActionPreview,
                next.Item.Id));
        }

        if (programHasItem && next is not null && !next.IsPreview)
        {
            suggestions.Add(new OperatorSuggestion(
                "next-not-primed",
                "Next cue is not primed",
                $"\u201c{next.Item.Title}\u201d is up next but Preview is holding something else. Prime it for a clean TAKE.",
                "LOAD INTO PREVIEW",
                OperatorSuggestion.ActionPreview,
                next.Item.Id));
        }

        if (outputRunning && programHasItem && current is not null && isRecording)
        {
            suggestions.Add(new OperatorSuggestion(
                "all-clear",
                "You are in good shape",
                $"\u201c{current.Item.Title}\u201d is live, recording, and the next cue is one TAKE away. Nothing needs attention.",
                null,
                OperatorSuggestion.ActionObserve,
                null));
        }

        return suggestions
            .Where(s => !dismissed.Contains(s.Id))
            .Take(MaxSuggestions)
            .ToList();
    }
}
