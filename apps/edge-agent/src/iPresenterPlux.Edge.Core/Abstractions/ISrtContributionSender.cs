namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed record SrtContributionSenderStatus(
    bool IsConnected,
    string State,
    long BytesSent,
    long DroppedSends,
    int ReconnectCount,
    DateTimeOffset? LastSuccessfulSendAt,
    string? ErrorCode);

public interface ISrtContributionSender : IAsyncDisposable
{
    SrtContributionSenderStatus Status { get; }

    Task<SrtContributionSenderStatus> ConnectAsync(
        Uri publishUri,
        CancellationToken cancellationToken);

    Task SendAsync(
        ReadOnlyMemory<byte> payload,
        CancellationToken cancellationToken);

    Task<SrtContributionSenderStatus> DisconnectAsync(
        CancellationToken cancellationToken);
}
