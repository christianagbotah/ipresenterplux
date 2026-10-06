using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Journals;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class FileCompletedCommandJournalTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
    private readonly Guid _organization = Guid.NewGuid();
    private readonly Guid _device = Guid.NewGuid();
    private string JournalPath => Path.Combine(_directory, "completed-commands.json");
    private static ControlCommandResult Result() => new(Guid.NewGuid().ToString(), true,
        "program_live", null, DateTimeOffset.UtcNow);

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void RestartPreservesExactResultAndDeviceScope(bool success)
    {
        var result = Result() with { Success = success, Error = success ? null : "output_unavailable" };
        new FileCompletedCommandJournal(_directory).Store(_organization, _device, result);
        var restarted = new FileCompletedCommandJournal(_directory);
        Assert.Equal(result, restarted.Find(_organization, _device, result.CommandId));
        Assert.Null(restarted.Find(Guid.NewGuid(), _device, result.CommandId));
        Assert.Null(restarted.Find(_organization, Guid.NewGuid(), result.CommandId));
        restarted.Store(_organization, _device, result);
        Assert.Throws<InvalidDataException>(() => restarted.Store(_organization, _device, result with { Success = !success }));
        Assert.Equal(result, new FileCompletedCommandJournal(_directory).Find(_organization, _device, result.CommandId));
    }

    [Fact]
    public void RetentionIsPersistedAndDuplicateDoesNotEvict()
    {
        var journal = new FileCompletedCommandJournal(_directory, 2);
        var first = Result(); var second = Result(); var third = Result();
        journal.Store(_organization, _device, first);
        journal.Store(_organization, _device, second);
        journal.Store(_organization, _device, first);
        journal.Store(_organization, _device, third);
        var restarted = new FileCompletedCommandJournal(_directory, 2);
        Assert.Null(restarted.Find(_organization, _device, first.CommandId));
        Assert.Equal(second, restarted.Find(_organization, _device, second.CommandId));
        Assert.Equal(third, restarted.Find(_organization, _device, third.CommandId));
    }

    [Fact]
    public void InvalidInputsDoNotChangeEvidence()
    {
        var journal = new FileCompletedCommandJournal(_directory);
        var result = Result(); journal.Store(_organization, _device, result);
        var before = File.ReadAllText(JournalPath);
        Assert.Throws<ArgumentOutOfRangeException>(() => new FileCompletedCommandJournal(_directory, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new FileCompletedCommandJournal(_directory, 1001));
        Assert.Throws<ArgumentException>(() => journal.Find(Guid.Empty, _device, result.CommandId));
        Assert.Throws<ArgumentException>(() => journal.Store(_organization, _device, result with { CommandId = "invalid" }));
        Assert.Throws<ArgumentException>(() => journal.Store(_organization, _device, result with { ResultingState = "" }));
        Assert.Throws<ArgumentException>(() => journal.Store(_organization, _device, result with { CompletedAt = default }));
        Assert.Equal(before, File.ReadAllText(JournalPath));
    }

    [Theory]
    [InlineData("{")]
    [InlineData("null")]
    [InlineData("{\"schemaVersion\":2,\"results\":[]}")]
    [InlineData("{\"schemaVersion\":1,\"results\":[null]}")]
    [InlineData("{\"schemaVersion\":1,\"results\":null}")]
    public void CorruptStateBlocksReadsAndWritesWithoutOverwriting(string contents)
    {
        Directory.CreateDirectory(_directory); File.WriteAllText(JournalPath, contents);
        var journal = new FileCompletedCommandJournal(_directory); var result = Result();
        Assert.Throws<InvalidDataException>(() => journal.Find(_organization, _device, result.CommandId));
        Assert.Throws<InvalidDataException>(() => journal.Store(_organization, _device, result));
        Assert.Equal(contents, File.ReadAllText(JournalPath));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void InterruptedWriteBlocksCommandsEvenWhenAnOlderSnapshotExists(bool existing)
    {
        var journal = new FileCompletedCommandJournal(_directory); var result = Result();
        if (existing) journal.Store(_organization, _device, result);
        File.WriteAllText(JournalPath + ".interrupted.tmp", "partial evidence");
        var restarted = new FileCompletedCommandJournal(_directory);
        Assert.Throws<InvalidDataException>(() => restarted.Find(_organization, _device, result.CommandId));
        Assert.Throws<InvalidDataException>(() => restarted.Store(_organization, _device, result));
        Assert.Equal("partial evidence", File.ReadAllText(JournalPath + ".interrupted.tmp"));
    }

    [Fact]
    public void DuplicatePersistedKeysFailClosed()
    {
        var journal = new FileCompletedCommandJournal(_directory); var result = Result();
        journal.Store(_organization, _device, result);
        var document = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(JournalPath))!;
        var entries = document["results"]!.AsArray();
        entries.Add(entries[0]!.DeepClone());
        File.WriteAllText(JournalPath, document.ToJsonString());
        Assert.Throws<InvalidDataException>(() => new FileCompletedCommandJournal(_directory)
            .Find(_organization, _device, result.CommandId));
    }

    [Fact]
    public void DirectoryInPlaceOfJournalIsNotTreatedAsEmpty()
    {
        var journal = new FileCompletedCommandJournal(_directory); var result = Result();
        Directory.CreateDirectory(JournalPath);
        Assert.ThrowsAny<Exception>(() => journal.Find(_organization, _device, result.CommandId));
        Assert.ThrowsAny<Exception>(() => journal.Store(_organization, _device, result));
        Assert.True(Directory.Exists(JournalPath));
    }

    public void Dispose() { if (Directory.Exists(_directory)) Directory.Delete(_directory, true); }
}
