using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class OperatorRundownNavigatorTests
{
    private static readonly Guid ServiceId = Guid.Parse("6f8ce8dd-dffc-4ef5-84c4-fc99293e4a30");

    [Fact]
    public void BuildStateUsesCanonicalSequenceAndMarksCurrentPreviewAndNext()
    {
        var navigator = new OperatorRundownNavigator(Items());
        var state = navigator.BuildState(Snapshot(programId: "cue-b", previewId: "cue-c"));

        Assert.Equal([1, 2, 3], state.Rows.Select(row => row.Sequence).ToArray());
        Assert.Equal("cue-b", state.CurrentItemId);
        Assert.Equal("cue-c", state.PreviewItemId);
        Assert.Equal("cue-c", state.NextItemId);
        Assert.True(state.Rows.Single(row => row.Item.Id == "cue-b").IsCurrent);
        Assert.True(state.Rows.Single(row => row.Item.Id == "cue-c").IsPreview);
        Assert.True(state.Rows.Single(row => row.Item.Id == "cue-c").IsNext);
        Assert.False(state.ProgramIsAdHoc);
    }

    [Fact]
    public void SuccessfulTakeAdvancesExactlyOneCueWhileFailedTakeDoesNotMove()
    {
        var navigator = new OperatorRundownNavigator(Items());

        Assert.Equal("cue-c", navigator.AdvanceAfterTake("cue-b", "cue-b", takeSucceeded: true));
        Assert.Equal("cue-b", navigator.AdvanceAfterTake("cue-b", "cue-b", takeSucceeded: false));
        Assert.Equal("cue-c", navigator.AdvanceAfterSuccessfulTake("cue-b", "cue-b"));
    }

    [Fact]
    public void SuccessfulTakeAtLastCueKeepsLastCueSelected()
    {
        var navigator = new OperatorRundownNavigator(Items());

        Assert.Equal("cue-c", navigator.AdvanceAfterSuccessfulTake("cue-c", "cue-c"));
    }

    [Fact]
    public void AdHocProgramIsLabeledAndPreservesCanonicalSelection()
    {
        var navigator = new OperatorRundownNavigator(Items());
        var state = navigator.BuildState(Snapshot(programId: "ad-hoc-scripture", previewId: null));

        Assert.True(state.ProgramIsAdHoc);
        Assert.Equal("Ad-hoc Program", state.CurrentLabel);
        Assert.Null(state.CurrentItemId);
        Assert.Null(state.NextItemId);
        Assert.DoesNotContain(state.Rows, row => row.IsCurrent);
        Assert.Equal("cue-b", navigator.AdvanceAfterSuccessfulTake("cue-b", "ad-hoc-scripture"));
    }

    [Fact]
    public void FilteredViewKeepsCanonicalSequenceAndNextSemantics()
    {
        var navigator = new OperatorRundownNavigator(Items());
        var state = navigator.BuildState(
            Snapshot(programId: "cue-b", previewId: "cue-c"),
            visibleItemIds: ["cue-b", "cue-c"]);

        Assert.Equal([2, 3], state.Rows.Select(row => row.Sequence).ToArray());
        Assert.Equal("cue-b", state.CurrentItemId);
        Assert.Equal("cue-c", state.NextItemId);
        Assert.True(state.Rows.Single(row => row.Item.Id == "cue-c").IsNext);
    }

    [Fact]
    public void PreviewCanBeIndependentFromProgramAndNext()
    {
        var navigator = new OperatorRundownNavigator(Items());
        var state = navigator.BuildState(Snapshot(programId: "cue-a", previewId: "cue-c"));

        Assert.Equal("cue-a", state.CurrentItemId);
        Assert.Equal("cue-b", state.NextItemId);
        Assert.Equal("cue-c", state.PreviewItemId);
        Assert.True(state.Rows.Single(row => row.Item.Id == "cue-b").IsNext);
        Assert.True(state.Rows.Single(row => row.Item.Id == "cue-c").IsPreview);
    }

    private static IReadOnlyList<OperatorWorkspaceItem> Items() =>
    [
        new("cue-a", "Scripture", "John 3:16", "For God so loved", "WEBP", "SCRIPTURE"),
        new("cue-b", "Songs", "Amazing Grace", "Amazing grace", "John Newton", "SONG"),
        new("cue-c", "Slides", "Welcome", "Welcome home", null, "SLIDE")
    ];

    private static LocalOperatorSnapshot Snapshot(string? programId, string? previewId) => new(
        OutputRunning: true,
        Preview: previewId is null ? null : Render(previewId),
        Program: programId is null ? null : Render(programId),
        IsRecording: false,
        RecordingId: null,
        ConnectionStatus: "Online",
        ActiveServiceId: ServiceId,
        ServiceMode: "service",
        UpdatedAt: DateTimeOffset.Parse("2026-10-07T12:00:00Z"));

    private static PresentationRenderItem Render(string itemId) => new(
        itemId,
        ServiceId,
        "slide",
        itemId,
        $"Body {itemId}",
        null,
        new Dictionary<string, string>());
}
