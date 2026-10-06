using iPresenterPlux.Edge.Core.Abstractions;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class DeferredStreamContributionClient(
    HttpClient httpClient,
    IAgentIdentityStore identityStore,
    IDeviceCredentialStore credentialStore,
    TimeProvider? clock = null) : IStreamContributionClient
{
    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
    private readonly IAgentIdentityStore _identityStore = identityStore ?? throw new ArgumentNullException(nameof(identityStore));
    private readonly IDeviceCredentialStore _credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    public async Task<StreamContributionGrant> GetAsync(Guid expectedServiceId, CancellationToken cancellationToken)
    {
        if (expectedServiceId == Guid.Empty)
            throw new ArgumentException("Expected service id is required.", nameof(expectedServiceId));

        var identity = await _identityStore.ReadAsync(cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException("The Edge device is not enrolled.");

        var client = new HttpStreamContributionClient(
            _httpClient,
            identity,
            _credentialStore,
            _clock);
        return await client.GetAsync(expectedServiceId, cancellationToken).ConfigureAwait(false);
    }
}
