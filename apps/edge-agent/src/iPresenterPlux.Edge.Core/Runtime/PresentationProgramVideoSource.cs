using System.Runtime.InteropServices;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using SkiaSharp;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class PresentationProgramVideoSource : IProgramVideoSource
{
    private readonly LocalWebProgramOutputService _programOutput;
    private readonly IProgramFrameRenderer _renderer;
    private readonly MediaPlaybackCoordinator _playback;
    private readonly IMediaPreparationCoordinator _mediaPreparation;
    private readonly IMediaVideoFrameProvider _mediaVideoFrames;
    private readonly int _width;
    private readonly int _height;
    private readonly object _gate = new();
    private PresentationRenderItem? _cachedItem;
    private string? _cachedAssetKey;
    private ProgramVideoFrame? _cachedFrame;

    public PresentationProgramVideoSource(
        LocalWebProgramOutputService programOutput,
        IProgramFrameRenderer renderer,
        MediaPlaybackCoordinator playback,
        IMediaPreparationCoordinator mediaPreparation,
        IMediaVideoFrameProvider mediaVideoFrames,
        int width = 1920,
        int height = 1080)
    {
        _programOutput = programOutput ?? throw new ArgumentNullException(nameof(programOutput));
        _renderer = renderer ?? throw new ArgumentNullException(nameof(renderer));
        _playback = playback ?? throw new ArgumentNullException(nameof(playback));
        _mediaPreparation = mediaPreparation ?? throw new ArgumentNullException(nameof(mediaPreparation));
        _mediaVideoFrames = mediaVideoFrames ?? throw new ArgumentNullException(nameof(mediaVideoFrames));
        if (width < 320 || width > 7680) throw new ArgumentOutOfRangeException(nameof(width));
        if (height < 180 || height > 4320) throw new ArgumentOutOfRangeException(nameof(height));
        _width = width;
        _height = height;
    }

    public ProgramVideoFrame GetCurrentFrame()
    {
        var item = _programOutput.Snapshot.Program;
        if (item?.Media is not { } media)
            return GetStaticFrame(item, assetKey: null);

        var prepared = _mediaPreparation.TryGet(item.ItemId);
        var asset = prepared is { State: MediaPreparationState.Ready, Asset: not null } &&
                    prepared.ServiceId == item.ServiceId &&
                    prepared.Asset.ServiceId == item.ServiceId
            ? prepared.Asset
            : null;
        if (asset is null)
            return GetStaticFrame(item, assetKey: null);

        return media.MediaKind.ToLowerInvariant() switch
        {
            "image" => GetImageFrame(item, asset),
            "video" => GetVideoFrame(item, asset),
            "audio" => GetStaticFrame(item, asset.CacheKey),
            _ => GetStaticFrame(item, asset.CacheKey)
        };
    }

    private ProgramVideoFrame GetVideoFrame(PresentationRenderItem item, PreparedMediaAsset asset)
    {
        var playback = _playback.Snapshot;
        if (playback is null ||
            playback.ServiceId != item.ServiceId ||
            !string.Equals(playback.ItemId, item.ItemId, StringComparison.Ordinal) ||
            !string.Equals(playback.CacheKey, asset.CacheKey, StringComparison.Ordinal) ||
            playback.MediaKind != "video")
        {
            return GetStaticFrame(item, asset.CacheKey);
        }

        return _mediaVideoFrames.GetFrame(asset, playback.EffectivePositionSeconds, _width, _height);
    }

    private ProgramVideoFrame GetStaticFrame(PresentationRenderItem? item, string? assetKey)
    {
        lock (_gate)
        {
            if (_cachedFrame is null || !Equals(_cachedItem, item) || !string.Equals(_cachedAssetKey, assetKey, StringComparison.Ordinal))
            {
                _cachedItem = item;
                _cachedAssetKey = assetKey;
                _cachedFrame = _renderer.Render(item, _width, _height);
            }
            return _cachedFrame;
        }
    }

    private ProgramVideoFrame GetImageFrame(PresentationRenderItem item, PreparedMediaAsset asset)
    {
        lock (_gate)
        {
            if (_cachedFrame is not null && Equals(_cachedItem, item) &&
                string.Equals(_cachedAssetKey, asset.CacheKey, StringComparison.Ordinal))
            {
                return _cachedFrame;
            }

            var frame = RenderImage(asset, item.ItemId, item.Media?.Fit ?? "contain");
            _cachedItem = item;
            _cachedAssetKey = asset.CacheKey;
            _cachedFrame = frame;
            return frame;
        }
    }

    private ProgramVideoFrame RenderImage(PreparedMediaAsset asset, string itemId, string fit)
    {
        if (!IsLocalFilePath(asset.LocalPath) || !File.Exists(asset.LocalPath))
            throw new InvalidDataException("Prepared image asset is not available as a validated local file.");

        using var source = SKBitmap.Decode(asset.LocalPath)
            ?? throw new InvalidDataException("Prepared image asset could not be decoded.");
        if (source.Width <= 0 || source.Height <= 0)
            throw new InvalidDataException("Prepared image asset has invalid dimensions.");

        var info = new SKImageInfo(_width, _height, SKColorType.Bgra8888, SKAlphaType.Opaque);
        using var target = new SKBitmap(info);
        using var canvas = new SKCanvas(target);
        canvas.Clear(SKColors.Black);
        var destination = FitRectangle(source.Width, source.Height, _width, _height, fit);
        using var paint = new SKPaint { IsAntialias = true };
        canvas.DrawBitmap(source, destination, new SKSamplingOptions(SKFilterMode.Linear), paint);
        canvas.Flush();

        var length = checked(target.RowBytes * target.Height);
        var buffer = new byte[length];
        Marshal.Copy(target.GetPixels(), buffer, 0, length);
        return new ProgramVideoFrame(
            _width,
            _height,
            target.RowBytes,
            "bgra32",
            buffer,
            itemId,
            DateTimeOffset.UtcNow);
    }

    private static SKRect FitRectangle(int sourceWidth, int sourceHeight, int width, int height, string fit)
    {
        var scaleX = (float)width / sourceWidth;
        var scaleY = (float)height / sourceHeight;
        var scale = string.Equals(fit, "cover", StringComparison.OrdinalIgnoreCase)
            ? Math.Max(scaleX, scaleY)
            : Math.Min(scaleX, scaleY);
        var drawWidth = sourceWidth * scale;
        var drawHeight = sourceHeight * scale;
        var left = (width - drawWidth) * .5f;
        var top = (height - drawHeight) * .5f;
        return SKRect.Create(left, top, drawWidth, drawHeight);
    }

    private static bool IsLocalFilePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        if (Uri.TryCreate(path, UriKind.Absolute, out var uri) && !uri.IsFile) return false;
        return Path.IsPathFullyQualified(path);
    }
}
