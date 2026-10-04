using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Queues;
using iPresenterPlux.Edge.Core.State;
using iPresenterPlux.Edge.Core.Transport;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed record EdgeAgentRuntimeOptions(
    string DeviceName,
    string SoftwareVersion,
    string? PairingCode = null,
    TimeSpan? HeartbeatInterval = null,
    TimeSpan? RotationWindow = null)
{
    public TimeSpan EffectiveHeartbeatInterval => HeartbeatInterval ?? TimeSpan.FromSeconds(15);
    public TimeSpan EffectiveRotationWindow => RotationWindow ?? TimeSpan.FromDays(3);
}

public sealed class EdgeEnrollmentRequiredException(string message) : InvalidOperationException(message);

public sealed class EdgeAgentRuntime : IDisposable
{
    private readonly HttpClient _httpClient;
    private readonly IDeviceCredentialStore _credentialStore;
    private readonly IAgentIdentityStore _identityStore;
    private readonly IOutboundEventQueue _queue;
    private readonly IReadOnlyDictionary<string, string> _capabilities;
    private readonly EdgeAgentRuntimeOptions _options;
    private readonly TimeProvider _clock;
    private readonly EdgeHostHealthSampler _healthSampler;
    private readonly AgentRuntimeState _state;
    private string? _pairingCode;
    private bool _disposed;

    public EdgeAgentRuntime(
        HttpClient httpClient,
        IDeviceCredentialStore credentialStore,
        IAgentIdentityStore identityStore,
        IOutboundEventQueue queue,
        IReadOnlyDictionary<string, string> capabilities,
        EdgeAgentRuntimeOptions options,
        TimeProvider? clock = null,
        AgentRuntimeState? state = null)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));
        _identityStore = identityStore ?? throw new ArgumentNullException(nameof(identityStore));
        _queue = queue ?? throw new ArgumentNullException(nameof(queue));
        _capabilities = capabilities ?? throw new ArgumentNullException(nameof(capabilities));
        _ = options ?? throw new ArgumentNullException(nameof(options));
        ArgumentException.ThrowIfNullOrWhiteSpace(options.DeviceName);
        ArgumentException.ThrowIfNullOrWhiteSpace(options.SoftwareVersion);
        if (options.EffectiveHeartbeatInterval <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(options), "Heartbeat interval must be positive.");
        if (options.EffectiveRotationWindow <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(options), "Rotation window must be positive.");

        _options = options with { PairingCode = null };
        _clock = clock ?? TimeProvider.System;
        _state = state ?? new AgentRuntimeState(_clock);
        _healthSampler = new EdgeHostHealthSampler(_clock);
        _pairingCode = string.IsNullOrWhiteSpace(options.PairingCode) ? null : options.PairingCode.Trim();
    }

    public AgentRuntimeState State => _state;

    public async Task<AgentIdentity> InitializeAsync(CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        var identity = await _identityStore.ReadAsync(cancellationToken).ConfigureAwait(false);
        if (identity is not null)
        {
            var credential = await _credentialStore.ReadAsync(
                identity.OrganizationId,
                identity.DeviceId,
                cancellationToken).ConfigureAwait(false);
            if (credential is not null && credential.Metadata.State != DeviceCredentialState.Revoked &&
                credential.Metadata.ExpiresAt > _clock.GetUtcNow())
            {
                return identity;
            }
        }

        if (string.IsNullOrWhiteSpace(_pairingCode))
            throw new EdgeEnrollmentRequiredException("This Edge Agent must be paired with the control plane before it can start.");

        var manager = new DeviceEnrollmentManager(
            new HttpDeviceEnrollmentClient(_httpClient),
            _credentialStore,
            _identityStore);
        var enrolled = await manager.EnrollAsync(
            new PairingCodeExchangeRequest(_pairingCode, _options.DeviceName, _options.SoftwareVersion),
            cancellationToken).ConfigureAwait(false);
        _pairingCode = null;
        return enrolled.Metadata.Identity;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        var identity = await InitializeAsync(cancellationToken).ConfigureAwait(false);
        var scope = new OutboundEventScope(identity.OrganizationId, identity.DeviceId);
        var publisher = new HttpEdgeEventPublisher(_httpClient, identity, _credentialStore);
        var dispatcher = new OutboundEventDispatcher(_queue, publisher, _clock);
        var manager = new DeviceEnrollmentManager(
            new HttpDeviceEnrollmentClient(_httpClient),
            _credentialStore,
            _identityStore);

        _state.Update(snapshot => snapshot with { ConnectionStatus = "Starting" });

        while (!cancellationToken.IsCancellationRequested)
        {
            await RotateIfNeededAsync(identity, manager, cancellationToken).ConfigureAwait(false);

            var health = _healthSampler.Sample(
                identity,
                _state.Snapshot.ConnectionStatus,
                _capabilities);
            await _queue.EnqueueAsync(
                OutboundEventFactory.Health(identity, health),
                cancellationToken).ConfigureAwait(false);

            var result = await dispatcher.FlushAsync(scope, 100, cancellationToken).ConfigureAwait(false);
            var connection = result.Retried > 0 ? "Degraded" : "Connected";
            _state.Update(snapshot => snapshot with { ConnectionStatus = connection });

            await Task.Delay(_options.EffectiveHeartbeatInterval, _clock, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task RotateIfNeededAsync(
        AgentIdentity identity,
        DeviceEnrollmentManager manager,
        CancellationToken cancellationToken)
    {
        var credential = await _credentialStore.ReadAsync(
            identity.OrganizationId,
            identity.DeviceId,
            cancellationToken).ConfigureAwait(false);
        if (credential is null || credential.Metadata.State == DeviceCredentialState.Revoked)
            throw new EdgeEnrollmentRequiredException("The Edge Agent credential is missing or revoked and must be paired again.");
        if (credential.Metadata.ExpiresAt <= _clock.GetUtcNow())
            throw new EdgeEnrollmentRequiredException("The Edge Agent credential expired before it could rotate and must be paired again.");

        var shouldRotate = credential.Metadata.State == DeviceCredentialState.RotationRequired ||
            credential.Metadata.ExpiresAt - _clock.GetUtcNow() <= _options.EffectiveRotationWindow;
        if (!shouldRotate) return;

        try
        {
            await manager.RotateAsync(identity.OrganizationId, identity.DeviceId, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException)
        {
            _state.Update(snapshot => snapshot with { ConnectionStatus = "Degraded" });
        }
        catch (TaskCanceledException)
        {
            _state.Update(snapshot => snapshot with { ConnectionStatus = "Degraded" });
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _healthSampler.Dispose();
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}
