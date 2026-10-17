using System.Runtime.InteropServices;
using iPresenterPlux.Edge.Core.Models;
using SharpMediaFoundationInterop.Utils;
using global::Windows.Win32;
using global::Windows.Win32.Media.MediaFoundation;

namespace iPresenterPlux.Edge.Windows;

internal sealed class WindowsMediaFoundationCameraReader : IWindowsCameraReader
{
    private const uint VideoStream = 0xFFFFFFFC;
    private const uint SourceReaderFlagError = 0x00000001;
    private const uint SourceReaderFlagEndOfStream = 0x00000002;
    private const uint SourceReaderFlagNativeMediaTypeChanged = 0x00000010;
    private const uint SourceReaderFlagCurrentMediaTypeChanged = 0x00000020;
    private const int MfNoMoreTypes = unchecked((int)0xC00D36B9);
    private const int MfUnsupportedFormat = unchecked((int)0xC00D3E98);
    private const int MfVideoDeviceInvalidated = unchecked((int)0xC00D3EA2);
    private const int MfVideoDevicePreempted = unchecked((int)0xC00D3EA3);
    private const int EAccessDenied = unchecked((int)0x80070005);
    private const int SharingViolation = unchecked((int)0x80070020);
    private const int DeviceBusy = unchecked((int)0x800700AA);
    private const int DeviceNotConnected = unchecked((int)0x8007048F);

    private static readonly object StartupGate = new();
    private static bool _mediaFoundationStarted;

    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private IMFSourceReader? _reader;
    private IMFMediaSource? _mediaSource;
    private CancellationTokenSource? _captureCts;
    private Task? _captureTask;
    private WindowsCameraModeCandidate? _activeMode;
    private bool _disposed;

    public WindowsMediaFoundationCameraReader(TimeProvider? clock = null)
    {
        _clock = clock ?? TimeProvider.System;
    }

    public event EventHandler<WindowsCameraFrame>? FrameReceived;
    public event EventHandler<WindowsCameraReaderException>? Faulted;

    public async Task<WindowsCameraModeCandidate> StartAsync(
        string nativeId,
        VisualCaptureOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(nativeId);
        ArgumentNullException.ThrowIfNull(options);
        if (!string.Equals(options.PixelFormat, "bgra32", StringComparison.OrdinalIgnoreCase))
            throw new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Unsupported, "Only BGRA32 camera output is supported.");
        EnsureWindows();
        ObjectDisposedException.ThrowIf(_disposed, this);

        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            await StopCoreAsync().ConfigureAwait(false);
            EnsureMediaFoundationStarted();

            try
            {
                (_reader, _mediaSource, _activeMode) = OpenReader(nativeId, options);
                _captureCts = new CancellationTokenSource();
                var reader = _reader;
                var mode = _activeMode;
                _captureTask = Task.Run(() => CaptureLoop(reader, mode, _captureCts.Token), CancellationToken.None);
                return mode;
            }
            catch (WindowsCameraReaderException)
            {
                await StopCoreAsync().ConfigureAwait(false);
                throw;
            }
            catch (Exception error)
            {
                await StopCoreAsync().ConfigureAwait(false);
                throw MapNativeFailure(error, opening: true);
            }
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_disposed) return;
            await StopCoreAsync().ConfigureAwait(false);
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        await _lifecycleGate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed) return;
            await StopCoreAsync().ConfigureAwait(false);
            _disposed = true;
        }
        finally
        {
            _lifecycleGate.Release();
            _lifecycleGate.Dispose();
        }
    }

    internal static WindowsCameraModeCandidate SelectBestMode(
        IReadOnlyList<WindowsCameraModeCandidate> modes,
        VisualCaptureOptions requested)
    {
        ArgumentNullException.ThrowIfNull(modes);
        ArgumentNullException.ThrowIfNull(requested);

        var candidates = modes
            .Where(mode => mode.Width > 0 && mode.Height > 0 && mode.FrameRateDenominator > 0)
            .Where(mode => mode.FramesPerSecond > 0d && mode.FramesPerSecond <= 60d)
            .ToArray();
        if (candidates.Length == 0)
            throw new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Unsupported, "Camera has no supported capture mode at or below 60 fps.");

        return candidates
            .OrderBy(mode => mode.Width == requested.Width && mode.Height == requested.Height ? 0 : 1)
            .ThenBy(mode => Math.Abs(mode.Width - requested.Width) + Math.Abs(mode.Height - requested.Height))
            .ThenBy(mode => Math.Abs(mode.FramesPerSecond - requested.FramesPerSecond))
            .ThenBy(mode => Math.Abs((long)mode.Width * mode.Height - (long)requested.Width * requested.Height))
            .First();
    }

    internal static WindowsCameraReaderException MapNativeFailure(Exception error, bool opening)
    {
        if (error is WindowsCameraReaderException known) return known;
        if (error is UnauthorizedAccessException || error.HResult == EAccessDenied)
            return new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Permission, "Camera permission was denied.", error);
        if (error.HResult is SharingViolation or DeviceBusy or MfVideoDevicePreempted)
            return new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Busy, "Camera is already in use.", error);
        if (error.HResult is DeviceNotConnected or MfVideoDeviceInvalidated)
            return new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Disconnected, "Camera is no longer connected.", error);
        if (error is NotSupportedException || error.HResult == MfUnsupportedFormat)
            return new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Unsupported, "Camera capture format is unsupported.", error);
        return new WindowsCameraReaderException(
            opening ? WindowsCameraReaderFailureKind.Capture : WindowsCameraReaderFailureKind.Capture,
            opening ? "Camera could not be opened." : "Camera capture failed.",
            error);
    }

    private static (IMFSourceReader Reader, IMFMediaSource Source, WindowsCameraModeCandidate Mode) OpenReader(
        string nativeId,
        VisualCaptureOptions requested)
    {
        IMFAttributes? deviceAttributes = null;
        IMFActivate? activate = null;
        IMFMediaSource? source = null;
        IMFAttributes? readerAttributes = null;
        IMFSourceReader? reader = null;
        try
        {
            PInvoke.MFCreateAttributes(out deviceAttributes, 2).ThrowOnFailure();
            deviceAttributes.SetGUID(PInvoke.MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, PInvoke.MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
            deviceAttributes.SetString(PInvoke.MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, nativeId);
            PInvoke.MFCreateDeviceSourceActivate(deviceAttributes, out activate).ThrowOnFailure();
            source = (IMFMediaSource)activate.ActivateObject(typeof(IMFMediaSource).GUID);

            PInvoke.MFCreateAttributes(out readerAttributes, 1).ThrowOnFailure();
            readerAttributes.SetUINT32(PInvoke.MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1);
            PInvoke.MFCreateSourceReaderFromMediaSource(source, readerAttributes, out reader).ThrowOnFailure();

            var nativeModes = EnumerateNativeModes(reader);
            try
            {
                var selected = SelectBestMode(nativeModes.Select(item => item.Candidate).ToArray(), requested);
                var selectedNative = nativeModes.First(item => item.Candidate == selected);
                reader.SetCurrentMediaType(VideoStream, selectedNative.MediaType);
                ConfigureBgraOutput(reader, selected);
                return (reader, source, selected);
            }
            finally
            {
                foreach (var item in nativeModes) ReleaseCom(item.MediaType);
            }
        }
        catch (Exception error)
        {
            ReleaseCom(reader);
            if (source is not null)
            {
                try { source.Shutdown(); } catch { }
                ReleaseCom(source);
            }
            throw MapNativeFailure(error, opening: true);
        }
        finally
        {
            ReleaseCom(readerAttributes);
            ReleaseCom(activate);
            ReleaseCom(deviceAttributes);
        }
    }

    private static List<NativeMode> EnumerateNativeModes(IMFSourceReader reader)
    {
        var modes = new List<NativeMode>();
        for (uint index = 0; ; index++)
        {
            IMFMediaType? mediaType = null;
            try
            {
                reader.GetNativeMediaType(VideoStream, index, out mediaType);
                mediaType.GetUINT64(PInvoke.MF_MT_FRAME_SIZE, out var packedSize);
                mediaType.GetUINT64(PInvoke.MF_MT_FRAME_RATE, out var packedRate);
                mediaType.GetGUID(PInvoke.MF_MT_SUBTYPE, out var subtype);
                var width = checked((int)(packedSize >> 32));
                var height = checked((int)(packedSize & uint.MaxValue));
                var numerator = (uint)(packedRate >> 32);
                var denominator = (uint)(packedRate & uint.MaxValue);
                if (width <= 0 || height <= 0 || numerator == 0 || denominator == 0)
                {
                    ReleaseCom(mediaType);
                    continue;
                }
                modes.Add(new NativeMode(mediaType, new WindowsCameraModeCandidate(width, height, numerator, denominator, subtype)));
                mediaType = null;
            }
            catch (COMException error) when (error.HResult == MfNoMoreTypes)
            {
                ReleaseCom(mediaType);
                break;
            }
            catch
            {
                ReleaseCom(mediaType);
                throw;
            }
        }
        return modes;
    }

    private static void ConfigureBgraOutput(IMFSourceReader reader, WindowsCameraModeCandidate selected)
    {
        IMFMediaType? outputType = null;
        try
        {
            PInvoke.MFCreateMediaType(out outputType).ThrowOnFailure();
            outputType.SetGUID(PInvoke.MF_MT_MAJOR_TYPE, PInvoke.MFMediaType_Video);
            outputType.SetGUID(PInvoke.MF_MT_SUBTYPE, PInvoke.MFVideoFormat_RGB32);
            outputType.SetUINT64(PInvoke.MF_MT_FRAME_SIZE, Pack((uint)selected.Width, (uint)selected.Height));
            outputType.SetUINT64(PInvoke.MF_MT_FRAME_RATE, Pack(selected.FrameRateNumerator, selected.FrameRateDenominator));
            reader.SetCurrentMediaType(VideoStream, outputType);
        }
        catch (Exception error)
        {
            throw new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Unsupported, "Camera cannot provide BGRA32 output for the selected mode.", error);
        }
        finally
        {
            ReleaseCom(outputType);
        }
    }

    private void CaptureLoop(
        IMFSourceReader reader,
        WindowsCameraModeCandidate mode,
        CancellationToken cancellationToken)
    {
        try
        {
            var stride = checked(mode.Width * 4);
            var outputSize = checked(stride * mode.Height);
            while (!cancellationToken.IsCancellationRequested)
            {
                reader.ReadSample(VideoStream, 0, out _, out var flags, out _, out IMFSample? sample);
                if (cancellationToken.IsCancellationRequested)
                {
                    ReleaseCom(sample);
                    break;
                }
                if ((flags & SourceReaderFlagEndOfStream) != 0)
                    throw new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Disconnected, "Camera stream ended.");
                if ((flags & SourceReaderFlagError) != 0)
                    throw new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Capture, "Media Foundation reported a camera read error.");
                if ((flags & (SourceReaderFlagNativeMediaTypeChanged | SourceReaderFlagCurrentMediaTypeChanged)) != 0)
                    throw new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Capture, "Camera media type changed during capture.");
                if (sample is null) continue;

                IMFMediaBuffer? buffer = null;
                try
                {
                    sample.ConvertToContiguousBuffer(out buffer);
                    var pixels = new byte[outputSize];
                    if (!MediaUtils.CopyBuffer(buffer, pixels, out var copied) || copied != outputSize)
                        throw new WindowsCameraReaderException(WindowsCameraReaderFailureKind.Capture, "Camera returned an unexpected frame size.");
                    for (var alpha = 3; alpha < pixels.Length; alpha += 4) pixels[alpha] = byte.MaxValue;
                    try
                    {
                        FrameReceived?.Invoke(this, new WindowsCameraFrame(mode.Width, mode.Height, stride, pixels, _clock.GetUtcNow()));
                    }
                    catch
                    {
                        // Capture must not be terminated by an observer callback.
                    }
                }
                finally
                {
                    ReleaseCom(buffer);
                    ReleaseCom(sample);
                }
            }
        }
        catch (Exception error) when (!cancellationToken.IsCancellationRequested)
        {
            var mapped = MapNativeFailure(error, opening: false);
            try { Faulted?.Invoke(this, mapped); } catch { }
        }
    }

    private async Task StopCoreAsync()
    {
        var cts = _captureCts;
        var task = _captureTask;
        var reader = _reader;
        var source = _mediaSource;
        _captureCts = null;
        _captureTask = null;
        _reader = null;
        _mediaSource = null;
        _activeMode = null;

        if (cts is not null) cts.Cancel();
        if (reader is not null)
        {
            try { reader.Flush(VideoStream); } catch { }
        }
        if (task is not null)
        {
            try { await task.ConfigureAwait(false); }
            catch (OperationCanceledException) when (cts?.IsCancellationRequested == true) { }
        }
        cts?.Dispose();
        ReleaseCom(reader);
        if (source is not null)
        {
            try { source.Shutdown(); } catch { }
            ReleaseCom(source);
        }
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
            throw new PlatformNotSupportedException("Media Foundation camera capture requires Windows.");
    }

    private static ulong Pack(uint high, uint low) => ((ulong)high << 32) | low;

    private static void ReleaseCom(object? value)
    {
        if (value is null || !Marshal.IsComObject(value)) return;
        try { Marshal.FinalReleaseComObject(value); } catch { }
    }

    private sealed record NativeMode(IMFMediaType MediaType, WindowsCameraModeCandidate Candidate);
}
