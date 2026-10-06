namespace iPresenterPlux.Edge.Core.Abstractions;

public sealed record StreamContributionGrant(
    Guid SessionId,
    Guid ServiceId,
    string StreamPath,
    string Protocol,
    Uri PublishUri,
    DateTimeOffset ExpiresAt);

public interface IStreamContributionClient
{
    Task<StreamContributionGrant> GetAsync(Guid expectedServiceId, CancellationToken cancellationToken);
}
