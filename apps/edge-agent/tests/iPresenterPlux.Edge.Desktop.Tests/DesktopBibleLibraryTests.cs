using System.IO.Compression;
using System.Net;
using System.Net.Http;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class DesktopBibleLibraryTests
{
    [Fact]
    public async Task InstallsPublicDomainPackageAndResolvesCommonReferencesOffline()
    {
        var root = Path.Combine(Path.GetTempPath(), "ipresenterplux-bible-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var http = new HttpClient(new StaticZipHandler(BuildVplZip(new[]
            {
                "PSA 23:1 The Lord is my shepherd; I shall not want.",
                "PSA 23:2 He makes me lie down in green pastures.",
                "JOH 3:16 For God so loved the world.",
                "1JO 4:8 He who does not love does not know God."
            })));
            var library = new DesktopBibleLibrary(root, http);

            await library.InstallAsync("WEBP", CancellationToken.None);

            Assert.True(library.IsInstalled("WEBP"));
            var psalm = await library.ResolveAsync("Psalm 23", "WEBP", CancellationToken.None);
            Assert.NotNull(psalm);
            Assert.Equal("Psalm 23", psalm.Reference);
            Assert.Contains("The Lord is my shepherd", psalm.Text, StringComparison.Ordinal);
            Assert.Contains("green pastures", psalm.Text, StringComparison.Ordinal);

            var john = await library.ResolveAsync("John 3:16", "WEBP", CancellationToken.None);
            Assert.NotNull(john);
            Assert.Equal("John 3:16", john.Reference);
            Assert.Equal("WEB", john.VersionAbbreviation);

            var firstJohn = await library.ResolveAsync("1 John 4:8", "WEBP", CancellationToken.None);
            Assert.NotNull(firstJohn);
            Assert.Equal("1 John 4:8", firstJohn.Reference);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ResolvesVerseRangesAndRejectsInvalidRanges()
    {
        var root = Path.Combine(Path.GetTempPath(), "ipresenterplux-bible-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var http = new HttpClient(new StaticZipHandler(BuildVplZip(new[]
            {
                "JOH 3:16 Verse sixteen.",
                "JOH 3:17 Verse seventeen.",
                "JOH 3:18 Verse eighteen."
            })));
            var library = new DesktopBibleLibrary(root, http);
            await library.InstallAsync("WEBP", CancellationToken.None);

            var range = await library.ResolveAsync("John 3:16-18", "WEBP", CancellationToken.None);
            Assert.NotNull(range);
            Assert.Equal("John 3:16-18", range.Reference);
            Assert.Equal("Verse sixteen. Verse seventeen. Verse eighteen.", range.Text);

            Assert.Null(await library.ResolveAsync("John 3:18-16", "WEBP", CancellationToken.None));
            Assert.Null(await library.ResolveAsync("Unknown 1:1", "WEBP", CancellationToken.None));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task FailedPackageValidationDoesNotReplaceInstalledEdition()
    {
        var root = Path.Combine(Path.GetTempPath(), "ipresenterplux-bible-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var good = BuildVplZip(new[] { "JOH 3:16 Original text." });
            using (var http = new HttpClient(new StaticZipHandler(good)))
            {
                var library = new DesktopBibleLibrary(root, http);
                await library.InstallAsync("WEBP", CancellationToken.None);
            }

            using (var http = new HttpClient(new StaticZipHandler(BuildZipWithoutVpl())))
            {
                var library = new DesktopBibleLibrary(root, http);
                await Assert.ThrowsAsync<InvalidDataException>(() => library.InstallAsync("WEBP", CancellationToken.None));
                var passage = await library.ResolveAsync("John 3:16", "WEBP", CancellationToken.None);
                Assert.NotNull(passage);
                Assert.Equal("Original text.", passage.Text);
            }
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task BrowsesInstalledBibleByBookChapterAndVerse()
    {
        var root = Path.Combine(Path.GetTempPath(), "ipresenterplux-bible-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var http = new HttpClient(new StaticZipHandler(BuildVplZip(new[]
            {
                "GEN 1:1 In the beginning.",
                "GEN 1:2 The earth was formless.",
                "GEN 2:1 The heavens and earth were finished.",
                "JOH 3:16 For God so loved the world.",
                "JOH 3:17 God did not send his Son to condemn the world."
            })));
            var library = new DesktopBibleLibrary(root, http);
            await library.InstallAsync("WEBP", CancellationToken.None);

            var books = library.ListBooks();
            Assert.Contains(books, book => book.Code == "GEN" && book.Name == "Genesis");
            Assert.Contains(books, book => book.Code == "JOH" && book.Name == "John");

            var chapters = await library.ListChaptersAsync("WEBP", "JOH", CancellationToken.None);
            Assert.Equal(new[] { 3 }, chapters);

            var verses = await library.LoadChapterAsync("WEBP", "JOH", 3, CancellationToken.None);
            Assert.Equal(2, verses.Count);
            Assert.Equal(16, verses[0].Verse);
            Assert.Contains("loved the world", verses[0].Text, StringComparison.Ordinal);

            var range = await library.ResolveRangeAsync("WEBP", "JOH", 3, 16, 17, CancellationToken.None);
            Assert.NotNull(range);
            Assert.Equal("John 3:16-17", range.Reference);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void CatalogSeparatesRedistributableAndLicensedEditions()
    {
        Assert.True(DesktopBibleLibrary.Catalog.Count >= 20);
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "WEBP" && package.CanDownload);
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "BBE" && package.CanDownload);
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "DBY" && package.CanDownload);
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "DRA" && package.CanDownload);
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "GNV" && package.CanDownload);
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "OEB" && package.CanDownload);
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "WEBSTER" && package.CanDownload);
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "YLT" && package.CanDownload);
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "FRA-LSG" && package.CanDownload && package.LanguageCode == "fr");
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "FRA-SBL" && package.CanDownload && package.LanguageCode == "fr");
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "FRA-OST" && package.CanDownload && package.LanguageCode == "fr");
        Assert.Contains(DesktopBibleLibrary.Catalog, package => package.Id == "FRA-JND" && package.CanDownload && package.LanguageCode == "fr");

        foreach (var id in new[] { "NIV", "NKJV", "ESV", "NLT", "CSB", "NASB", "AMP", "MSG", "NRSVUE", "TWI-AKUAPEM", "TWI-ASANTE", "EWE-OAL" })
        {
            var edition = Assert.Single(DesktopBibleLibrary.Catalog.Where(package => package.Id == id));
            Assert.False(edition.CanDownload);
            Assert.Null(edition.DownloadUri);
            Assert.Contains("required", edition.AvailabilityLabel, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void DownloadCatalogContainsOnlyHttpsRedistributablePackages()
    {
        Assert.True(DesktopBibleLibrary.Downloadable.Count >= 10);
        Assert.All(DesktopBibleLibrary.Downloadable, package =>
        {
            Assert.True(package.CanDownload);
            Assert.NotNull(package.DownloadUri);
            Assert.Equal(Uri.UriSchemeHttps, package.DownloadUri!.Scheme);
            Assert.DoesNotContain("required", package.AvailabilityLabel, StringComparison.OrdinalIgnoreCase);
        });
        Assert.Equal("https://ebible.org/Scriptures/eng-kjv2006_vpl.zip",
            DesktopBibleLibrary.Downloadable.Single(package => package.Id == "KJV").DownloadUri!.ToString());
    }

    [Fact]
    public void RestrictedEditionCannotBeInstalledThroughLibraryApi()
    {
        var root = Path.Combine(Path.GetTempPath(), "ipresenterplux-bible-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var http = new HttpClient(new StaticZipHandler(BuildVplZip(new[] { "JOH 3:16 Test." })));
            var library = new DesktopBibleLibrary(root, http);
            Assert.ThrowsAsync<InvalidOperationException>(() => library.InstallAsync("NIV", CancellationToken.None)).GetAwaiter().GetResult();
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static byte[] BuildVplZip(IEnumerable<string> lines)
    {
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry("sample_vpl.txt");
            using var writer = new StreamWriter(entry.Open());
            foreach (var line in lines) writer.WriteLine(line);
        }
        return output.ToArray();
    }

    private static byte[] BuildZipWithoutVpl()
    {
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry("readme.txt");
            using var writer = new StreamWriter(entry.Open());
            writer.Write("not a bible package");
        }
        return output.ToArray();
    }

    private sealed class StaticZipHandler(byte[] body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(body),
                RequestMessage = request
            };
            response.Content.Headers.ContentLength = body.Length;
            return Task.FromResult(response);
        }
    }
}
