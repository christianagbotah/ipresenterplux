using iPresenterPlux.Edge.Desktop;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class OperatorSuggestionsTests
{
    private static OperatorWorkspaceItem Item(string id, string title) =>
        new(id, "Scripture", title, "body", null, "#D7A94A");

    private static OperatorRundownRow Row(
        string id,
        string title,
        bool current = false,
        bool preview = false,
        bool next = false,
        string? mediaStatus = null,
        int sequence = 0) =>
        new(Item(id, title), sequence, current, preview, next, mediaStatus);

    [Fact]
    public void LiveOutputWithoutRecordingSuggestsStartingRecording()
    {
        var suggestions = OperatorSuggestions.Evaluate(
            outputRunning: true, isRecording: false, programHasItem: true, mediaPaused: false,
            Array.Empty<OperatorRundownRow>());

        var suggestion = Assert.Single(suggestions, s => s.Id == "record-off");
        Assert.Equal(OperatorSuggestion.ActionRecord, suggestion.ActionKind);
        Assert.NotNull(suggestion.ActionLabel);
    }

    [Fact]
    public void DownloadingMediaSurfacesAnObserveOnlySuggestion()
    {
        var rows = new[] { Row("m1", "Notices video", mediaStatus: "DOWNLOADING") };
        var suggestions = OperatorSuggestions.Evaluate(
            outputRunning: false, isRecording: false, programHasItem: false, mediaPaused: false, rows);

        var suggestion = suggestions.Single(s => s.Id == "media-downloading");
        Assert.Equal(OperatorSuggestion.ActionObserve, suggestion.ActionKind);
        Assert.Null(suggestion.ActionLabel);
        Assert.Equal("m1", suggestion.RelatedItemId);
    }

    [Fact]
    public void PausedMediaSuggestsResume()
    {
        var suggestions = OperatorSuggestions.Evaluate(
            outputRunning: true, isRecording: true, programHasItem: true, mediaPaused: true,
            new[] { Row("a", "Song", current: true) });

        Assert.Contains(suggestions, s =>
            s.Id == "media-paused" && s.ActionKind == OperatorSuggestion.ActionResumeMedia);
    }

    [Fact]
    public void ClearProgramWithAQueueSuggestsLoadingTheNextCueIntoPreview()
    {
        var rows = new[]
        {
            Row("done", "Prayer", current: true, sequence: 0),
            Row("next1", "Benediction", next: true, sequence: 1)
        };
        var suggestions = OperatorSuggestions.Evaluate(
            outputRunning: false, isRecording: false, programHasItem: false, mediaPaused: false, rows);

        var suggestion = suggestions.Single(s => s.Id == "program-clear");
        Assert.Equal(OperatorSuggestion.ActionPreview, suggestion.ActionKind);
        Assert.Equal("next1", suggestion.RelatedItemId);
        Assert.Equal("LOAD INTO PREVIEW", suggestion.ActionLabel);
    }

    [Fact]
    public void PrimedNextCueDoesNotTriggerThePreviewSuggestion()
    {
        var rows = new[]
        {
            Row("live", "Sermon", current: true, sequence: 0),
            Row("next1", "Benediction", next: true, preview: true, sequence: 1)
        };
        var suggestions = OperatorSuggestions.Evaluate(
            outputRunning: true, isRecording: true, programHasItem: true, mediaPaused: false, rows);

        Assert.DoesNotContain(suggestions, s => s.Id == "next-not-primed");
        Assert.Contains(suggestions, s => s.Id == "all-clear");
    }

    [Fact]
    public void DismissedSuggestionsStayHiddenUntilTheyMatterAgain()
    {
        var rows = new[] { Row("next1", "Benediction", next: true) };
        var suggestions = OperatorSuggestions.Evaluate(
            outputRunning: false, isRecording: false, programHasItem: false, mediaPaused: false,
            rows, dismissedIds: new[] { "program-clear" });

        Assert.DoesNotContain(suggestions, s => s.Id == "program-clear");
    }

    [Fact]
    public void SuggestionFloodIsCappedAtThreeCards()
    {
        var rows = new[]
        {
            Row("m1", "Video A", mediaStatus: "DOWNLOADING", sequence: 0),
            Row("m2", "Video B", mediaStatus: "DOWNLOADING", sequence: 1),
            Row("m3", "Video C", mediaStatus: "DOWNLOADING", sequence: 2),
            Row("next1", "Benediction", next: true, sequence: 3)
        };
        var suggestions = OperatorSuggestions.Evaluate(
            outputRunning: true, isRecording: false, programHasItem: false, mediaPaused: true, rows);

        Assert.Equal(OperatorSuggestions.MaxSuggestions, suggestions.Count);
    }

    [Fact]
    public void QuietRundownProducesNoSuggestions()
    {
        var suggestions = OperatorSuggestions.Evaluate(
            outputRunning: false, isRecording: false, programHasItem: false, mediaPaused: false,
            Array.Empty<OperatorRundownRow>());

        Assert.Empty(suggestions);
    }
}
