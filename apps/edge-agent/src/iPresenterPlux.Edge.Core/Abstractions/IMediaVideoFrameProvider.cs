using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IMediaVideoFrameProvider
{
    ProgramVideoFrame GetFrame(
        PreparedMediaAsset asset,
        double positionSeconds,
        int width,
        int height);
}

public sealed class MediaVideoFrameProviderException : Exception
{
    public MediaVideoFrameProviderException(string errorCode, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(errorCode);
        ErrorCode = errorCode;
    }

    public string ErrorCode { get; }
}
