namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed class StreamContributionGrant
{
    public StreamContributionGrant(
        Guid sessionId,
        Guid serviceId,
        string streamPath,
        string protocol,
        Uri publishUri,
        DateTimeOffset expiresAt)
    {
        SessionId = sessionId;
        ServiceId = serviceId;
        StreamPath = string.IsNullOrWhiteSpace(streamPath)
            ? throw new ArgumentException("Stream path is required.", nameof(streamPath))
            : streamPath;
        Protocol = string.IsNullOrWhiteSpace(protocol)
            ? throw new ArgumentException("Protocol is required.", nameof(protocol))
            : protocol;
        PublishUri = publishUri ?? throw new ArgumentNullException(nameof(publishUri));
        ExpiresAt = expiresAt;
    }

    public Guid SessionId { get; }
    public Guid ServiceId { get; }
    public string StreamPath { get; }
    public string Protocol { get; }
    public Uri PublishUri { get; }
    public DateTimeOffset ExpiresAt { get; }

    public override string ToString() =>
        $"StreamContributionGrant(ServiceId={ServiceId:D}, Protocol={Protocol}, StreamPath={StreamPath}, ExpiresAt={ExpiresAt:O})";
}

public interface IStreamContributionClient
{
    Task<StreamContributionGrant> GetAsync(Guid expectedServiceId, CancellationToken cancellationToken);
}
