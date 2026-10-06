namespace iPresenterPlux.Edge.Core.Runtime;

public sealed record OperatorCatalogService(
    Guid ServiceId,
    string Title,
    string Status,
    string ActiveBibleVersion,
    DateTimeOffset? ScheduledStart,
    DateTimeOffset? StartedAt);

public sealed record OperatorBibleVersion(
    string Id,
    string Name,
    string Abbreviation,
    string LanguageCode);

public sealed record OperatorCatalogItem(
    string ItemId,
    string ItemType,
    string Title,
    string Body,
    string? Footer,
    IReadOnlyDictionary<string, string> Metadata);

public sealed record OperatorCatalogSnapshot(
    int SchemaVersion,
    DateTimeOffset SyncedAt,
    DateTimeOffset ObservedAt,
    string CatalogRevision,
    OperatorCatalogService? Service,
    IReadOnlyList<OperatorBibleVersion> BibleVersions,
    IReadOnlyList<OperatorCatalogItem> Items,
    IReadOnlyList<OperatorCatalogItem> ScriptureQueue)
{
    public const int CurrentSchemaVersion = 1;

    public bool IsStale(DateTimeOffset now, TimeSpan maxAge)
    {
        if (maxAge <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(maxAge));
        return now > SyncedAt && now - SyncedAt > maxAge;
    }
}
