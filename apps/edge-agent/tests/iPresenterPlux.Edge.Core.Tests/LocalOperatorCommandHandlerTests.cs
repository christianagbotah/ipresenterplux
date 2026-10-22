using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.State;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class LocalOperatorCommandHandlerTests
{
    [Fact]
    public async Task PreviewTakeAndClearUseAuthoritativeActiveService()
    {
        var serviceId = Guid.NewGuid();
        var state = new AgentRuntimeState();
        state.Update(s => s with { ActiveServiceId = serviceId, ConnectionStatus = "Online", ServiceMode = "Live" });
        await using var output = new LocalWebProgramOutputService(49401);
        var handler = new LocalOperatorCommandHandler(state, output);

        var preview = await handler.HandleAsync(Request(
            LocalOperatorCommands.PreviewRender,
            new LocalOperatorPresentation("scripture-1", "scripture", "John 3:16", "For God so loved the world...", "KJV")),
            CancellationToken.None);

        Assert.True(preview.Ok);
        Assert.Equal(serviceId, preview.Snapshot.Preview?.ServiceId);
        Assert.Equal("scripture-1", output.Snapshot.Preview?.ItemId);

        var take = await handler.HandleAsync(Request(LocalOperatorCommands.ProgramTake), CancellationToken.None);
        Assert.True(take.Ok);
        Assert.Equal("scripture-1", take.Snapshot.Program?.ItemId);

        var clear = await handler.HandleAsync(Request(LocalOperatorCommands.ProgramClear), CancellationToken.None);
        Assert.True(clear.Ok);
        Assert.Null(clear.Snapshot.Program);
        Assert.Equal("scripture-1", clear.Snapshot.Preview?.ItemId);
    }

    [Fact]
    public async Task LocalRehearsalContentCannotInventAServiceScope()
    {
        var state = new AgentRuntimeState();
        await using var output = new LocalWebProgramOutputService(49402);
        var handler = new LocalOperatorCommandHandler(state, output);

        var response = await handler.HandleAsync(Request(
            LocalOperatorCommands.PreviewRender,
            new LocalOperatorPresentation("rehearsal", "scripture", "Psalm 23:1", "The Lord is my shepherd.", "KJV")),
            CancellationToken.None);

        Assert.True(response.Ok);
        Assert.Equal(Guid.Empty, response.Snapshot.Preview?.ServiceId);
        Assert.Null(response.Snapshot.ActiveServiceId);
    }

    [Fact]
    public async Task RejectsUnsupportedCommandsAndOversizedContent()
    {
        var state = new AgentRuntimeState();
        await using var output = new LocalWebProgramOutputService(49403);
        var handler = new LocalOperatorCommandHandler(state, output);

        var unsupported = await handler.HandleAsync(Request("shell.exec"), CancellationToken.None);
        Assert.False(unsupported.Ok);
        Assert.Equal("unsupported_command", unsupported.ErrorCode);

        var oversized = await handler.HandleAsync(Request(
            LocalOperatorCommands.PreviewRender,
            new LocalOperatorPresentation("x", "scripture", "title", new string('x', 12001), null)),
            CancellationToken.None);
        Assert.False(oversized.Ok);
        Assert.Equal("body_invalid", oversized.ErrorCode);
    }

    [Fact]
    public async Task FailedMediaPreparationDoesNotMutateExistingPreviewOrProgram()
    {
        var serviceId = Guid.NewGuid();
        var mediaId = Guid.NewGuid().ToString("D");
        var state = new AgentRuntimeState();
        state.Update(s => s with { ActiveServiceId = serviceId, ConnectionStatus = "Online", ServiceMode = "Live" });
        await using var output = new LocalWebProgramOutputService(49412);
        var existing = new PresentationRenderItem("existing", serviceId, "slide", "Existing", "Keep me live", null, new Dictionary<string,string>());
        await output.SetPreviewAsync(existing, CancellationToken.None);
        await output.TakePreviewToProgramAsync(CancellationToken.None);

        var directory = Path.Combine(Path.GetTempPath(), "ipresenterplux-prepare-failure", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var store = new OperatorCatalogStore(directory);
            var coordinator = new OperatorCatalogCoordinator(store);
            await coordinator.SetActiveServiceAsync(serviceId, CancellationToken.None);
            var now = DateTimeOffset.UtcNow;
            await store.WriteAsync(new OperatorCatalogSnapshot(
                OperatorCatalogSnapshot.CurrentSchemaVersion, now, now, "rev-media",
                new OperatorCatalogService(serviceId, "Service", "live", "KJV", null, now),
                [], [new OperatorCatalogItem(mediaId, "media", "Video", "", null, new Dictionary<string,string>())], []),
                CancellationToken.None);
            coordinator.BindPresentationProvider(new FixedPresentationProvider(MediaPresentation(mediaId, serviceId)));
            var preparation = new FailedPreparationCoordinator();
            var handler = new LocalOperatorCommandHandler(
                state, output, operatorCatalog: coordinator, mediaPreparation: preparation);

            var response = await handler.HandleAsync(new LocalOperatorRequest(
                Guid.NewGuid().ToString("D"), LocalOperatorCommands.PreviewPrepareItem,
                Item: new LocalOperatorItemRequest(mediaId)), CancellationToken.None);

            Assert.False(response.Ok);
            Assert.Equal("media_download_failed", response.ErrorCode);
            Assert.Equal("existing", response.Snapshot.Preview?.ItemId);
            Assert.Equal("existing", response.Snapshot.Program?.ItemId);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }

    [Fact]
    public async Task DynamicMediaPauseSeekAndResumeUseAuthoritativePlaybackState()
    {
        var serviceId = Guid.NewGuid();
        var itemId = Guid.NewGuid().ToString("D");
        var state = new AgentRuntimeState();
        state.Update(s => s with { ActiveServiceId = serviceId, ConnectionStatus = "Online", ServiceMode = "Live" });
        var descriptor = new PresentationMediaDescriptor(
            Guid.NewGuid(), "video", new Uri("https://cdn.example.test/video.mp4"), "v1",
            "video/mp4", "Video", 1, 9, false, 1, "contain").Validate();
        var asset = new PreparedMediaAsset(itemId, serviceId, new string('f', 64), "/tmp/video.mp4",
            "video/mp4", "video", TimeSpan.FromSeconds(10), descriptor);
        var preparation = new ReadyPreparationCoordinator(asset);
        var playback = new MediaPlaybackCoordinator();
        await using var output = new LocalWebProgramOutputService(
            49413, mediaPreparation: preparation, mediaPlayback: playback);
        await output.SetActiveServiceAsync(serviceId, CancellationToken.None);
        await output.SetPreviewAsync(new PresentationRenderItem(
            itemId, serviceId, "media", "Video", "", null, new Dictionary<string,string>(), descriptor), CancellationToken.None);
        await output.TakePreviewToProgramAsync(CancellationToken.None);
        var handler = new LocalOperatorCommandHandler(state, output);

        var pause = await handler.HandleAsync(MediaRequest(LocalOperatorCommands.MediaPause), CancellationToken.None);
        Assert.True(pause.Ok);
        Assert.Equal("paused", playback.Snapshot?.State);

        var seek = await handler.HandleAsync(MediaRequest(
            LocalOperatorCommands.MediaSeek, new LocalOperatorMediaControl(7.5)), CancellationToken.None);
        Assert.True(seek.Ok);
        Assert.Equal(7.5, playback.Snapshot?.EffectivePositionSeconds, 3);

        var resume = await handler.HandleAsync(MediaRequest(LocalOperatorCommands.MediaResume), CancellationToken.None);
        Assert.True(resume.Ok);
        Assert.Equal("playing", playback.Snapshot?.State);
    }

    [Fact]
    public async Task MediaControlsRejectMalformedSeekAndWrongServiceWithoutMutatingPlayback()
    {
        var serviceId = Guid.NewGuid();
        var itemId = Guid.NewGuid().ToString("D");
        var state = new AgentRuntimeState();
        state.Update(s => s with { ActiveServiceId = serviceId, ConnectionStatus = "Online", ServiceMode = "Live" });
        var descriptor = new PresentationMediaDescriptor(
            Guid.NewGuid(), "audio", new Uri("https://cdn.example.test/audio.mp3"), "v1",
            "audio/mpeg", "Audio", 0, 20, false, 1, "contain").Validate();
        var asset = new PreparedMediaAsset(itemId, serviceId, new string('a', 64), "/tmp/audio.mp3",
            "audio/mpeg", "audio", TimeSpan.FromSeconds(20), descriptor);
        var preparation = new ReadyPreparationCoordinator(asset);
        var playback = new MediaPlaybackCoordinator();
        await using var output = new LocalWebProgramOutputService(
            49414, mediaPreparation: preparation, mediaPlayback: playback);
        await output.SetActiveServiceAsync(serviceId, CancellationToken.None);
        await output.SetPreviewAsync(new PresentationRenderItem(
            itemId, serviceId, "media", "Audio", "", null, new Dictionary<string,string>(), descriptor), CancellationToken.None);
        await output.TakePreviewToProgramAsync(CancellationToken.None);
        var handler = new LocalOperatorCommandHandler(state, output);
        var before = Assert.IsType<MediaPlaybackSnapshot>(playback.Snapshot);

        var malformed = await handler.HandleAsync(MediaRequest(
            LocalOperatorCommands.MediaSeek, new LocalOperatorMediaControl(double.NaN)), CancellationToken.None);
        Assert.False(malformed.Ok);
        Assert.Equal(before.Revision, playback.Snapshot?.Revision);

        state.Update(s => s with { ActiveServiceId = Guid.NewGuid() });
        var wrongService = await handler.HandleAsync(MediaRequest(LocalOperatorCommands.MediaPause), CancellationToken.None);
        Assert.False(wrongService.Ok);
        Assert.Equal(before.Revision, playback.Snapshot?.Revision);
        Assert.Equal("playing", playback.Snapshot?.State);
    }

    [Fact]
    public async Task MediaControlsRequireDynamicProgramMedia()
    {
        var serviceId = Guid.NewGuid();
        var state = new AgentRuntimeState();
        state.Update(s => s with { ActiveServiceId = serviceId });
        await using var output = new LocalWebProgramOutputService(49415);
        await output.SetPreviewAsync(new PresentationRenderItem(
            "slide", serviceId, "slide", "Welcome", "Hello", null, new Dictionary<string,string>()), CancellationToken.None);
        await output.TakePreviewToProgramAsync(CancellationToken.None);
        var handler = new LocalOperatorCommandHandler(state, output);

        var response = await handler.HandleAsync(MediaRequest(LocalOperatorCommands.MediaPause), CancellationToken.None);

        Assert.False(response.Ok);
        Assert.Equal("media_control_unavailable", response.ErrorCode);
    }

    [Fact]
    public async Task RecordingStartUsesRuntimeServiceAndRequiresOne()
    {
        var state = new AgentRuntimeState();
        await using var output = new LocalWebProgramOutputService(49404);
        await using var recording = new FakeRecordingService();
        var handler = new LocalOperatorCommandHandler(state, output, recording);

        var missing = await handler.HandleAsync(Request(LocalOperatorCommands.RecordingStart), CancellationToken.None);
        Assert.False(missing.Ok);
        Assert.Equal("service_required", missing.ErrorCode);

        var serviceId = Guid.NewGuid();
        state.Update(s => s with { ActiveServiceId = serviceId });
        var started = await handler.HandleAsync(Request(LocalOperatorCommands.RecordingStart), CancellationToken.None);
        Assert.True(started.Ok);
        Assert.Equal(serviceId, recording.Status.ServiceId);
        Assert.True(started.Snapshot.IsRecording);
    }

    [Fact]
    public void EndpointIsStableAndKeepsUnixSocketInsideDataDirectory()
    {
        var root = Path.Combine(Path.GetTempPath(), "ipresenterplux-ipc-tests", "church-a");
        var first = LocalOperatorIpcEndpoint.ForDataDirectory(root);
        var second = LocalOperatorIpcEndpoint.ForDataDirectory(root);

        Assert.Equal(first.PipeName, second.PipeName);
        Assert.StartsWith("ipresenterplux-operator-", first.PipeName);
        Assert.Equal(Path.Combine(Path.GetFullPath(root), "operator.sock"), first.UnixSocketPath);
    }

    [Fact]
    public void LongUnixSocketPathFallsBackToBoundedStablePath()
    {
        var root = Path.Combine(Path.GetTempPath(), "ipresenterplux-ipc-tests", new string('x', 180));
        var first = LocalOperatorIpcEndpoint.ForDataDirectory(root);
        var second = LocalOperatorIpcEndpoint.ForDataDirectory(root);

        Assert.Equal(first.UnixSocketPath, second.UnixSocketPath);
        Assert.NotEqual(Path.Combine(Path.GetFullPath(root), "operator.sock"), first.UnixSocketPath);
        Assert.True(Encoding.UTF8.GetByteCount(first.UnixSocketPath) <= 100);
    }

    private static LocalOperatorRequest Request(string command, LocalOperatorPresentation? presentation = null) =>
        new(Guid.NewGuid().ToString("D"), command, presentation);

    private static LocalOperatorRequest MediaRequest(string command, LocalOperatorMediaControl? media = null) =>
        new(Guid.NewGuid().ToString("D"), command, Media: media ?? new LocalOperatorMediaControl());

    private static PresentationRenderItem MediaPresentation(string itemId, Guid serviceId) => new(
        itemId, serviceId, "media", "Video", "", null, new Dictionary<string,string>(),
        new PresentationMediaDescriptor(Guid.NewGuid(), "video", new Uri("https://media.example.test/video.mp4"),
            new string('b', 64), "video/mp4", "Video", 0, null, false, 1, "contain").Validate());

    private sealed class FixedPresentationProvider(PresentationRenderItem item) : IPresentationContentProvider
    {
        public Task<PresentationRenderItem> GetAsync(string itemId, CancellationToken cancellationToken) => Task.FromResult(item);
    }

    private sealed class ReadyPreparationCoordinator(PreparedMediaAsset asset) : IMediaPreparationCoordinator
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

    private sealed class FailedPreparationCoordinator : IMediaPreparationCoordinator
    {
        public event EventHandler<MediaPreparationSnapshot>? StatusChanged { add { } remove { } }
        public Task<MediaPreparationSnapshot> PrepareAsync(PresentationRenderItem item, CancellationToken cancellationToken) =>
            Task.FromResult(new MediaPreparationSnapshot(item.ItemId, item.ServiceId, MediaPreparationState.Failed, null, "media_download_failed"));
        public MediaPreparationSnapshot? TryGet(string itemId) => null;
        public Task PrefetchAsync(Guid serviceId, IReadOnlyList<OperatorCatalogItem> items, CancellationToken cancellationToken) => Task.CompletedTask;
        public IDisposable AcquireReadyLease(string itemId) => new Lease();
        public Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken) => Task.CompletedTask;
        private sealed class Lease : IDisposable { public void Dispose() { } }
    }

    private sealed class FakeRecordingService : ILocalRecordingService
    {
        public LocalRecordingStatus Status { get; private set; } =
            new(false, null, null, null, null, 0, 0, null);

        public Task<LocalRecordingStatus> StartAsync(Guid serviceId, CancellationToken cancellationToken)
        {
            Status = new LocalRecordingStatus(true, serviceId, "recording-1", null, DateTimeOffset.UtcNow, 0, 0, null);
            return Task.FromResult(Status);
        }

        public Task<LocalRecordingStatus> StopAsync(CancellationToken cancellationToken)
        {
            Status = Status with { IsRecording = false };
            return Task.FromResult(Status);
        }

        public Task HandleActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken) => Task.CompletedTask;
        public bool TrySubmit(AudioFrame frame) => true;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
