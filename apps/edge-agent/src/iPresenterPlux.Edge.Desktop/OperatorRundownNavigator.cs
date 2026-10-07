using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Desktop;

public sealed record OperatorRundownRow(
    OperatorWorkspaceItem Item,
    int Sequence,
    bool IsCurrent,
    bool IsPreview,
    bool IsNext)
{
    public string StatusLabel
    {
        get
        {
            var labels = new List<string>(3);
            if (IsCurrent) labels.Add("CURRENT");
            if (IsPreview) labels.Add("PREVIEW");
            if (IsNext) labels.Add("NEXT");
            return string.Join(" · ", labels);
        }
    }

    public override string ToString()
    {
        var prefix = Sequence.ToString("00");
        return string.IsNullOrWhiteSpace(StatusLabel)
            ? $"{prefix}  {Item.Title}"
            : $"{prefix}  {Item.Title}   [{StatusLabel}]";
    }
}

public sealed record OperatorRundownState(
    IReadOnlyList<OperatorRundownRow> Rows,
    string? CurrentItemId,
    string? PreviewItemId,
    string? NextItemId,
    string CurrentLabel,
    bool ProgramIsAdHoc);

public sealed class OperatorRundownNavigator
{
    private readonly IReadOnlyList<OperatorWorkspaceItem> _items;
    private readonly IReadOnlyDictionary<string, int> _indexById;

    public OperatorRundownNavigator(IEnumerable<OperatorWorkspaceItem> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        _items = items.ToArray();
        var indexById = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var index = 0; index < _items.Count; index++)
        {
            var item = _items[index];
            if (string.IsNullOrWhiteSpace(item.Id))
                throw new ArgumentException("Rundown item ids cannot be blank.", nameof(items));
            if (!indexById.TryAdd(item.Id, index))
                throw new ArgumentException($"Rundown contains duplicate item id '{item.Id}'.", nameof(items));
        }
        _indexById = indexById;
    }

    public IReadOnlyList<OperatorWorkspaceItem> Items => _items;

    public OperatorRundownState BuildState(
        LocalOperatorSnapshot snapshot,
        IEnumerable<string>? visibleItemIds = null)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        var programId = snapshot.Program?.ItemId;
        var previewId = snapshot.Preview?.ItemId;
        var currentIndex = -1;
        var hasCurrent = programId is not null && _indexById.TryGetValue(programId, out currentIndex);
        var programIsAdHoc = programId is not null && !hasCurrent;
        var currentItemId = hasCurrent ? programId : null;
        var nextItemId = hasCurrent && currentIndex + 1 < _items.Count
            ? _items[currentIndex + 1].Id
            : null;
        var previewItemId = previewId is not null && _indexById.ContainsKey(previewId)
            ? previewId
            : null;

        HashSet<string>? visible = null;
        if (visibleItemIds is not null)
            visible = new HashSet<string>(visibleItemIds, StringComparer.Ordinal);

        var rows = _items
            .Select((item, index) => new OperatorRundownRow(
                item,
                index + 1,
                item.Id.Equals(currentItemId, StringComparison.Ordinal),
                item.Id.Equals(previewItemId, StringComparison.Ordinal),
                item.Id.Equals(nextItemId, StringComparison.Ordinal)))
            .Where(row => visible is null || visible.Contains(row.Item.Id))
            .ToArray();

        var currentLabel = programIsAdHoc
            ? "Ad-hoc Program"
            : hasCurrent
                ? _items[currentIndex].Title
                : "Program clear";

        return new OperatorRundownState(
            rows,
            currentItemId,
            previewItemId,
            nextItemId,
            currentLabel,
            programIsAdHoc);
    }

    public string? AdvanceAfterTake(
        string? currentSelectionId,
        string? programItemId,
        bool takeSucceeded) =>
        takeSucceeded
            ? AdvanceAfterSuccessfulTake(currentSelectionId, programItemId)
            : currentSelectionId;

    public string? AdvanceAfterSuccessfulTake(string? currentSelectionId, string? programItemId)
    {
        if (string.IsNullOrWhiteSpace(currentSelectionId) ||
            string.IsNullOrWhiteSpace(programItemId) ||
            !string.Equals(currentSelectionId, programItemId, StringComparison.Ordinal) ||
            !_indexById.TryGetValue(programItemId, out var currentIndex))
            return currentSelectionId;

        return currentIndex + 1 < _items.Count
            ? _items[currentIndex + 1].Id
            : currentSelectionId;
    }

    public string? MoveSelection(string? currentSelectionId, int delta)
    {
        if (_items.Count == 0) return null;
        if (delta == 0) return currentSelectionId ?? _items[0].Id;

        if (currentSelectionId is null || !_indexById.TryGetValue(currentSelectionId, out var currentIndex))
            return delta > 0 ? _items[0].Id : _items[^1].Id;

        var target = Math.Clamp(currentIndex + Math.Sign(delta), 0, _items.Count - 1);
        return _items[target].Id;
    }
}
