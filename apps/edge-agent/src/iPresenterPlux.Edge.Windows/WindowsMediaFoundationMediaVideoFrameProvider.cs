using System.Runtime.InteropServices;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Runtime;
using SharpMediaFoundationInterop.Utils;
using SkiaSharp;
using global::Windows.Win32;
using global::Windows.Win32.Media.MediaFoundation;

namespace iPresenterPlux.Edge.Windows;

public sealed class WindowsMediaFoundationMediaVideoFrameProvider : IMediaVideoFrameProvider, IDisposable
{
    private const uint VideoStream = 0xFFFFFFFC;
    private const uint SourceReaderFlagError = 0x00000001;
    private const uint SourceReaderFlagEndOfStream = 0x00000002;
    private const uint SourceReaderFlagNativeMediaTypeChanged = 0x00000010;
    private const uint SourceReaderFlagCurrentMediaTypeChanged = 0x00000020;
    private static readonly object StartupGate = new();
    private static bool _mediaFoundationStarted;

    private readonly object _gate = new();
    private DecoderSession? _session;
    private string? _sessionIdentity;
    private bool _disposed;

    public ProgramVideoFrame GetFrame(
        PreparedMediaAsset asset,
        double positionSeconds,
        int width,
        int height)
    {
        ArgumentNullException.ThrowIfNull(asset);
        ObjectDisposedException.ThrowIf(_disposed, this);
        EnsureWindows();
        ValidateAsset(asset);
        if (!double.IsFinite(positionSeconds) || positionSeconds < 0)
            throw new ArgumentOutOfRangeException(nameof(positionSeconds));
        if (width <= 0 || height <= 0)
            throw new ArgumentOutOfRangeException(width <= 0 ? nameof(width) : nameof(height));

        lock (_gate)
        {
            try
            {
                var identity = $"{asset.CacheKey}|{asset.LocalPath}";
                if (_session is null ||
                    !string.Equals(_sessionIdentity, identity, StringComparison.Ordinal) ||
                    positionSeconds + .001 < _session.LastRequestedPositionSeconds)
                {
                    ResetSessionUnsafe();
                    _session = DecoderSession.Open(asset.LocalPath);
                    _sessionIdentity = identity;
                }

                var decoded = _session.DecodeAt(positionSeconds);
                return ScaleFrame(decoded, asset, width, height);
            }
            catch (MediaVideoFrameProviderException)
            {
                ResetSessionUnsafe();
                throw;
            }
            catch (Exception error)
            {
                ResetSessionUnsafe();
                throw new MediaVideoFrameProviderException(
                    "media_video_decode_failed",
                    "Prepared media video could not be decoded.",
                    error);
            }
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        lock (_gate)
        {
            if (_disposed) return;
            ResetSessionUnsafe();
            _disposed = true;
        }
    }

    private static void ValidateAsset(PreparedMediaAsset asset)
    {
        if (!string.Equals(asset.MediaKind, "video", StringComparison.OrdinalIgnoreCase))
            throw new MediaVideoFrameProviderException("media_video_kind_invalid", "Prepared asset is not video media.");
        var path = asset.LocalPath;
        if (string.IsNullOrWhiteSpace(path) ||
            !Path.IsPathFullyQualified(path) ||
            (Uri.TryCreate(path, UriKind.Absolute, out var uri) && !uri.IsFile) ||
            !File.Exists(path))
        {
            throw new MediaVideoFrameProviderException(
                "media_video_local_file_required",
                "Prepared video must reference an existing local cache file.");
        }
    }

    private static ProgramVideoFrame ScaleFrame(
        DecodedFrame decoded,
        PreparedMediaAsset asset,
        int width,
        int height)
    {
        using var source = new SKBitmap(new SKImageInfo(
            decoded.Width,
            decoded.Height,
            SKColorType.Bgra8888,
            SKAlphaType.Opaque));
        Marshal.Copy(decoded.Buffer, 0, source.GetPixels(), decoded.Buffer.Length);

        var targetInfo = new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Opaque);
        using var target = new SKBitmap(targetInfo);
        using var canvas = new SKCanvas(target);
        canvas.Clear(SKColors.Black);
        var destination = FitRectangle(
            decoded.Width,
            decoded.Height,
            width,
            height,
            asset.Descriptor.Fit);
        using var paint = new SKPaint { IsAntialias = true };
        canvas.DrawBitmap(source, destination, new SKSamplingOptions(SKFilterMode.Linear), paint);
        canvas.Flush();

        var output = new byte[checked(target.RowBytes * target.Height)];
        Marshal.Copy(target.GetPixels(), output, 0, output.Length);
        return new ProgramVideoFrame(
            width,
            height,
            target.RowBytes,
            "bgra32",
            output,
            asset.ItemId,
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
        return SKRect.Create(
            (width - drawWidth) * .5f,
            (height - drawHeight) * .5f,
            drawWidth,
            drawHeight);
    }

    private void ResetSessionUnsafe()
    {
        _session?.Dispose();
        _session = null;
        _sessionIdentity = null;
    }

    private static void EnsureMediaFoundationStarted()
    {
        if (_mediaFoundationStarted) return;
        lock (StartupGate)
        {
            if (_mediaFoundationStarted) return;
            PInvoke.MFStartup(PInvoke.MF_API_VERSION, 0).ThrowOnFailure();
            _mediaFoundationStarted = true;
        }
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Media Foundation media-video decoding requires Windows.");
    }

    private static ulong Pack(uint high, uint low) => ((ulong)high << 32) | low;

    private static void ReleaseCom(object? value)
    {
        if (value is null || !Marshal.IsComObject(value)) return;
        try { Marshal.FinalReleaseComObject(value); } catch { }
    }

    private sealed class DecoderSession : IDisposable
    {
        private readonly IMFSourceReader _reader;
        private readonly int _width;
        private readonly int _height;
        private readonly int _stride;
        private byte[]? _lastFrame;
        private long _lastTimestamp100Ns;
        private bool _disposed;

        private DecoderSession(IMFSourceReader reader, int width, int height)
        {
            _reader = reader;
            _width = width;
            _height = height;
            _stride = checked(width * 4);
        }

        public double LastRequestedPositionSeconds { get; private set; } = -1;

        public static DecoderSession Open(string localPath)
        {
            EnsureMediaFoundationStarted();
            IMFAttributes? attributes = null;
            IMFSourceReader? reader = null;
            IMFMediaType? nativeType = null;
            IMFMediaType? outputType = null;
            try
            {
                PInvoke.MFCreateAttributes(out attributes, 1).ThrowOnFailure();
                attributes.SetUINT32(PInvoke.MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1);
                PInvoke.MFCreateSourceReaderFromURL(localPath, attributes, out reader).ThrowOnFailure();
                reader.GetNativeMediaType(VideoStream, 0, out nativeType);
                nativeType.GetUINT64(PInvoke.MF_MT_FRAME_SIZE, out var packedSize);
                var width = checked((int)(packedSize >> 32));
                var height = checked((int)(packedSize & uint.MaxValue));
                if (width <= 0 || height <= 0)
                    throw new InvalidDataException("Video has invalid dimensions.");

                PInvoke.MFCreateMediaType(out outputType).ThrowOnFailure();
                outputType.SetGUID(PInvoke.MF_MT_MAJOR_TYPE, PInvoke.MFMediaType_Video);
                outputType.SetGUID(PInvoke.MF_MT_SUBTYPE, PInvoke.MFVideoFormat_RGB32);
                outputType.SetUINT64(PInvoke.MF_MT_FRAME_SIZE, Pack((uint)width, (uint)height));
                reader.SetCurrentMediaType(VideoStream, outputType);

                var session = new DecoderSession(reader, width, height);
                reader = null;
                return session;
            }
            finally
            {
                ReleaseCom(outputType);
                ReleaseCom(nativeType);
                ReleaseCom(reader);
                ReleaseCom(attributes);
            }
        }

        public DecodedFrame DecodeAt(double positionSeconds)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var target100Ns = checked((long)Math.Round(positionSeconds * 10_000_000d));
            while (_lastFrame is null || _lastTimestamp100Ns < target100Ns)
            {
                _reader.ReadSample(VideoStream, 0, out _, out var flags, out var timestamp100Ns, out IMFSample? sample);
                if ((flags & SourceReaderFlagEndOfStream) != 0)
                {
                    ReleaseCom(sample);
                    break;
                }
                if ((flags & SourceReaderFlagError) != 0)
                {
                    ReleaseCom(sample);
                    throw new MediaVideoFrameProviderException("media_video_decode_failed", "Media Foundation reported a video decode error.");
                }
                if ((flags & (SourceReaderFlagNativeMediaTypeChanged | SourceReaderFlagCurrentMediaTypeChanged)) != 0)
                {
                    ReleaseCom(sample);
                    throw new MediaVideoFrameProviderException("media_video_decode_failed", "Video media type changed during decode.");
                }
                if (sample is null) continue;

                IMFMediaBuffer? buffer = null;
                try
                {
                    sample.ConvertToContiguousBuffer(out buffer);
                    var pixels = new byte[checked(_stride * _height)];
                    if (!MediaUtils.CopyBuffer(buffer, pixels, out var copied) || copied != pixels.Length)
                        throw new MediaVideoFrameProviderException("media_video_decode_failed", "Decoded video frame had an unexpected size.");
                    for (var alpha = 3; alpha < pixels.Length; alpha += 4) pixels[alpha] = byte.MaxValue;
                    _lastFrame = pixels;
                    _lastTimestamp100Ns = timestamp100Ns;
                }
                finally
                {
                    ReleaseCom(buffer);
                    ReleaseCom(sample);
                }
            }

            LastRequestedPositionSeconds = positionSeconds;
            if (_lastFrame is null)
                throw new MediaVideoFrameProviderException("media_video_decode_failed", "Video produced no decoded frames.");
            return new DecodedFrame(_width, _height, _stride, _lastFrame, _lastTimestamp100Ns);
        }

        public void Dispose()
        {
            if (_disposed) return;
            try { _reader.Flush(VideoStream); } catch { }
            ReleaseCom(_reader);
            _lastFrame = null;
            _disposed = true;
        }
    }

    private sealed record DecodedFrame(int Width, int Height, int Stride, byte[] Buffer, long Timestamp100Ns);
}
