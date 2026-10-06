using System.Net;
using System.Net.Sockets;
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
        var item = Item(Guid.NewGuid());

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
    public async Task RestoresLastPreviewAndProgramAcrossRestart()
    {
        var directory = TempDirectory();
        try
        {
            var serviceId = Guid.NewGuid();
            var item = Item(serviceId);
            var store = new FileProgramStateStore(directory);
            await using (var first = new LocalWebProgramOutputService(49324, store))
            {
                await first.SetPreviewAsync(item, CancellationToken.None);
                await first.TakePreviewToProgramAsync(CancellationToken.None);
            }

            await using var restored = new LocalWebProgramOutputService(49325, new FileProgramStateStore(directory));
            await restored.RestoreAsync(CancellationToken.None);

            Assert.Equal(serviceId, restored.LastKnownServiceId);
            Assert.Equal(item.ItemId, restored.Snapshot.Preview?.ItemId);
            Assert.Equal(item.ItemId, restored.Snapshot.Program?.ItemId);
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    [Fact]
    public async Task AuthoritativeServiceChangePurgesStaleLocalContent()
    {
        var directory = TempDirectory();
        try
        {
            var oldService = Guid.NewGuid();
            await using var output = new LocalWebProgramOutputService(49326, new FileProgramStateStore(directory));
            await output.SetPreviewAsync(Item(oldService), CancellationToken.None);
            await output.TakePreviewToProgramAsync(CancellationToken.None);

            await output.SetActiveServiceAsync(Guid.NewGuid(), CancellationToken.None);

            Assert.Null(output.Snapshot.Preview);
            Assert.Null(output.Snapshot.Program);
            Assert.Null(output.LastKnownServiceId);

            await using var restored = new LocalWebProgramOutputService(49327, new FileProgramStateStore(directory));
            await restored.RestoreAsync(CancellationToken.None);
            Assert.Null(restored.Snapshot.Preview);
            Assert.Null(restored.Snapshot.Program);
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    [Fact]
    public async Task CorruptPersistedStateDoesNotPreventRendererStartupState()
    {
        var directory = TempDirectory();
        try
        {
            await File.WriteAllTextAsync(Path.Combine(directory, "program-state.json"), "{not-json");
            await using var output = new LocalWebProgramOutputService(49328, new FileProgramStateStore(directory));

            await output.RestoreAsync(CancellationToken.None);

            Assert.False(output.PersistenceHealthy);
            Assert.Null(output.Snapshot.Preview);
            Assert.Null(output.Snapshot.Program);
            Assert.True(File.Exists(Path.Combine(directory, "program-state.json")));
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    [Theory]
    [InlineData("/program")]
    [InlineData("/api/state/program")]
    public async Task LoopbackRendererRejectsNonGetMethods(string path)
    {
        var port = FreePort();
        await using var output = new LocalWebProgramOutputService(port);
        await output.StartProgramOutputAsync(CancellationToken.None);
        using var client = new HttpClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{port}{path}")
        {
            Content = new StringContent("{}")
        };

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
        Assert.True(response.Content.Headers.TryGetValues("Allow", out var allow));
        Assert.Contains("GET", allow);
        Assert.Null(output.Snapshot.Preview);
        Assert.Null(output.Snapshot.Program);
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


    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try { return ((IPEndPoint)listener.LocalEndpoint).Port; }
        finally { listener.Stop(); }
    }

    private static PresentationRenderItem Item(Guid serviceId) => new(
        Guid.NewGuid().ToString("D"), serviceId, "scripture", "Psalm 23:1",
        "The Lord is my shepherd; I shall not want.", "KJV", new Dictionary<string, string>());

    private static string TempDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenterplux-program-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        return directory;
    }
}
