using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IMediaAudioFrameProvider
{
    Task<AudioFrame?> ReadPcmAsync(
        PreparedMediaAsset asset,
        MediaPlaybackSnapshot playback,
        int sampleRate,
        int channels,
        int frameSamples,
        CancellationToken cancellationToken);

    void Reset();
}

public sealed class MediaAudioFrameProviderException : Exception
{
    public MediaAudioFrameProviderException(string errorCode, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(errorCode);
        ErrorCode = errorCode;
    }

    public string ErrorCode { get; }
}
