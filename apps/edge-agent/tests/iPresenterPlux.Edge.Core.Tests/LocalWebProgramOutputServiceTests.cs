using System.Net;
using System.Net.Sockets;
using System.Text;
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


    [Fact]
    public async Task ProgramStateExposesOnlySanitizedThemeRenderState()
    {
        var port = FreePort();
        await using var output = new LocalWebProgramOutputService(port);
        var serviceId = Guid.NewGuid();
        var metadata = new Dictionary<string,string>
        {
            ["themeAppearanceV1"] = "{\"version\":1,\"background\":{\"kind\":\"gradient\",\"value\":\"violet_pink\"},\"primaryTextColor\":\"#ffffff\",\"secondaryTextColor\":\"#fde047\",\"fontFamily\":\"Inter\",\"titleSizeScale\":1,\"bodySizeScale\":1.2,\"footerSizeScale\":1,\"horizontalAlignment\":\"center\",\"verticalAlignment\":\"center\",\"shadow\":true,\"backingOpacity\":0.18,\"safeAreaPercent\":6,\"animation\":\"fade\",\"lowerThird\":{\"mode\":\"auto\",\"position\":\"bottom_left\"},\"logo\":{\"mediaId\":null,\"position\":\"top_right\",\"sizePercent\":8}}"
        };
        var item = new PresentationRenderItem(Guid.NewGuid().ToString("D"), serviceId, "scripture", "John 3:16", "For God so loved the world", "WEBP", metadata);
        await output.SetPreviewAsync(item, CancellationToken.None);
        await output.TakePreviewToProgramAsync(CancellationToken.None);
        await output.StartProgramOutputAsync(CancellationToken.None);
        using var client = new HttpClient();

        var state = await client.GetStringAsync($"http://127.0.0.1:{port}/api/state/program");
        var page = await client.GetStringAsync($"http://127.0.0.1:{port}/program");

        Assert.Contains("\"theme\"", state);
        Assert.Contains("\"violet_pink\"", state);
        Assert.Contains("applyTheme", page);
        Assert.DoesNotContain("innerhtml", page.ToLowerInvariant());
        Assert.DoesNotContain("eval(", page.ToLowerInvariant());
    }

    [Fact]
    public async Task ServesCachedThemeImageAndLogoOnlyFromLoopback()
    {
        var port = FreePort();
        var assetId = Guid.NewGuid();
        var directory = Path.Combine(Path.GetTempPath(), $"ipresenter-theme-loopback-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        await File.WriteAllBytesAsync(Path.Combine(directory, $"{assetId:N}.png"), [1,2,3,4]);
        try
        {
            var cache = new PresentationThemeAssetCache(directory: directory);
            await using var output = new LocalWebProgramOutputService(port, themeAssetCache: cache);
            var metadata = new Dictionary<string,string> { ["themeAppearanceV1"] = $"{{\"version\":1,\"background\":{{\"kind\":\"image\",\"value\":\"{assetId:D}\"}},\"primaryTextColor\":\"#ffffff\",\"secondaryTextColor\":\"#e5b95e\",\"fontFamily\":\"Inter\",\"titleSizeScale\":1,\"bodySizeScale\":1,\"footerSizeScale\":1,\"horizontalAlignment\":\"center\",\"verticalAlignment\":\"center\",\"shadow\":true,\"backingOpacity\":0.18,\"safeAreaPercent\":6,\"animation\":\"fade\",\"lowerThird\":{{\"mode\":\"auto\",\"position\":\"bottom_left\"}},\"logo\":{{\"mediaId\":\"{assetId:D}\",\"position\":\"top_right\",\"sizePercent\":8}}}}" };
            var item = new PresentationRenderItem(Guid.NewGuid().ToString("D"), Guid.NewGuid(), "scripture", "John 3:16", "Text", "WEBP", metadata);
            await output.SetPreviewAsync(item,CancellationToken.None);
            await output.TakePreviewToProgramAsync(CancellationToken.None);
            await output.StartProgramOutputAsync(CancellationToken.None);
            using var client = new HttpClient();
            var state = await client.GetStringAsync($"http://127.0.0.1:{port}/api/state/program");
            Assert.Contains($"/api/theme-assets/{assetId:D}",state);
            var bytes = await client.GetByteArrayAsync($"http://127.0.0.1:{port}/api/theme-assets/{assetId:D}");
            Assert.Equal([1,2,3,4],bytes);
            var page = await client.GetStringAsync($"http://127.0.0.1:{port}/program");
            Assert.Contains("themeAssets",page);
            Assert.Contains("logo.src",page);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory,true); }
    }

    [Fact]
    public async Task ProgramPageDefinesPersistentVideoAudioPlaybackSynchronization()
    {
        var port = FreePort();
        await using var output = new LocalWebProgramOutputService(port);
        await output.StartProgramOutputAsync(CancellationToken.None);
        using var client = new HttpClient();

        var page = await client.GetStringAsync($"http://127.0.0.1:{port}/program");

        Assert.Equal(1, CountOccurrences(page, "id=\"media-video\""));
        Assert.Equal(1, CountOccurrences(page, "id=\"media-audio\""));
        Assert.Contains("playback.revision", page, StringComparison.Ordinal);
        Assert.Contains("effectivePositionSeconds", page, StringComparison.Ordinal);
        Assert.Contains("Math.abs", page, StringComparison.Ordinal);
        Assert.Contains("0.25", page, StringComparison.Ordinal);
        Assert.Contains("/api/media-playback/report", page, StringComparison.Ordinal);
        Assert.Contains("media_browser_playback_blocked", page, StringComparison.Ordinal);
    }

    [Fact]
    public async Task BrowserPlaybackReportAcceptsOnlyCurrentKnownPlaybackFailure()
    {
        var port = FreePort();
        var serviceId = Guid.NewGuid();
        var itemId = Guid.NewGuid().ToString("D");
        var descriptor = new PresentationMediaDescriptor(
            Guid.NewGuid(), "video", new Uri("https://cdn.example.test/video.mp4"), "v1",
            "video/mp4", "Video", 0, 10, false, 1, "contain").Validate();
        var asset = new PreparedMediaAsset(
            itemId, serviceId, new string('e', 64), "/tmp/video.mp4", "video/mp4", "video",
            TimeSpan.FromSeconds(10), descriptor);
        var preparation = new ReadyPreparation(asset);
        var playback = new MediaPlaybackCoordinator();
        await using var output = new LocalWebProgramOutputService(
            port, mediaPreparation: preparation, mediaPlayback: playback);
        await output.SetActiveServiceAsync(serviceId, CancellationToken.None);
        await output.SetPreviewAsync(new PresentationRenderItem(
            itemId, serviceId, "media", "Video", "", null, new Dictionary<string,string>(), descriptor), CancellationToken.None);
        await output.TakePreviewToProgramAsync(CancellationToken.None);
        await output.StartProgramOutputAsync(CancellationToken.None);
        using var client = new HttpClient();
        var live = Assert.IsType<MediaPlaybackSnapshot>(playback.Snapshot);

        using var accepted = await client.PostAsync(
            $"http://127.0.0.1:{port}/api/media-playback/report",
            new StringContent($"{{\"itemId\":\"{itemId}\",\"revision\":{live.Revision},\"errorCode\":\"media_browser_playback_blocked\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
        var failed = Assert.IsType<MediaPlaybackSnapshot>(playback.Snapshot);
        Assert.Equal("error", failed.State);
        Assert.Equal("media_browser_playback_blocked", failed.ErrorCode);

        using var stale = await client.PostAsync(
            $"http://127.0.0.1:{port}/api/media-playback/report",
            new StringContent($"{{\"itemId\":\"{itemId}\",\"revision\":{live.Revision},\"errorCode\":\"media_browser_playback_blocked\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        using var unknown = await client.PostAsync(
            $"http://127.0.0.1:{port}/api/media-playback/report",
            new StringContent($"{{\"itemId\":\"{itemId}\",\"revision\":{failed.Revision},\"errorCode\":\"arbitrary_error\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
    }

    private static int CountOccurrences(string value, string token)
    {
        var count = 0;
        var index = 0;
        while ((index = value.IndexOf(token, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += token.Length;
        }
        return count;
    }

    private sealed class ReadyPreparation(PreparedMediaAsset asset) : iPresenterPlux.Edge.Core.Abstractions.IMediaPreparationCoordinator
    {
        private readonly MediaPreparationSnapshot _snapshot = new(
            asset.ItemId, asset.ServiceId, MediaPreparationState.Ready, asset, null);
        public event EventHandler<MediaPreparationSnapshot>? StatusChanged { add { } remove { } }
        public Task<MediaPreparationSnapshot> PrepareAsync(PresentationRenderItem item, CancellationToken cancellationToken) => Task.FromResult(_snapshot);
        public MediaPreparationSnapshot? TryGet(string itemId) => string.Equals(itemId, asset.ItemId, StringComparison.Ordinal) ? _snapshot : null;
        public Task PrefetchAsync(Guid serviceId, IReadOnlyList<OperatorCatalogItem> items, CancellationToken cancellationToken) => Task.CompletedTask;
        public IDisposable AcquireReadyLease(string itemId) => new Lease();
        public Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken) => Task.CompletedTask;
        private sealed class Lease : IDisposable { public void Dispose() { } }
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
