using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Runtime;
using SkiaSharp;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class PresentationProgramVideoSourceTests
{
    [Fact]
    public async Task StaticTextAndAudioUseRenderedFramesWhileVideoUsesCurrentPlaybackPosition()
    {
        var serviceId = Guid.NewGuid();
        var renderer = new CountingRenderer();
        var provider = new RecordingMediaVideoFrameProvider();
        var preparation = new FakePreparation();
        var playback = new MediaPlaybackCoordinator();
        await using var output = new LocalWebProgramOutputService(
            mediaPreparation: preparation, mediaPlayback: playback);
        await output.SetActiveServiceAsync(serviceId, CancellationToken.None);
        var source = new PresentationProgramVideoSource(output, renderer, playback, preparation, provider, 320, 180);

        var text = new PresentationRenderItem(
            "text-1", serviceId, "scripture", "Psalm 23:1", "The Lord is my shepherd", null,
            new Dictionary<string, string>());
        await TakeAsync(output, text);
        var text1 = source.GetCurrentFrame();
        var text2 = source.GetCurrentFrame();
        Assert.Same(text1, text2);
        Assert.Equal(1, renderer.RenderCount);
        Assert.Empty(provider.Positions);

        var audioAsset = ReadyAsset(serviceId, "audio-1", "audio", "audio/mpeg", "/tmp/audio.mp3", 10);
        preparation.Set(audioAsset);
        await TakeAsync(output, MediaItem(audioAsset));
        var audio1 = source.GetCurrentFrame();
        var audio2 = source.GetCurrentFrame();
        Assert.Same(audio1, audio2);
        Assert.Equal(2, renderer.RenderCount);
        Assert.Empty(provider.Positions);

        var videoAsset = ReadyAsset(serviceId, "video-1", "video", "video/mp4", "/tmp/video.mp4", 10, trimStart: .2);
        preparation.Set(videoAsset);
        await TakeAsync(output, MediaItem(videoAsset));
        var first = source.GetCurrentFrame();
        await playback.SeekAsync(1.2, CancellationToken.None);
        var second = source.GetCurrentFrame();

        Assert.NotSame(first, second);
        Assert.Equal(new[] { .2, 1.2 }, provider.Positions.Select(value => Math.Round(value, 3)).ToArray());
        Assert.All(provider.Assets, asset => Assert.Same(videoAsset, asset));
        Assert.Equal(320, second.Width);
        Assert.Equal(180, second.Height);
    }

    [Fact]
    public async Task ImageIsDecodedOnceAndContainFitLetterboxesIntoBgraFrame()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenter-program-image", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var imagePath = Path.Combine(directory, "two-colors.png");
            using (var bitmap = new SKBitmap(new SKImageInfo(2, 1, SKColorType.Bgra8888, SKAlphaType.Opaque)))
            {
                bitmap.SetPixel(0, 0, SKColors.Red);
                bitmap.SetPixel(1, 0, SKColors.Lime);
                using var image = SKImage.FromBitmap(bitmap);
                using var data = image.Encode(SKEncodedImageFormat.Png, 100);
                using var file = File.Create(imagePath);
                data.SaveTo(file);
            }

            var serviceId = Guid.NewGuid();
            var renderer = new CountingRenderer();
            var provider = new RecordingMediaVideoFrameProvider();
            var preparation = new FakePreparation();
            var playback = new MediaPlaybackCoordinator();
            var asset = ReadyAsset(serviceId, "image-1", "image", "image/png", imagePath, null, fit: "contain");
            preparation.Set(asset);
            await using var output = new LocalWebProgramOutputService(
                mediaPreparation: preparation, mediaPlayback: playback);
            await output.SetActiveServiceAsync(serviceId, CancellationToken.None);
            await TakeAsync(output, MediaItem(asset));
            var source = new PresentationProgramVideoSource(output, renderer, playback, preparation, provider, 320, 180);

            var frame1 = source.GetCurrentFrame();
            var frame2 = source.GetCurrentFrame();

            Assert.Same(frame1, frame2);
            Assert.Equal("bgra32", frame1.PixelFormat);
            Assert.Equal(320 * 4, frame1.Stride);
            Assert.Equal(320 * 180 * 4, frame1.Buffer.Length);
            Assert.Equal((byte)0, Pixel(frame1, 160, 0).R);
            Assert.True(Pixel(frame1, 60, 90).R > 200);
            Assert.True(Pixel(frame1, 260, 90).G > 200);
            Assert.Equal(0, renderer.RenderCount);
            Assert.Empty(provider.Positions);
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Fact]
    public async Task NativeVisualProgramOverridesMediaThenRenderedSourceResumesCurrentMediaAuthority()
    {
        var serviceId = Guid.NewGuid();
        var preparation = new FakePreparation();
        var playback = new MediaPlaybackCoordinator();
        var provider = new RecordingMediaVideoFrameProvider();
        var asset = ReadyAsset(serviceId, "video-1", "video", "video/mp4", "/tmp/video.mp4", 10);
        preparation.Set(asset);
        await using var output = new LocalWebProgramOutputService(
            mediaPreparation: preparation, mediaPlayback: playback);
        await output.SetActiveServiceAsync(serviceId, CancellationToken.None);
        await TakeAsync(output, MediaItem(asset));
        var rendered = new PresentationProgramVideoSource(
            output, new CountingRenderer(), playback, preparation, provider, 320, 180);
        var nativeDescriptor = Descriptor("display-a");
        var nativeFrame = Frame("native-display");
        var session = new FakeSession(nativeDescriptor, nativeFrame);
        await using var router = new VisualProgramRouter(
            new FakeCatalog([nativeDescriptor]), new FakeFactory(session), rendered);

        var mediaBefore = router.GetCurrentFrame();
        var revisionBefore = Assert.IsType<MediaPlaybackSnapshot>(playback.Snapshot).Revision;
        await router.SelectPreviewAsync(nativeDescriptor.SourceId, CancellationToken.None);
        await router.TakePreviewAsync(CancellationToken.None);
        var native = router.GetCurrentFrame();
        await playback.SeekAsync(1.1, CancellationToken.None);
        await router.UseRenderedProgramAsync(CancellationToken.None);
        var mediaAfter = router.GetCurrentFrame();

        Assert.Equal("video-1", mediaBefore.ItemId);
        Assert.Equal("native-display", native.ItemId);
        Assert.Equal("video-1", mediaAfter.ItemId);
        Assert.Equal("video-1", output.Snapshot.Program?.ItemId);
        Assert.True(playback.Snapshot?.Revision > revisionBefore);
        Assert.Equal(1.1, provider.Positions[^1], 3);
        Assert.Equal(1, session.DisposeCount);
    }

    private static async Task TakeAsync(LocalWebProgramOutputService output, PresentationRenderItem item)
    {
        await output.SetPreviewAsync(item, CancellationToken.None);
        await output.TakePreviewToProgramAsync(CancellationToken.None);
    }

    private static PresentationRenderItem MediaItem(PreparedMediaAsset asset) => new(
        asset.ItemId, asset.ServiceId, "media", asset.Descriptor.DisplayName ?? asset.MediaKind, "", null,
        new Dictionary<string, string>(), asset.Descriptor);

    private static PreparedMediaAsset ReadyAsset(
        Guid serviceId,
        string itemId,
        string mediaKind,
        string contentType,
        string localPath,
        double? durationSeconds,
        double trimStart = 0,
        string fit = "contain")
    {
        var descriptor = new PresentationMediaDescriptor(
            Guid.NewGuid(), mediaKind, new Uri($"https://cdn.example.test/{itemId}"), "v1",
            contentType, itemId, trimStart, durationSeconds, false, 1, fit).Validate();
        return new PreparedMediaAsset(
            itemId, serviceId, new string('a', 64), localPath, contentType, mediaKind,
            durationSeconds is { } seconds ? TimeSpan.FromSeconds(seconds) : null, descriptor);
    }

    private static (byte B, byte G, byte R, byte A) Pixel(ProgramVideoFrame frame, int x, int y)
    {
        var span = frame.Buffer.Span;
        var offset = y * frame.Stride + x * 4;
        return (span[offset], span[offset + 1], span[offset + 2], span[offset + 3]);
    }

    private static ProgramVideoFrame Frame(string itemId) =>
        new(320, 180, 1280, "bgra32", new byte[320 * 180 * 4], itemId, DateTimeOffset.UtcNow);

    private static VisualSourceDescriptor Descriptor(string key) => new(
        VisualSourceIdentity.Create("windows", VisualSourceKind.Display, key),
        VisualSourceKind.Display, key, key, VisualSourceAvailability.Available,
        [new VisualCaptureMode(320, 180, 30, "bgra32")], DateTimeOffset.UtcNow, null,
        new Dictionary<string, string>());

    private sealed class CountingRenderer : IProgramFrameRenderer
    {
        public int RenderCount { get; private set; }
        public ProgramVideoFrame Render(PresentationRenderItem? item, int width = 1920, int height = 1080, DateTimeOffset? renderedAt = null)
        {
            RenderCount++;
            return new ProgramVideoFrame(width, height, width * 4, "bgra32", new byte[width * height * 4], item?.ItemId, renderedAt ?? DateTimeOffset.UtcNow);
        }
    }

    private sealed class RecordingMediaVideoFrameProvider : IMediaVideoFrameProvider
    {
        public List<double> Positions { get; } = [];
        public List<PreparedMediaAsset> Assets { get; } = [];
        public ProgramVideoFrame GetFrame(PreparedMediaAsset asset, double positionSeconds, int width, int height)
        {
            Assets.Add(asset);
            Positions.Add(positionSeconds);
            var buffer = new byte[width * height * 4];
            buffer[0] = (byte)Math.Clamp((int)Math.Round(positionSeconds * 20), 0, 255);
            return new ProgramVideoFrame(width, height, width * 4, "bgra32", buffer, asset.ItemId, DateTimeOffset.UtcNow);
        }
    }

    private sealed class FakePreparation : IMediaPreparationCoordinator
    {
        private MediaPreparationSnapshot? _snapshot;
        public event EventHandler<MediaPreparationSnapshot>? StatusChanged { add { } remove { } }
        public void Set(PreparedMediaAsset asset) => _snapshot = new(asset.ItemId, asset.ServiceId, MediaPreparationState.Ready, asset, null);
        public Task<MediaPreparationSnapshot> PrepareAsync(PresentationRenderItem item, CancellationToken cancellationToken) =>
            Task.FromResult(_snapshot ?? new MediaPreparationSnapshot(item.ItemId, item.ServiceId, MediaPreparationState.NotRequired, null, null));
        public MediaPreparationSnapshot? TryGet(string itemId) => _snapshot?.ItemId == itemId ? _snapshot : null;
        public Task PrefetchAsync(Guid serviceId, IReadOnlyList<OperatorCatalogItem> items, CancellationToken cancellationToken) => Task.CompletedTask;
        public IDisposable AcquireReadyLease(string itemId) => new Lease();
        public Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken) => Task.CompletedTask;
        private sealed class Lease : IDisposable { public void Dispose() { } }
    }

    private sealed class FakeCatalog(IReadOnlyList<VisualSourceDescriptor> sources) : IVisualSourceCatalog
    {
        public Task<IReadOnlyList<VisualSourceDescriptor>> ScanAsync(CancellationToken cancellationToken) => Task.FromResult(sources);
    }

    private sealed class FakeFactory(FakeSession session) : IVisualCaptureFactory
    {
        public ValueTask<IVisualCaptureSession> CreateAsync(VisualSourceDescriptor source, VisualCaptureOptions options, CancellationToken cancellationToken) =>
            ValueTask.FromResult<IVisualCaptureSession>(session);
    }

    private sealed class FakeSession(VisualSourceDescriptor source, ProgramVideoFrame frame) : IVisualCaptureSession
    {
        public event EventHandler? StatusChanged;
        public VisualSourceDescriptor Source { get; } = source;
        public ProgramVideoFrame? LatestFrame { get; } = frame;
        public int DisposeCount { get; private set; }
        public VisualCaptureStatus Status { get; private set; } = new(false, VisualSourceAvailability.Disconnected, 0, 0, null, null);
        public Task<VisualCaptureStatus> StartAsync(CancellationToken cancellationToken)
        {
            Status = new(true, VisualSourceAvailability.Available, 1, 0, DateTimeOffset.UtcNow, null);
            StatusChanged?.Invoke(this, EventArgs.Empty);
            return Task.FromResult(Status);
        }
        public Task<VisualCaptureStatus> StopAsync(CancellationToken cancellationToken)
        {
            Status = Status with { IsRunning = false };
            StatusChanged?.Invoke(this, EventArgs.Empty);
            return Task.FromResult(Status);
        }
        public ValueTask DisposeAsync() { DisposeCount++; return ValueTask.CompletedTask; }
    }
}
