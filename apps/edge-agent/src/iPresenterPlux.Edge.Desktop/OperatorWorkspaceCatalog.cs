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
}
