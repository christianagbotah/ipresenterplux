using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.MacOS;

public sealed record MacOSMediaAudioReadResult(byte[] Buffer, long TimestampMicroseconds);

public interface IMacOSMediaAudioNativeBridge
{
    int GetApiVersion();
    long OpenMediaAudio(string localPath, int sampleRate, int channels);
    void SeekMediaAudio(long handle, long positionMicroseconds);
    MacOSMediaAudioReadResult? ReadMediaAudio(long handle, int frameSamples);
    void CloseMediaAudio(long handle);
}

public sealed class MacOSMediaAudioFrameProvider : IMediaAudioFrameProvider, IDisposable
{
    private const int RequiredBridgeApiVersion = 5;
    private readonly IMacOSMediaAudioNativeBridge _bridge;
    private readonly object _gate = new();
    private long? _handle;
    private string? _identity;
    private long _revision = long.MinValue;
    private double _nextPositionSeconds = double.NaN;
    private bool _disposed;

    public MacOSMediaAudioFrameProvider(IMacOSMediaAudioNativeBridge bridge) =>
        _bridge = bridge ?? throw new ArgumentNullException(nameof(bridge));

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
        Validate(asset, playback, sampleRate, channels, frameSamples);

        lock (_gate)
        {
            try
            {
                if (_bridge.GetApiVersion() < RequiredBridgeApiVersion)
                    throw new MediaAudioFrameProviderException("native_bridge_outdated", "macOS media bridge API v5 or newer is required.");

                var identity = $"{asset.CacheKey}|{asset.LocalPath}|{sampleRate}|{channels}";
                if (_handle is null || !string.Equals(_identity, identity, StringComparison.Ordinal))
                {
                    ResetUnsafe();
                    _handle = _bridge.OpenMediaAudio(asset.LocalPath, sampleRate, channels);
                    if (_handle <= 0)
                        throw new MediaAudioFrameProviderException("media_audio_decode_failed", "macOS media bridge did not open the prepared asset.");
                    _identity = identity;
                    _revision = long.MinValue;
                    _nextPositionSeconds = double.NaN;
                }

                var requiresSeek = _revision != playback.Revision ||
                    !double.IsFinite(_nextPositionSeconds) ||
                    Math.Abs(playback.EffectivePositionSeconds - _nextPositionSeconds) > .035;
                if (requiresSeek)
                {
                    var positionUs = checked((long)Math.Round(playback.EffectivePositionSeconds * 1_000_000d));
                    _bridge.SeekMediaAudio(_handle.Value, positionUs);
                }

                _revision = playback.Revision;
                var decoded = _bridge.ReadMediaAudio(_handle.Value, frameSamples);
                _nextPositionSeconds = playback.EffectivePositionSeconds + frameSamples / (double)sampleRate;
                if (decoded is null) return Task.FromResult<AudioFrame?>(null);

                var required = checked(frameSamples * channels * sizeof(short));
                if (decoded.Buffer.Length != required)
                    throw new MediaAudioFrameProviderException("media_audio_decode_failed", "macOS media bridge returned an unexpected PCM frame size.");

                return Task.FromResult<AudioFrame?>(new AudioFrame(
                    decoded.Buffer,
                    decoded.Buffer.Length,
                    sampleRate,
                    channels,
                    16,
                    DateTimeOffset.UnixEpoch.AddTicks(checked(decoded.TimestampMicroseconds * 10)),
                    AudioSampleEncoding.PcmInteger));
            }
            catch (MediaAudioFrameProviderException)
            {
                throw;
            }
            catch (Exception error)
            {
                ResetUnsafe();
                throw new MediaAudioFrameProviderException("media_audio_decode_failed", "Prepared macOS media audio could not be decoded.", error);
            }
        }
    }

    public void Reset()
    {
        if (_disposed) return;
        lock (_gate) ResetUnsafe();
    }

    public void Dispose()
    {
        if (_disposed) return;
        lock (_gate)
        {
            if (_disposed) return;
            ResetUnsafe();
            _disposed = true;
        }
    }

    private static void Validate(
        PreparedMediaAsset asset,
        MediaPlaybackSnapshot playback,
        int sampleRate,
        int channels,
        int frameSamples)
    {
        if (asset.MediaKind is not ("audio" or "video"))
            throw new MediaAudioFrameProviderException("media_audio_kind_invalid", "Prepared asset is not audio-capable media.");
        if (!string.Equals(asset.ItemId, playback.ItemId, StringComparison.Ordinal) ||
            asset.ServiceId != playback.ServiceId ||
            !string.Equals(asset.CacheKey, playback.CacheKey, StringComparison.Ordinal))
            throw new MediaAudioFrameProviderException("media_audio_scope_mismatch", "Playback does not match the prepared media asset.");
        if (string.IsNullOrWhiteSpace(asset.LocalPath) || !Path.IsPathFullyQualified(asset.LocalPath) ||
            (Uri.TryCreate(asset.LocalPath, UriKind.Absolute, out var uri) && !uri.IsFile) || !File.Exists(asset.LocalPath))
            throw new MediaAudioFrameProviderException("media_audio_local_file_required", "Prepared media audio must reference an existing local cache file.");
        if (sampleRate is < 8_000 or > 192_000) throw new ArgumentOutOfRangeException(nameof(sampleRate));
        if (channels is < 1 or > 2) throw new ArgumentOutOfRangeException(nameof(channels));
        if (frameSamples is < 1 or > 16_384) throw new ArgumentOutOfRangeException(nameof(frameSamples));
        if (!double.IsFinite(playback.EffectivePositionSeconds) || playback.EffectivePositionSeconds < 0)
            throw new ArgumentOutOfRangeException(nameof(playback));
    }

    private void ResetUnsafe()
    {
        if (_handle is { } handle)
        {
            try { _bridge.CloseMediaAudio(handle); } catch { }
        }
        _handle = null;
        _identity = null;
        _revision = long.MinValue;
        _nextPositionSeconds = double.NaN;
    }
}
