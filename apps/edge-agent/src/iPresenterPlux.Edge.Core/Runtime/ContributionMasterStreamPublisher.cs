using iPresenterPlux.Edge.Core.Abstractions;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class ContributionMasterStreamPublisher : IMasterStreamPublisher
{
    private readonly IStreamContributionClient _contributionClient;
    private readonly IContributionStreamTransport _transport;
    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private readonly object _stateGate = new();
    private Guid? _serviceId;
    private DateTimeOffset? _startedAt;
    private string _state = "idle";
    private string? _errorCode;
    private bool _disposed;

    public ContributionMasterStreamPublisher(
        IStreamContributionClient contributionClient,
        IContributionStreamTransport transport,
        TimeProvider? clock = null)
    {
        _contributionClient = contributionClient ?? throw new ArgumentNullException(nameof(contributionClient));
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _clock = clock ?? TimeProvider.System;
    }

    public MasterStreamStatus Status
    {
        get
        {
            Guid? serviceId;
            DateTimeOffset? startedAt;
            string state;
            string? errorCode;
            lock (_stateGate)
            {
                serviceId = _serviceId;
                startedAt = _startedAt;
                state = _state;
                errorCode = _errorCode;
            }

            var transport = _transport.Status;
            var isPublishing = transport.IsPublishing;
            if (isPublishing && state is not ("starting" or "stopping")) state = "publishing";
            else if (!isPublishing && state == "publishing") state = "error";

            return new MasterStreamStatus(
                isPublishing,
                serviceId,
                NormalizeState(state),
                startedAt,
                transport.BitrateBps,
                transport.FramesPerSecond,
                Math.Max(0, transport.DroppedFrames),
                Math.Max(0, transport.ReconnectCount),
                transport.LastSuccessfulSendAt,
                NormalizeErrorCode(errorCode ?? transport.ErrorCode));
        }
    }

    public async Task<MasterStreamStatus> StartAsync(Guid serviceId, CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (serviceId == Guid.Empty) throw new ArgumentException("Service ID must be nonempty.", nameof(serviceId));

        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = Status;
            if (current.IsPublishing && current.ServiceId == serviceId) return current;
            if (current.IsPublishing && current.ServiceId != serviceId)
            {
                var stopped = await StopCoreAsync(cancellationToken).ConfigureAwait(false);
                if (stopped.IsPublishing)
                    return SetFailure(current.ServiceId, current.StartedAt, "transport_stop_failed");
            }

            SetState(serviceId, null, "starting", null);
            StreamContributionGrant grant;
            try
            {
                grant = await _contributionClient.GetAsync(serviceId, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                SetState(null, null, "idle", null);
                throw;
            }
            catch (Exception error) when (error is HttpRequestException or InvalidDataException or InvalidOperationException or TaskCanceledException)
            {
                return SetFailure(serviceId, null, ClassifyContributionError(error));
            }

            try
            {
                var transport = await _transport.StartAsync(grant, cancellationToken).ConfigureAwait(false);
                if (!transport.IsPublishing)
                    return SetFailure(serviceId, null, NormalizeErrorCode(transport.ErrorCode) ?? "transport_connect_failed");

                var startedAt = _clock.GetUtcNow();
                SetState(serviceId, startedAt, "publishing", null);
                return Status;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                await BestEffortStopTransportAsync().ConfigureAwait(false);
                SetState(null, null, "idle", null);
                throw;
            }
            catch
            {
                await BestEffortStopTransportAsync().ConfigureAwait(false);
                return SetFailure(serviceId, null, "transport_connect_failed");
            }
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task<MasterStreamStatus> StopAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await StopCoreAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task HandleActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = Status;
            if (current.ServiceId is not null && current.ServiceId != serviceId)
                await StopCoreAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    private async Task<MasterStreamStatus> StopCoreAsync(CancellationToken cancellationToken)
    {
        var current = Status;
        if (!current.IsPublishing)
        {
            SetState(null, null, "idle", null);
            return Status;
        }

        SetState(current.ServiceId, current.StartedAt, "stopping", null);
        try
        {
            var transport = await _transport.StopAsync(cancellationToken).ConfigureAwait(false);
            if (transport.IsPublishing)
                return SetFailure(current.ServiceId, current.StartedAt, NormalizeErrorCode(transport.ErrorCode) ?? "transport_stop_failed");
            SetState(null, null, "idle", null);
            return Status;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return SetFailure(current.ServiceId, current.StartedAt, "transport_stop_failed");
        }
    }

    private async Task BestEffortStopTransportAsync()
    {
        try { await _transport.StopAsync(CancellationToken.None).ConfigureAwait(false); }
        catch { /* cancellation/failure cleanup must never expose credential-bearing transport details */ }
    }

    private MasterStreamStatus SetFailure(Guid? serviceId, DateTimeOffset? startedAt, string errorCode)
    {
        SetState(serviceId, startedAt, "error", NormalizeErrorCode(errorCode) ?? "publisher_error");
        return Status;
    }

    private void SetState(Guid? serviceId, DateTimeOffset? startedAt, string state, string? errorCode)
    {
        lock (_stateGate)
        {
            _serviceId = serviceId;
            _startedAt = startedAt;
            _state = NormalizeState(state);
            _errorCode = NormalizeErrorCode(errorCode);
        }
    }

    private static string ClassifyContributionError(Exception error) => error switch
    {
        InvalidDataException => "contribution_invalid",
        HttpRequestException => "contribution_unavailable",
        TaskCanceledException => "contribution_unavailable",
        InvalidOperationException => "contribution_unavailable",
        _ => "publisher_error"
    };

    private static string NormalizeState(string? state) => state switch
    {
        "idle" => "idle",
        "starting" => "starting",
        "publishing" => "publishing",
        "reconnecting" => "reconnecting",
        "stopping" => "stopping",
        "error" => "error",
        _ => "error"
    };

    private static string? NormalizeErrorCode(string? code) => code switch
    {
        null or "" => null,
        "contribution_unavailable" => "contribution_unavailable",
        "contribution_invalid" => "contribution_invalid",
        "contribution_expired" => "contribution_expired",
        "contribution_rejected" => "contribution_rejected",
        "source_unavailable" => "source_unavailable",
        "encoder_unavailable" => "encoder_unavailable",
        "encoder_failed" => "encoder_failed",
        "transport_unavailable" => "transport_unavailable",
        "transport_connect_failed" => "transport_connect_failed",
        "transport_disconnected" => "transport_disconnected",
        "transport_stop_failed" => "transport_stop_failed",
        "service_changed" => "service_changed",
        "publisher_error" => "publisher_error",
        _ => "publisher_error"
    };

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await _lifecycleGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            await BestEffortStopTransportAsync().ConfigureAwait(false);
            SetState(null, null, "idle", null);
        }
        finally
        {
            _lifecycleGate.Release();
            _lifecycleGate.Dispose();
        }
    }
}
