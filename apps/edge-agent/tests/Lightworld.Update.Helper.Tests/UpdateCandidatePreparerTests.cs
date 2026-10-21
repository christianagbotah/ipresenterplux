using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lightworld.Update.Client;
using Lightworld.Update.Helper;
using Xunit;

namespace Lightworld.Update.Helper.Tests;

public sealed class UpdateCandidatePreparerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "lightworld-candidate-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task InvalidDeltaFallsBackToVerifiedFullPackageBeforeCurrentChanges()
    {
        var current = Path.Combine(_root, "current");
        Directory.CreateDirectory(current);
        await File.WriteAllTextAsync(Path.Combine(current, "app.txt"), "old");
        var delta = BuildBadDelta();
        var fullBytes = BuildFullPackage(("app.txt", "new"), ("added.txt", "full"));
        var fullHash = Convert.ToHexString(SHA256.HashData(fullBytes)).ToLowerInvariant();
        using var client = new HttpClient(new StaticHandler(fullBytes));
        var plan = new UpdatePlan(
            "ipresenterplux", "1.0.0", "1.1.0", delta, _root, "app.exe", "health_test", 30,
            new FileInfo(delta).Length, await ShaAsync(delta), 0, 30,
            UpdatePackageKind.Delta, "https://updates.example.test/full.zip", fullBytes.LongLength, fullHash).Normalize();

        var candidate = await new UpdateCandidatePreparer(client).PrepareAsync(plan, CancellationToken.None);

        Assert.Equal("new", await File.ReadAllTextAsync(Path.Combine(candidate, "app.txt")));
        Assert.Equal("full", await File.ReadAllTextAsync(Path.Combine(candidate, "added.txt")));
        Assert.Equal("old", await File.ReadAllTextAsync(Path.Combine(current, "app.txt")));
    }

    private string BuildBadDelta()
    {
        Directory.CreateDirectory(_root);
        var path = Path.Combine(_root, "bad.delta.zip");
        using var archive = ZipFile.Open(path, ZipArchiveMode.Create);
        var delta = new
        {
            schemaVersion = 1,
            fromVersion = "1.0.0",
            toVersion = "1.1.0",
            files = Array.Empty<object>(),
            deletedPaths = Array.Empty<string>(),
            resultCatalog = new[] { Entry("app.txt", "not-old") }
        };
        using var writer = new StreamWriter(archive.CreateEntry("delta.json").Open());
        writer.Write(JsonSerializer.Serialize(delta));
        return path;
    }

    private static byte[] BuildFullPackage(params (string Path, string Content)[] files)
    {
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var file in files)
            {
                using var writer = new StreamWriter(archive.CreateEntry(file.Path).Open(), Encoding.UTF8);
                writer.Write(file.Content);
            }
        }
        return output.ToArray();
    }

    private static object Entry(string path, string content)
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        return new { path, size = bytes.LongLength, sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() };
    }

    private static async Task<string> ShaAsync(string path)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private sealed class StaticHandler(byte[] body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(body)
            };
            response.Content.Headers.ContentLength = body.LongLength;
            return Task.FromResult(response);
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
