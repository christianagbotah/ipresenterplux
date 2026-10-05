namespace iPresenterPlux.Edge.Core.Contracts;

public sealed record PresentationRenderItem(
    string ItemId,
    Guid ServiceId,
    string ItemType,
    string Title,
    string Body,
    string? Footer,
    IReadOnlyDictionary<string, string> Metadata);
