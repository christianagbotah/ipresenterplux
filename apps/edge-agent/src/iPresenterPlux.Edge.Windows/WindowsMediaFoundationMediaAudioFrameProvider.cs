using System.Runtime.InteropServices;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using SharpMediaFoundationInterop.Utils;
using global::Windows.Win32;
using global::Windows.Win32.Media.MediaFoundation;

namespace iPresenterPlux.Edge.Windows;

public sealed class WindowsMediaFoundationMediaAudioFrameProvider : IMediaAudioFrameProvider, IDisposable
{
    private const uint AudioStream = 0xFFFFFFFD;
    private const uint SourceReaderFlagError = 0x00000001;
    private const uint SourceReaderFlagEndOfStream = 0x00000002;
    private const uint SourceReaderFlagNativeMediaTypeChanged = 0x00000010;
    private const uint SourceReaderFlagCurrentMediaTypeChanged = 0x00000020;

    [DllImport("mfreadwrite.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int MFCreateSourceReaderFromURL(
        [MarshalAs(UnmanagedType.LPWStr)] string url,
        IMFAttributes? attributes,
        out IMFSourceReader sourceReader);

    private static readonly object StartupGate = new();
    private static bool _mediaFoundationStarted;

    private readonly object _gate = new();
    private DecoderSession? _session;
    private string? _sessionIdentity;
    private long _sessionRevision = long.MinValue;
    private bool _disposed;

    public Task<AudioFrame?> ReadPcmAsync(
        PreparedMediaAsset asset,
        MediaPlaybackSnapshot playback,
        int sampleRate,
        int channels,
        int frameSamples,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(asset);
        ArgumentNullException.ThrowIfNull(playback);
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        EnsureWindows();
        ValidateAsset(asset, playback);
        if (sampleRate is < 8_000 or > 192_000) throw new ArgumentOutOfRangeException(nameof(sampleRate));
        if (channels is < 1 or > 2) throw new ArgumentOutOfRangeException(nameof(channels));
        if (frameSamples is < 1 or > 16_384) throw new ArgumentOutOfRangeException(nameof(frameSamples));
        if (!double.IsFinite(playback.EffectivePositionSeconds) || playback.EffectivePositionSeconds < 0)
            throw new ArgumentOutOfRangeException(nameof(playback));

        lock (_gate)
        {
            try
            {
                cancellationToken.ThrowIfCancellationRequested();
                var identity = $"{asset.CacheKey}|{asset.LocalPath}|{sampleRate}|{channels}";
                if (_session is null ||
                    !string.Equals(_sessionIdentity, identity, StringComparison.Ordinal) ||
                    _sessionRevision != playback.Revision ||
                    playback.EffectivePositionSeconds + .001 < _session.LastRequestedPositionSeconds)
                {
                    ResetSessionUnsafe();
                    _session = DecoderSession.Open(asset.LocalPath, sampleRate, channels);
                    _sessionIdentity = identity;
                    _sessionRevision = playback.Revision;
                }

                var decoded = _session.ReadAt(playback.EffectivePositionSeconds, frameSamples, cancellationToken);
                if (decoded is null) return Task.FromResult<AudioFrame?>(null);
                return Task.FromResult<AudioFrame?>(new AudioFrame(
                    decoded,
                    decoded.Length,
                    sampleRate,
                    channels,
                    16,
                    DateTimeOffset.UnixEpoch.AddSeconds(playback.EffectivePositionSeconds),
                    AudioSampleEncoding.PcmInteger));
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (MediaAudioFrameProviderException)
            {
                ResetSessionUnsafe();
                throw;
            }
            catch (Exception error)
            {
                ResetSessionUnsafe();
                throw new MediaAudioFrameProviderException(
                    "media_audio_decode_failed",
                    "Prepared media audio could not be decoded.",
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

    private static void ValidateAsset(PreparedMediaAsset asset, MediaPlaybackSnapshot playback)
    {
        if (asset.MediaKind is not ("audio" or "video"))
            throw new MediaAudioFrameProviderException("media_audio_kind_invalid", "Prepared asset is not audio-capable media.");
        if (!string.Equals(asset.ItemId, playback.ItemId, StringComparison.Ordinal) ||
            asset.ServiceId != playback.ServiceId ||
            !string.Equals(asset.CacheKey, playback.CacheKey, StringComparison.Ordinal))
        {
            throw new MediaAudioFrameProviderException("media_audio_scope_mismatch", "Playback does not match the prepared media asset.");
        }
        var path = asset.LocalPath;
        if (string.IsNullOrWhiteSpace(path) ||
            !Path.IsPathFullyQualified(path) ||
            (Uri.TryCreate(path, UriKind.Absolute, out var uri) && !uri.IsFile) ||
            !File.Exists(path))
        {
            throw new MediaAudioFrameProviderException(
                "media_audio_local_file_required",
                "Prepared media audio must reference an existing local cache file.");
        }
    }

    private void ResetSessionUnsafe()
    {
        _session?.Dispose();
        _session = null;
        _sessionIdentity = null;
        _sessionRevision = long.MinValue;
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
            throw new PlatformNotSupportedException("Media Foundation media-audio decoding requires Windows.");
    }

    private static void ReleaseCom(object? value)
    {
        if (value is null || !Marshal.IsComObject(value)) return;
        try { Marshal.FinalReleaseComObject(value); } catch { }
    }

    private sealed class DecoderSession : IDisposable
    {
        private readonly IMFSourceReader _reader;
        private readonly int _sampleRate;
        private readonly int _channels;
        private readonly int _blockAlign;
        private byte[]? _pending;
        private double _pendingStartSeconds;
        private bool _endOfStream;
        private bool _disposed;

        private DecoderSession(IMFSourceReader reader, int sampleRate, int channels)
        {
            _reader = reader;
            _sampleRate = sampleRate;
            _channels = channels;
            _blockAlign = checked(channels * sizeof(short));
        }

        public double LastRequestedPositionSeconds { get; private set; } = -1;

        public static DecoderSession Open(string localPath, int sampleRate, int channels)
        {
            EnsureMediaFoundationStarted();
            IMFSourceReader? reader = null;
            IMFMediaType? outputType = null;
            try
            {
                Marshal.ThrowExceptionForHR(MFCreateSourceReaderFromURL(localPath, null, out var createdReader));
                reader = createdReader;
                PInvoke.MFCreateMediaType(out outputType).ThrowOnFailure();
                outputType.SetGUID(PInvoke.MF_MT_MAJOR_TYPE, PInvoke.MFMediaType_Audio);
                outputType.SetGUID(PInvoke.MF_MT_SUBTYPE, PInvoke.MFAudioFormat_PCM);
                outputType.SetUINT32(PInvoke.MF_MT_AUDIO_NUM_CHANNELS, (uint)channels);
                outputType.SetUINT32(PInvoke.MF_MT_AUDIO_SAMPLES_PER_SECOND, (uint)sampleRate);
                outputType.SetUINT32(PInvoke.MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
                outputType.SetUINT32(PInvoke.MF_MT_AUDIO_BLOCK_ALIGNMENT, (uint)(channels * sizeof(short)));
                outputType.SetUINT32(PInvoke.MF_MT_AUDIO_AVG_BYTES_PER_SECOND, (uint)(sampleRate * channels * sizeof(short)));
                createdReader.SetCurrentMediaType(AudioStream, outputType);

                var session = new DecoderSession(createdReader, sampleRate, channels);
                reader = null;
                return session;
            }
            finally
            {
                ReleaseCom(outputType);
                ReleaseCom(reader);
            }
        }

        public byte[]? ReadAt(double positionSeconds, int frameSamples, CancellationToken cancellationToken)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            cancellationToken.ThrowIfCancellationRequested();
            var requiredBytes = checked(frameSamples * _blockAlign);
            var output = new byte[requiredBytes];
            var written = 0;
            var cursor = positionSeconds;
            var sawAudio = false;

            while (written < requiredBytes)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!EnsurePending(cursor, cancellationToken)) break;
                if (_pending is null || _pending.Length == 0) break;

                var pendingFrames = _pending.Length / _blockAlign;
                var pendingEnd = _pendingStartSeconds + pendingFrames / (double)_sampleRate;
                if (cursor >= pendingEnd - .000001)
                {
                    _pending = null;
                    continue;
                }

                var skipFrames = cursor > _pendingStartSeconds
                    ? Math.Clamp((int)Math.Floor((cursor - _pendingStartSeconds) * _sampleRate), 0, pendingFrames)
                    : 0;
                var availableFrames = pendingFrames - skipFrames;
                if (availableFrames <= 0)
                {
                    _pending = null;
                    continue;
                }

                var requestedFrames = (requiredBytes - written) / _blockAlign;
                var copyFrames = Math.Min(availableFrames, requestedFrames);
                var sourceOffset = checked(skipFrames * _blockAlign);
                var copyBytes = checked(copyFrames * _blockAlign);
                Buffer.BlockCopy(_pending, sourceOffset, output, written, copyBytes);
                written += copyBytes;
                sawAudio = true;
                cursor += copyFrames / (double)_sampleRate;

                var consumedFrames = skipFrames + copyFrames;
                if (consumedFrames >= pendingFrames)
                {
                    _pending = null;
                }
                else
                {
                    var remainingBytes = checked((pendingFrames - consumedFrames) * _blockAlign);
                    var remaining = new byte[remainingBytes];
                    Buffer.BlockCopy(_pending, checked(consumedFrames * _blockAlign), remaining, 0, remainingBytes);
                    _pending = remaining;
                    _pendingStartSeconds += consumedFrames / (double)_sampleRate;
                }
            }

            LastRequestedPositionSeconds = positionSeconds;
            if (!sawAudio && _endOfStream) return null;
            return output;
        }

        private bool EnsurePending(double requestedPosition, CancellationToken cancellationToken)
        {
            while (_pending is null || _pending.Length == 0 || PendingEndSeconds() <= requestedPosition + .000001)
            {
                _pending = null;
                if (_endOfStream) return false;
                cancellationToken.ThrowIfCancellationRequested();
                _reader.ReadSample(AudioStream, 0, out _, out var flags, out var timestamp100Ns, out IMFSample? sample);
                if ((flags & SourceReaderFlagEndOfStream) != 0)
                {
                    ReleaseCom(sample);
                    _endOfStream = true;
                    return false;
                }
                if ((flags & SourceReaderFlagError) != 0)
                {
                    ReleaseCom(sample);
                    throw new MediaAudioFrameProviderException("media_audio_decode_failed", "Media Foundation reported an audio decode error.");
                }
                _ = flags & (SourceReaderFlagNativeMediaTypeChanged | SourceReaderFlagCurrentMediaTypeChanged);
                if (sample is null) continue;

                IMFMediaBuffer? buffer = null;
                try
                {
                    sample.ConvertToContiguousBuffer(out buffer);
                    buffer.GetCurrentLength(out var currentLength);
                    if (currentLength == 0) continue;
                    var bytes = new byte[checked((int)currentLength)];
                    if (!MediaUtils.CopyBuffer(buffer, bytes, out var copied) || copied != bytes.Length || bytes.Length % _blockAlign != 0)
                        throw new MediaAudioFrameProviderException("media_audio_decode_failed", "Decoded media audio had an unexpected PCM size.");
                    _pending = bytes;
                    _pendingStartSeconds = timestamp100Ns / 10_000_000d;
                }
                finally
                {
                    ReleaseCom(buffer);
                    ReleaseCom(sample);
                }
            }
            return true;
        }

        private double PendingEndSeconds() => _pending is null
            ? _pendingStartSeconds
            : _pendingStartSeconds + (_pending.Length / _blockAlign) / (double)_sampleRate;

        public void Dispose()
        {
            if (_disposed) return;
            try { _reader.Flush(AudioStream); } catch { }
            ReleaseCom(_reader);
            _pending = null;
            _disposed = true;
        }
    }
}
