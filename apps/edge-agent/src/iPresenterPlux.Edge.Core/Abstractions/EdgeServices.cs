using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Abstractions;

public interface IAudioCaptureService : IAsyncDisposable
{
    event EventHandler<AudioFrame>? AudioFrameCaptured;
    bool IsCapturing { get; }
    string? ActiveDeviceId { get; }

    Task<IReadOnlyList<AudioInputDevice>> ListInputsAsync(CancellationToken cancellationToken = default);
    Task StartAsync(string deviceId, CancellationToken cancellationToken = default);
    Task StopAsync(CancellationToken cancellationToken = default);
}

public interface IControlPlaneTransport
{
    bool IsConnected { get; }
    event EventHandler<bool>? ConnectionChanged;

    Task SendHeartbeatAsync(AgentHeartbeat heartbeat, CancellationToken cancellationToken = default);
    Task PublishTranscriptAsync(TranscriptSegment segment, CancellationToken cancellationToken = default);
}

public interface IPresentationOutput
{
    string Name { get; }
    bool IsReady { get; }

    Task SetPreviewAsync(ScriptureSuggestion suggestion, CancellationToken cancellationToken = default);
    Task TakeLiveAsync(CancellationToken cancellationToken = default);
    Task ClearAsync(CancellationToken cancellationToken = default);
}
