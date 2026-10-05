using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class LocalWebProgramOutputServiceTests
{
    [Fact]
    public async Task PreviewCanBeTakenToProgramAndCleared()
    {
        await using var output = new LocalWebProgramOutputService(49322);
        var item = new PresentationRenderItem(
            Guid.NewGuid().ToString("D"), Guid.NewGuid(), "scripture", "Psalm 23:1",
            "The Lord is my shepherd; I shall not want.", "KJV", new Dictionary<string, string>());

        await output.SetPreviewAsync(item, CancellationToken.None);
        Assert.Equal(item.ItemId, output.Snapshot.Preview?.ItemId);
        Assert.Null(output.Snapshot.Program);

        await output.TakePreviewToProgramAsync(CancellationToken.None);
        Assert.Equal(item.ItemId, output.Snapshot.Program?.ItemId);

        await output.ClearProgramAsync(CancellationToken.None);
        Assert.Null(output.Snapshot.Program);
        Assert.Equal(item.ItemId, output.Snapshot.Preview?.ItemId);
    }

    [Fact]
    public void ExposesLoopbackOnlyProgramAndPreviewUris()
    {
        var output = new LocalWebProgramOutputService(49323);
        Assert.Equal("127.0.0.1", output.ProgramUri.Host);
        Assert.Equal("http", output.ProgramUri.Scheme);
        Assert.Equal("/program", output.ProgramUri.AbsolutePath);
        Assert.Equal("/preview", output.PreviewUri.AbsolutePath);
    }
}
