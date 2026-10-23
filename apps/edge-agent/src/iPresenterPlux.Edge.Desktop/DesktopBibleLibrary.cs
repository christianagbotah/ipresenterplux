using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;

namespace iPresenterPlux.Edge.Desktop;

public sealed record BiblePackageDescriptor(
    string Id,
    string Name,
    string Abbreviation,
    string LanguageCode,
    Uri? DownloadUri,
    string LicenseLabel,
    bool CanDownload,
    string AvailabilityLabel);

public sealed record DesktopBiblePassage(
    string Reference,
    string VersionId,
    string VersionAbbreviation,
    string Text);

public sealed record DesktopBibleBookDescriptor(string Code, string Name)
{
    public override string ToString() => Name;
}

public sealed record DesktopBibleVerse(int Verse, string Text)
{
    public override string ToString() => $"{Verse}  {Text}";
}

public sealed record DesktopBibleReference(
    string BookCode,
    string BookName,
    int Chapter,
    int? VerseStart,
    int? VerseEnd);

public sealed class DesktopBibleLibrary
{
    private const long MaxArchiveBytes = 16L * 1024 * 1024;
    private const long MaxVplBytes = 32L * 1024 * 1024;
    private readonly string _rootDirectory;
    private readonly HttpClient _httpClient;

    public static IReadOnlyList<BiblePackageDescriptor> Catalog { get; } =
    [
        Public("WEBP", "World English Bible", "WEB", "engwebp"),
        Public("WEBU", "World English Bible Updated", "WEBU", "engwebu"),
        Public("ASV", "American Standard Version (1901)", "ASV", "eng-asv"),
        Public("KJV", "King James Version", "KJV", "eng-kjv2006"),
        Public("BBE", "Bible in Basic English", "BBE", "engBBE"),
        Public("DBY", "Darby Translation", "DBY", "engDBY"),
        Public("DRA", "Douay-Rheims 1899", "DRV", "engDRA"),
        Public("GNV", "Geneva Bible 1599", "GNV", "enggnv"),
        Public("OEB", "Open English Bible (U.S.)", "OEB", "engoebus"),
        Public("WEBSTER", "Noah Webster Bible", "Webster", "engwebster"),
        Public("YLT", "Young's Literal Translation", "YLT", "engylt"),
        Public("JPS1917", "JPS TaNaKH 1917", "OJPS", "engjps"),
        Public("BRENTON", "Brenton Septuagint Translation", "Brenton", "eng-Brenton"),

        Restricted("NIV", "New International Version", "NIV", "Biblica/Zondervan"),
        Restricted("NKJV", "New King James Version", "NKJV", "Thomas Nelson"),
        Restricted("ESV", "English Standard Version", "ESV", "Crossway"),
        Restricted("NLT", "New Living Translation", "NLT", "Tyndale House"),
        Restricted("CSB", "Christian Standard Bible", "CSB", "Holman/B&H"),
        Restricted("NASB", "New American Standard Bible", "NASB", "Lockman Foundation"),
        Restricted("AMP", "Amplified Bible", "AMP", "Zondervan/Lockman"),
        Restricted("MSG", "The Message", "MSG", "NavPress"),
        Restricted("NRSVUE", "New Revised Standard Version Updated Edition", "NRSVue", "National Council of Churches/Friendship Press"),
        Restricted("RSV", "Revised Standard Version", "RSV", "National Council of Churches"),
        Restricted("NET", "NET Bible", "NET", "Biblical Studies Press"),
        Restricted("GNT", "Good News Translation", "GNT", "American Bible Society"),
        Restricted("CEV", "Contemporary English Version", "CEV", "American Bible Society"),
        Restricted("NCV", "New Century Version", "NCV", "Thomas Nelson")
    ];

    public static IReadOnlyList<BiblePackageDescriptor> Downloadable { get; } =
        Catalog.Where(package => package.CanDownload && package.DownloadUri is not null).ToArray();

    private static BiblePackageDescriptor Public(string id, string name, string abbreviation, string ebibleId) =>
        new(id, name, abbreviation, "en", new Uri($"https://ebible.org/Scriptures/{ebibleId}_vpl.zip"),
            "Public Domain", true, "One-click offline download");

    private static BiblePackageDescriptor Restricted(string id, string name, string abbreviation, string rightsHolder) =>
        new(id, name, abbreviation, "en", null, rightsHolder, false, "License/provider required");

    public DesktopBibleLibrary(string rootDirectory, HttpClient? httpClient = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(rootDirectory);
        _rootDirectory = Path.GetFullPath(rootDirectory);
        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(90) };
    }

    public bool IsInstalled(string versionId)
    {
        var package = Package(versionId);
        return package is not null && File.Exists(BiblePath(package.Id));
    }

    public IReadOnlyList<BiblePackageDescriptor> InstalledVersions() =>
        Downloadable.Where(package => File.Exists(BiblePath(package.Id))).ToArray();

    public IReadOnlyList<DesktopBibleBookDescriptor> ListBooks() =>
        BooksByAlias.Values
            .Distinct()
            .Select(book => new DesktopBibleBookDescriptor(book.Code, book.CanonicalName))
            .ToArray();

    public async Task<IReadOnlyList<int>> ListChaptersAsync(
        string versionId,
        string bookCodeOrName,
        CancellationToken cancellationToken)
    {
        var path = InstalledBiblePath(versionId);
        var book = ResolveBook(bookCodeOrName);
        if (path is null || book is null) return Array.Empty<int>();

        var chapters = new SortedSet<int>();
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, useAsync: true);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        while (await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false) is { } line)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (TryParseVplLine(line, out var code, out var chapter, out _, out _) &&
                string.Equals(code, book.Code, StringComparison.OrdinalIgnoreCase))
                chapters.Add(chapter);
        }
        return chapters.ToArray();
    }

    public async Task<IReadOnlyList<DesktopBibleVerse>> LoadChapterAsync(
        string versionId,
        string bookCodeOrName,
        int chapter,
        CancellationToken cancellationToken)
    {
        if (chapter <= 0) return Array.Empty<DesktopBibleVerse>();
        var path = InstalledBiblePath(versionId);
        var book = ResolveBook(bookCodeOrName);
        if (path is null || book is null) return Array.Empty<DesktopBibleVerse>();

        var verses = new List<DesktopBibleVerse>();
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, useAsync: true);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        while (await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false) is { } line)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!TryParseVplLine(line, out var code, out var candidateChapter, out var verse, out var text)) continue;
            if (!string.Equals(code, book.Code, StringComparison.OrdinalIgnoreCase) || candidateChapter != chapter) continue;
            verses.Add(new DesktopBibleVerse(verse, text));
        }
        return verses.OrderBy(item => item.Verse).ToArray();
    }

    public Task<DesktopBiblePassage?> ResolveRangeAsync(
        string versionId,
        string bookCodeOrName,
        int chapter,
        int verseStart,
        int verseEnd,
        CancellationToken cancellationToken)
    {
        var book = ResolveBook(bookCodeOrName);
        if (book is null || chapter <= 0 || verseStart <= 0 || verseEnd < verseStart)
            return Task.FromResult<DesktopBiblePassage?>(null);
        var reference = verseStart == verseEnd
            ? $"{book.CanonicalName} {chapter}:{verseStart}"
            : $"{book.CanonicalName} {chapter}:{verseStart}-{verseEnd}";
        return ResolveAsync(reference, versionId, cancellationToken);
    }

    public async Task InstallAsync(string versionId, CancellationToken cancellationToken)
    {
        var package = Package(versionId)
            ?? throw new ArgumentException("Bible version is not available.", nameof(versionId));
        if (!package.CanDownload || package.DownloadUri is null)
            throw new InvalidOperationException("This Bible edition requires a licensed/provider source and cannot be downloaded by iPresenterPlux.");
        if (!string.Equals(package.DownloadUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Bible packages must use HTTPS.");

        using var request = new HttpRequestMessage(HttpMethod.Get, package.DownloadUri);
        request.Headers.UserAgent.ParseAdd("Mozilla/5.0 (compatible; iPresenterPlux/1.0; +https://lightworldtech.com)");
        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is > MaxArchiveBytes)
            throw new InvalidDataException("Bible package exceeds the maximum download size.");

        await using var responseStream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        await using var archiveBuffer = new MemoryStream();
        await CopyBoundedAsync(responseStream, archiveBuffer, MaxArchiveBytes, cancellationToken).ConfigureAwait(false);
        archiveBuffer.Position = 0;

        using var archive = new ZipArchive(archiveBuffer, ZipArchiveMode.Read, leaveOpen: true);
        var vplEntries = archive.Entries
            .Where(entry =>
                !string.IsNullOrWhiteSpace(entry.Name) &&
                entry.Name.EndsWith("_vpl.txt", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        if (vplEntries.Length != 1)
            throw new InvalidDataException("Bible package must contain exactly one VPL text file.");

        var vpl = vplEntries[0];
        if (vpl.Length is <= 0 or > MaxVplBytes)
            throw new InvalidDataException("Bible VPL text has an invalid size.");

        var versionDirectory = VersionDirectory(package.Id);
        Directory.CreateDirectory(versionDirectory);
        var target = BiblePath(package.Id);
        var temporary = Path.Combine(versionDirectory, $"bible-{Guid.NewGuid():N}.tmp");
        try
        {
            await using (var input = vpl.Open())
            await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, useAsync: true))
            {
                await CopyBoundedAsync(input, output, MaxVplBytes, cancellationToken).ConfigureAwait(false);
                await output.FlushAsync(cancellationToken).ConfigureAwait(false);
            }

            if (!await ContainsValidVerseAsync(temporary, cancellationToken).ConfigureAwait(false))
                throw new InvalidDataException("Bible VPL text did not contain a valid verse.");

            File.Move(temporary, target, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    public async Task<DesktopBiblePassage?> ResolveAsync(
        string reference,
        string? versionId,
        CancellationToken cancellationToken)
    {
        if (!TryParseReference(reference, out var parsed)) return null;
        var package = Package(versionId);
        if (package is null) return null;
        var path = BiblePath(package.Id);
        if (!File.Exists(path)) return null;

        var verses = new List<(int Verse, string Text)>();
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, useAsync: true);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        while (await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false) is { } line)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!TryParseVplLine(line, out var code, out var chapter, out var verse, out var text)) continue;
            if (!string.Equals(code, parsed.Book.Code, StringComparison.OrdinalIgnoreCase) || chapter != parsed.Chapter) continue;
            if (parsed.VerseStart is { } start && (verse < start || verse > parsed.VerseEnd!.Value)) continue;
            verses.Add((verse, text));
        }

        if (verses.Count == 0) return null;
        verses.Sort((left, right) => left.Verse.CompareTo(right.Verse));
        if (parsed.VerseStart is { } requestedStart)
        {
            var requestedEnd = parsed.VerseEnd!.Value;
            var expected = requestedEnd - requestedStart + 1;
            if (expected is <= 0 or > 80 || verses.Count != expected ||
                verses[0].Verse != requestedStart || verses[^1].Verse != requestedEnd)
                return null;
            for (var i = 1; i < verses.Count; i++)
                if (verses[i].Verse != verses[i - 1].Verse + 1) return null;
        }

        var canonicalReference = parsed.VerseStart is null
            ? $"{parsed.Book.CanonicalName} {parsed.Chapter}"
            : parsed.VerseStart == parsed.VerseEnd
                ? $"{parsed.Book.CanonicalName} {parsed.Chapter}:{parsed.VerseStart}"
                : $"{parsed.Book.CanonicalName} {parsed.Chapter}:{parsed.VerseStart}-{parsed.VerseEnd}";
        var body = string.Join(" ", verses.Select(item => item.Text.Trim()).Where(text => text.Length > 0));
        return body.Length == 0
            ? null
            : new DesktopBiblePassage(canonicalReference, package.Id, package.Abbreviation, body);
    }

    private string VersionDirectory(string id) => Path.Combine(_rootDirectory, id.ToUpperInvariant());
    private string BiblePath(string id) => Path.Combine(VersionDirectory(id), "bible.vpl");

    private string? InstalledBiblePath(string? versionId)
    {
        var package = Package(versionId);
        if (package is null) return null;
        var path = BiblePath(package.Id);
        return File.Exists(path) ? path : null;
    }

    private static BibleBook? ResolveBook(string? codeOrName)
    {
        if (string.IsNullOrWhiteSpace(codeOrName)) return null;
        return BooksByAlias.TryGetValue(NormalizeBook(codeOrName), out var book) ? book : null;
    }

    private static BiblePackageDescriptor? Package(string? versionId)
    {
        if (string.IsNullOrWhiteSpace(versionId)) return null;
        var normalized = versionId.Trim();
        return Catalog.FirstOrDefault(package =>
            string.Equals(package.Id, normalized, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(package.Abbreviation, normalized, StringComparison.OrdinalIgnoreCase));
    }

    private static async Task CopyBoundedAsync(Stream input, Stream output, long maximumBytes, CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        long total = 0;
        while (true)
        {
            var read = await input.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            total += read;
            if (total > maximumBytes) throw new InvalidDataException("Bible package content exceeds the maximum allowed size.");
            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
        }
    }

    private static async Task<bool> ContainsValidVerseAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 16 * 1024, useAsync: true);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        for (var i = 0; i < 500 && await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false) is { } line; i++)
            if (TryParseVplLine(line, out _, out _, out _, out _)) return true;
        return false;
    }

    private static bool TryParseVplLine(string line, out string code, out int chapter, out int verse, out string text)
    {
        code = string.Empty;
        chapter = 0;
        verse = 0;
        text = string.Empty;
        if (string.IsNullOrWhiteSpace(line)) return false;
        var firstSpace = line.IndexOf(' ');
        if (firstSpace is < 2 or > 4) return false;
        code = line[..firstSpace].Trim().ToUpperInvariant();
        var secondSpace = line.IndexOf(' ', firstSpace + 1);
        if (secondSpace < 0) return false;
        var address = line[(firstSpace + 1)..secondSpace];
        var colon = address.IndexOf(':');
        if (colon <= 0 || colon == address.Length - 1) return false;
        if (!int.TryParse(address[..colon], out chapter) || chapter <= 0) return false;
        if (!int.TryParse(address[(colon + 1)..], out verse) || verse <= 0) return false;
        text = line[(secondSpace + 1)..].Trim();
        return text.Length > 0;
    }

    private static readonly Regex ReferencePattern = new(
        @"^(?<book>.+?)\s+(?<chapter>[1-9]\d{0,2})(?::(?<start>[1-9]\d{0,2})(?:-(?<end>[1-9]\d{0,2}))?)?$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    private sealed record BibleBook(string Code, string CanonicalName, params string[] Aliases);
    private sealed record ParsedReference(BibleBook Book, int Chapter, int? VerseStart, int? VerseEnd);

    private static bool TryParseReference(string? reference, out ParsedReference parsed)
    {
        parsed = null!;
        if (string.IsNullOrWhiteSpace(reference)) return false;
        var match = ReferencePattern.Match(reference.Trim());
        if (!match.Success || !int.TryParse(match.Groups["chapter"].Value, out var chapter)) return false;
        var bookKey = NormalizeBook(match.Groups["book"].Value);
        if (!BooksByAlias.TryGetValue(bookKey, out var book)) return false;

        int? start = null;
        int? end = null;
        if (match.Groups["start"].Success)
        {
            start = int.Parse(match.Groups["start"].Value);
            end = match.Groups["end"].Success ? int.Parse(match.Groups["end"].Value) : start;
            if (end < start || end - start + 1 > 80) return false;
        }
        parsed = new ParsedReference(book, chapter, start, end);
        return true;
    }

    public static bool TryDescribeReference(string? reference, out DesktopBibleReference described)
    {
        described = null!;
        if (!TryParseReference(reference, out var parsed)) return false;
        described = new DesktopBibleReference(
            parsed.Book.Code,
            parsed.Book.CanonicalName,
            parsed.Chapter,
            parsed.VerseStart,
            parsed.VerseEnd);
        return true;
    }

    private static string NormalizeBook(string value) =>
        new(value.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());

    private static readonly IReadOnlyDictionary<string, BibleBook> BooksByAlias = BuildBookMap();

    private static IReadOnlyDictionary<string, BibleBook> BuildBookMap()
    {
        BibleBook[] books =
        [
            new("GEN", "Genesis", "Gen"), new("EXO", "Exodus", "Exod", "Ex"), new("LEV", "Leviticus", "Lev"),
            new("NUM", "Numbers", "Num"), new("DEU", "Deuteronomy", "Deut"), new("JOS", "Joshua", "Josh"),
            new("JDG", "Judges", "Judg", "Jdg"), new("RUT", "Ruth", "Rth"), new("1SA", "1 Samuel", "1 Sam", "1Sa"),
            new("2SA", "2 Samuel", "2 Sam", "2Sa"), new("1KI", "1 Kings", "1 Kgs", "1Ki"), new("2KI", "2 Kings", "2 Kgs", "2Ki"),
            new("1CH", "1 Chronicles", "1 Chron", "1 Chr", "1Ch"), new("2CH", "2 Chronicles", "2 Chron", "2 Chr", "2Ch"),
            new("EZR", "Ezra"), new("NEH", "Nehemiah", "Neh"), new("EST", "Esther", "Est"), new("JOB", "Job"),
            new("PSA", "Psalm", "Psalms", "Ps", "Psa"), new("PRO", "Proverbs", "Prov", "Pr"),
            new("ECC", "Ecclesiastes", "Eccl", "Ecc"), new("SOL", "Song of Solomon", "Song of Songs", "Song", "SOS"),
            new("ISA", "Isaiah", "Isa"), new("JER", "Jeremiah", "Jer"), new("LAM", "Lamentations", "Lam"),
            new("EZE", "Ezekiel", "Ezek", "Eze"), new("DAN", "Daniel", "Dan"), new("HOS", "Hosea", "Hos"),
            new("JOE", "Joel", "Joe"), new("AMO", "Amos", "Amo"), new("OBA", "Obadiah", "Obad", "Oba"),
            new("JON", "Jonah", "Jon"), new("MIC", "Micah", "Mic"), new("NAH", "Nahum", "Nah"),
            new("HAB", "Habakkuk", "Hab"), new("ZEP", "Zephaniah", "Zeph", "Zep"), new("HAG", "Haggai", "Hag"),
            new("ZEC", "Zechariah", "Zech", "Zec"), new("MAL", "Malachi", "Mal"), new("MAT", "Matthew", "Matt", "Mt"),
            new("MAR", "Mark", "Mrk", "Mk"), new("LUK", "Luke", "Lk"), new("JOH", "John", "Jn", "Jhn"),
            new("ACT", "Acts", "Act"), new("ROM", "Romans", "Rom"), new("1CO", "1 Corinthians", "1 Cor", "1Co"),
            new("2CO", "2 Corinthians", "2 Cor", "2Co"), new("GAL", "Galatians", "Gal"), new("EPH", "Ephesians", "Eph"),
            new("PHI", "Philippians", "Phil", "Php"), new("COL", "Colossians", "Col"),
            new("1TH", "1 Thessalonians", "1 Thess", "1 Thes", "1Th"), new("2TH", "2 Thessalonians", "2 Thess", "2 Thes", "2Th"),
            new("1TI", "1 Timothy", "1 Tim", "1Ti"), new("2TI", "2 Timothy", "2 Tim", "2Ti"), new("TIT", "Titus", "Tit"),
            new("PHM", "Philemon", "Phlm", "Phm"), new("HEB", "Hebrews", "Heb"), new("JAM", "James", "Jas", "Jam"),
            new("1PE", "1 Peter", "1 Pet", "1Pe"), new("2PE", "2 Peter", "2 Pet", "2Pe"),
            new("1JO", "1 John", "1 Jn", "1Jn", "1Jo"), new("2JO", "2 John", "2 Jn", "2Jn", "2Jo"),
            new("3JO", "3 John", "3 Jn", "3Jn", "3Jo"), new("JUD", "Jude", "Jud"), new("REV", "Revelation", "Rev")
        ];
        var map = new Dictionary<string, BibleBook>(StringComparer.OrdinalIgnoreCase);
        foreach (var book in books)
        {
            map[NormalizeBook(book.CanonicalName)] = book;
            map[NormalizeBook(book.Code)] = book;
            foreach (var alias in book.Aliases) map[NormalizeBook(alias)] = book;
        }
        return map;
    }
}
