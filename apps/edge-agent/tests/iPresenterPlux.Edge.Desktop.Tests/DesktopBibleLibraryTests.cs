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
            Assert.Equal("WEBP", john.VersionAbbreviation);

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
    public void DownloadCatalogContainsOnlyHttpsPublicDomainPackages()
    {
        Assert.NotEmpty(DesktopBibleLibrary.Downloadable);
        Assert.All(DesktopBibleLibrary.Downloadable, package =>
        {
            Assert.Equal(Uri.UriSchemeHttps, package.DownloadUri.Scheme);
            Assert.Equal("Public Domain", package.LicenseLabel);
        });
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
