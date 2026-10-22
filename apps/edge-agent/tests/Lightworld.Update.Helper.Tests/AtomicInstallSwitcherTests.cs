using System.IO.Compression;
using Lightworld.Update.Helper;
using Xunit;

namespace Lightworld.Update.Helper.Tests;

public sealed class AtomicInstallSwitcherTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "lightworld-update-helper-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task PrepareCandidateRejectsTraversalZip()
    {
        Directory.CreateDirectory(_root);
        var package = Path.Combine(_root, "bad.zip");
        using (var archive = ZipFile.Open(package, ZipArchiveMode.Create))
        {
            var entry = archive.CreateEntry("../escape.txt");
            await using var writer = entry.Open();
            await writer.WriteAsync("owned"u8.ToArray());
        }

        var switcher = new AtomicInstallSwitcher(_root);
        await Assert.ThrowsAsync<InvalidDataException>(() => switcher.PrepareCandidateAsync(package, "token", CancellationToken.None));
        Assert.False(File.Exists(Path.Combine(Path.GetDirectoryName(_root)!, "escape.txt")));
    }

    [Fact]
    public async Task RotateMovesCurrentToPreviousAndCandidateToCurrentWithoutTouchingState()
    {
        Directory.CreateDirectory(Path.Combine(_root, "current"));
        Directory.CreateDirectory(Path.Combine(_root, "state"));
        await File.WriteAllTextAsync(Path.Combine(_root, "current", "version.txt"), "1.0.0");
        await File.WriteAllTextAsync(Path.Combine(_root, "state", "keep.txt"), "identity-state");
        var candidate = Path.Combine(_root, "staging", "candidate-test");
        Directory.CreateDirectory(candidate);
        await File.WriteAllTextAsync(Path.Combine(candidate, "version.txt"), "1.1.0");

        var switcher = new AtomicInstallSwitcher(_root);
        await switcher.SwitchToCandidateAsync(candidate, CancellationToken.None);

        Assert.Equal("1.1.0", await File.ReadAllTextAsync(Path.Combine(_root, "current", "version.txt")));
        Assert.Equal("1.0.0", await File.ReadAllTextAsync(Path.Combine(_root, "previous", "version.txt")));
        Assert.Equal("identity-state", await File.ReadAllTextAsync(Path.Combine(_root, "state", "keep.txt")));
    }

    [Fact]
    public async Task RollbackRestoresPreviousVersion()
    {
        Directory.CreateDirectory(Path.Combine(_root, "current"));
        Directory.CreateDirectory(Path.Combine(_root, "previous"));
        await File.WriteAllTextAsync(Path.Combine(_root, "current", "version.txt"), "broken");
        await File.WriteAllTextAsync(Path.Combine(_root, "previous", "version.txt"), "good");

        var switcher = new AtomicInstallSwitcher(_root);
        await switcher.RollbackAsync(CancellationToken.None);

        Assert.Equal("good", await File.ReadAllTextAsync(Path.Combine(_root, "current", "version.txt")));
        Assert.False(Directory.Exists(Path.Combine(_root, "previous")));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}
