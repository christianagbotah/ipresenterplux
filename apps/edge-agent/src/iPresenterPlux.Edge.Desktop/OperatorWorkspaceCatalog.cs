using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Desktop;

public sealed record OperatorWorkspaceItem(
    string Id,
    string Category,
    string Title,
    string Body,
    string? Footer,
    string Accent)
{
    public LocalOperatorPresentation ToPresentation() =>
        new(Id, Category.ToLowerInvariant(), Title, Body, Footer);

    public override string ToString() => Title;
}

public sealed record OperatorWorkspaceView(
    IReadOnlyList<OperatorWorkspaceItem> Items,
    IReadOnlyList<OperatorBibleVersion> BibleVersions,
    string? ActiveBibleVersion,
    string? ServiceTitle,
    string? ServiceStatus,
    bool HasSyncedCatalog,
    bool IsRehearsal,
    bool IsStale,
    string StatusLabel);

public static class OperatorWorkspaceCatalog
{
    public static IReadOnlyList<OperatorWorkspaceItem> Seeded { get; } = new[]
    {
        new OperatorWorkspaceItem(
            "scripture-john-3-16", "Scripture", "John 3:16",
            "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
            "KJV", "SCRIPTURE"),
        new OperatorWorkspaceItem(
            "scripture-psalm-23-1", "Scripture", "Psalm 23:1",
            "The Lord is my shepherd; I shall not want.",
            "KJV", "SCRIPTURE"),
        new OperatorWorkspaceItem(
            "scripture-isaiah-40-31", "Scripture", "Isaiah 40:31",
            "But they that wait upon the Lord shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.",
            "KJV", "SCRIPTURE"),
        new OperatorWorkspaceItem(
            "slide-welcome", "Slides", "Welcome to Service",
            "We are glad you are here.\nPrepare your heart for worship, the Word and fellowship.",
            "iPresenterPlux", "SLIDE"),
        new OperatorWorkspaceItem(
            "slide-offering", "Slides", "Offering & Giving",
            "Thank you for giving faithfully.\nPlease follow the church's approved giving channels shown on the main screen.",
            "Service moment", "SLIDE"),
        new OperatorWorkspaceItem(
            "song-amazing-grace", "Songs", "Amazing Grace",
            "Amazing grace! how sweet the sound,\nThat saved a wretch like me!\nI once was lost, but now am found;\nWas blind, but now I see.",
            "Verse 1", "SONG"),
        new OperatorWorkspaceItem(
            "announcement-midweek", "Announcements", "Midweek Service",
            "Join us for our midweek service.\nBring a friend and come ready for prayer, teaching and fellowship.",
            "Announcement", "NOTICE"),
        new OperatorWorkspaceItem(
            "media-placeholder", "Media", "Media cue placeholder",
            "Media library sync will populate local video, image and lower-third cues here.",
            "Media foundation", "MEDIA")
    };

    public static IReadOnlyList<string> Categories { get; } =
        new[] { "All", "Scripture", "Songs", "Slides", "Media", "Announcements" };

    public static OperatorWorkspaceView FromCatalog(OperatorCatalogSnapshot? catalog, bool stale)
    {
        if (catalog is null)
        {
            return new OperatorWorkspaceView(
                Seeded, [], null, "Local rehearsal", "rehearsal",
                HasSyncedCatalog: false, IsRehearsal: true, IsStale: false,
                StatusLabel: "LOCAL REHEARSAL");
        }

        var activeVersion = string.IsNullOrWhiteSpace(catalog.Service?.ActiveBibleVersion)
            ? catalog.BibleVersions.FirstOrDefault()?.Abbreviation
            : catalog.Service.ActiveBibleVersion;

        var items = catalog.Service is null
            ? Array.Empty<OperatorWorkspaceItem>()
            : catalog.Items
                .Concat(catalog.ScriptureQueue)
                .GroupBy(item => item.ItemId, StringComparer.Ordinal)
                .Select(group => FromResolved(group.First()))
                .ToArray();

        var status = catalog.Service is null
            ? "NO ACTIVE SERVICE"
            : stale ? "OFFLINE CACHE" : "LIVE CATALOG";

        return new OperatorWorkspaceView(
            items, catalog.BibleVersions, activeVersion, catalog.Service?.Title, catalog.Service?.Status,
            HasSyncedCatalog: true, IsRehearsal: false, IsStale: stale, StatusLabel: status);
    }

    public static IReadOnlyList<OperatorWorkspaceItem> Filter(
        IEnumerable<OperatorWorkspaceItem> items,
        string? category,
        string? query)
    {
        ArgumentNullException.ThrowIfNull(items);
        var selectedCategory = string.IsNullOrWhiteSpace(category) ? "All" : category.Trim();
        var search = query?.Trim() ?? string.Empty;

        return items.Where(item =>
                (selectedCategory.Equals("All", StringComparison.OrdinalIgnoreCase) ||
                 item.Category.Equals(selectedCategory, StringComparison.OrdinalIgnoreCase)) &&
                (search.Length == 0 ||
                 item.Title.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                 item.Body.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                 item.Category.Contains(search, StringComparison.OrdinalIgnoreCase)))
            .ToArray();
    }

    public static OperatorWorkspaceItem FromResolved(OperatorCatalogItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        var (category, accent) = PresentationKind(item.ItemType);
        return new OperatorWorkspaceItem(
            item.ItemId, category, item.Title, item.Body, item.Footer, accent);
    }

    private static (string Category, string Accent) PresentationKind(string? itemType) =>
        itemType?.Trim().ToLowerInvariant() switch
        {
            "scripture" or "bible" => ("Scripture", "SCRIPTURE"),
            "song" or "lyrics" => ("Songs", "SONG"),
            "media" or "video" or "image" => ("Media", "MEDIA"),
            "announcement" or "notice" => ("Announcements", "NOTICE"),
            _ => ("Slides", "SLIDE")
        };
}
