using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Lightworld.Update.Helper;
using Xunit;

namespace Lightworld.Update.Helper.Tests;

public sealed class FileDeltaApplierTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "lightworld-delta-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task ClonesCurrentThenAppliesChangedAddedAndDeletedFiles()
    {
        var current = Current(
            ("keep.txt", "keep"),
            ("change.txt", "old"),
            ("delete.txt", "remove"));
        var expected = new Dictionary<string, string>
        {
            ["keep.txt"] = "keep",
            ["change.txt"] = "new-value",
            ["added.txt"] = "added"
        };
        var package = DeltaZip(
            "1.0.0", "1.1.0",
            new Dictionary<string, string> { ["change.txt"] = "new-value", ["added.txt"] = "added" },
            ["delete.txt"], expected);

        var candidate = await new FileDeltaApplier(_root).PrepareCandidateAsync(
            package, "1.0.0", "1.1.0", "delta_ok", CancellationToken.None);

        Assert.Equal("keep", await File.ReadAllTextAsync(Path.Combine(candidate, "keep.txt")));
        Assert.Equal("new-value", await File.ReadAllTextAsync(Path.Combine(candidate, "change.txt")));
        Assert.Equal("added", await File.ReadAllTextAsync(Path.Combine(candidate, "added.txt")));
        Assert.False(File.Exists(Path.Combine(candidate, "delete.txt")));
        Assert.True(Directory.Exists(current));
        Assert.Equal("old", await File.ReadAllTextAsync(Path.Combine(current, "change.txt")));
    }

    [Fact]
    public async Task RejectsTraversalWithoutWritingOutsideCandidate()
    {
        Current(("keep.txt", "keep"));
        var package = DeltaZip(
            "1.0.0", "1.1.0",
            new Dictionary<string, string> { ["../escape.txt"] = "owned" },
            [], new Dictionary<string, string> { ["keep.txt"] = "keep" },
            allowUnsafeEntry: true);

        await Assert.ThrowsAsync<InvalidDataException>(() => new FileDeltaApplier(_root).PrepareCandidateAsync(
            package, "1.0.0", "1.1.0", "delta_traversal", CancellationToken.None));

        Assert.False(File.Exists(Path.Combine(_root, "escape.txt")));
    }

    [Fact]
    public async Task RejectsDeltaBuiltForDifferentInstalledVersion()
    {
        Current(("keep.txt", "keep"));
        var package = DeltaZip("0.9.0", "1.1.0", new Dictionary<string, string>(), [],
            new Dictionary<string, string> { ["keep.txt"] = "keep" });

        await Assert.ThrowsAsync<InvalidDataException>(() => new FileDeltaApplier(_root).PrepareCandidateAsync(
            package, "1.0.0", "1.1.0", "delta_wrong_from", CancellationToken.None));
    }

    [Fact]
    public async Task RejectsResultCatalogMismatchAndDeletesCandidate()
    {
        Current(("keep.txt", "keep"));
        var package = DeltaZip("1.0.0", "1.1.0", new Dictionary<string, string>(), [],
            new Dictionary<string, string> { ["keep.txt"] = "different" });

        await Assert.ThrowsAsync<InvalidDataException>(() => new FileDeltaApplier(_root).PrepareCandidateAsync(
            package, "1.0.0", "1.1.0", "delta_bad_catalog", CancellationToken.None));

        Assert.False(Directory.Exists(Path.Combine(_root, "staging", "candidate-delta_bad_catalog")));
    }

    private string Current(params (string Path, string Content)[] files)
    {
        var current = Path.Combine(_root, "current");
        Directory.CreateDirectory(current);
        foreach (var file in files)
        {
            var target = Path.Combine(current, file.Path);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.WriteAllText(target, file.Content);
        }
        return current;
    }

    private string DeltaZip(
        string fromVersion,
        string toVersion,
        IReadOnlyDictionary<string, string> changed,
        IReadOnlyList<string> deleted,
        IReadOnlyDictionary<string, string> resulting,
        bool allowUnsafeEntry = false)
    {
        Directory.CreateDirectory(_root);
        var path = Path.Combine(_root, $"{Guid.NewGuid():N}.zip");
        using var archive = ZipFile.Open(path, ZipArchiveMode.Create);
        var files = changed.Select(item => FileEntry(item.Key, item.Value)).ToArray();
        var catalog = resulting.Select(item => FileEntry(item.Key, item.Value)).OrderBy(item => item.path, StringComparer.Ordinal).ToArray();
        var delta = new
        {
            schemaVersion = 1,
            fromVersion,
            toVersion,
            files,
            deletedPaths = deleted,
            resultCatalog = catalog
        };
        var metadata = archive.CreateEntry("delta.json");
        using (var writer = new StreamWriter(metadata.Open())) writer.Write(JsonSerializer.Serialize(delta));
        foreach (var (name, content) in changed)
        {
            if (!allowUnsafeEntry && (Path.IsPathRooted(name) || name.Split('/', '\\').Contains("..")))
                continue;
            var entry = archive.CreateEntry(name.Replace('\\', '/'));
            using var writer = new StreamWriter(entry.Open());
            writer.Write(content);
        }
        return path;
    }

    private static object FileEntry(string path, string content)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(content);
        return new
        {
            path = path.Replace('\\', '/'),
            size = bytes.LongLength,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()
        };
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
