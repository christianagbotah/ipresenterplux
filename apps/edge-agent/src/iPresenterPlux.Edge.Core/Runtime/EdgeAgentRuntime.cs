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
    private readonly IAudioCaptureService? _audioCapture;
    private readonly ISpeechRecognitionEngine? _speechRecognitionEngine;
    private AudioTranscriptionPipeline? _transcriptionPipeline;
    private SpeechRecognitionHealth? _latestAsrWorkerHealth;
    private readonly object _audioGate = new();
    private AudioInputDevice? _activeAudioInput;
    private AudioFrame? _lastAudioFrame;
    private double? _latestAudioLevelDb;
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
        AgentRuntimeState? state = null,
        IAudioCaptureService? audioCapture = null,
        ISpeechRecognitionEngine? speechRecognitionEngine = null)
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
        _audioCapture = audioCapture;
        _speechRecognitionEngine = speechRecognitionEngine;
        if (_audioCapture is not null) _audioCapture.AudioFrameCaptured += OnAudioFrameCaptured;
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
        if (_audioCapture is not null && _speechRecognitionEngine is not null)
        {
            _transcriptionPipeline = new AudioTranscriptionPipeline(
                _speechRecognitionEngine,
                async (eventId, segment, token) =>
                {
                    await _queue.EnqueueAsync(
                        OutboundEventFactory.Transcript(identity, segment, eventId), CancellationToken.None).ConfigureAwait(false);
                });
        }
        await StartAudioAsync(cancellationToken).ConfigureAwait(false);

        try
        {
          while (!cancellationToken.IsCancellationRequested)
          {
            await RotateIfNeededAsync(identity, manager, cancellationToken).ConfigureAwait(false);
            await ProbeSpeechRecognitionHealthAsync(cancellationToken).ConfigureAwait(false);

            var health = _healthSampler.Sample(
                identity,
                _state.Snapshot.ConnectionStatus,
                _capabilities);
            await _queue.EnqueueAsync(
                OutboundEventFactory.Health(identity, health),
                cancellationToken).ConfigureAwait(false);

            var audioState = CurrentAudioTelemetry();
            if (audioState is not null)
            {
                await _queue.EnqueueAsync(
                    OutboundEventFactory.Media(identity, audioState),
                    cancellationToken).ConfigureAwait(false);
            }

            var result = await dispatcher.FlushAsync(scope, 100, cancellationToken).ConfigureAwait(false);
            var connection = result.Retried > 0 ? "Degraded" : "Connected";
            _state.Update(snapshot => snapshot with { ConnectionStatus = connection });

            await Task.Delay(_options.EffectiveHeartbeatInterval, _clock, cancellationToken).ConfigureAwait(false);
          }
        }
        finally
        {
            await StopAudioAsync().ConfigureAwait(false);
            if (_transcriptionPipeline is not null)
            {
                await _transcriptionPipeline.DisposeAsync().ConfigureAwait(false);
                _transcriptionPipeline = null;
            }
        }
    }

    private async Task StartAudioAsync(CancellationToken cancellationToken)
    {
        if (_audioCapture is null) return;
        try
        {
            var inputs = await _audioCapture.ListInputsAsync(cancellationToken).ConfigureAwait(false);
            var input = inputs.FirstOrDefault(item => item.IsDefault) ?? inputs.FirstOrDefault();
            if (input is null)
            {
                _state.Update(snapshot => snapshot with { AudioStatus = "No input", ActiveAudioInput = null });
                return;
            }

            await _audioCapture.StartAsync(input.Id, cancellationToken).ConfigureAwait(false);
            lock (_audioGate) _activeAudioInput = input;
            _state.Update(snapshot => snapshot with
            {
                AudioStatus = "Capturing",
                ActiveAudioInput = input.Name,
                Sources = UpsertAudioSource(snapshot.Sources, input, null, "ready")
            });
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error)
        {
            _state.Update(snapshot => snapshot with
            {
                AudioStatus = "Unavailable",
                ActiveAudioInput = null,
                Sources = snapshot.Sources
            });
            Console.Error.WriteLine($"Audio capture unavailable: {error.GetType().Name}: {error.Message}");
        }
    }

    private async Task ProbeSpeechRecognitionHealthAsync(CancellationToken cancellationToken)
    {
        if (_speechRecognitionEngine is null)
        {
            _latestAsrWorkerHealth = new SpeechRecognitionHealth("disabled");
            return;
        }
        if (_speechRecognitionEngine is not ISpeechRecognitionHealthProbe probe)
        {
            _latestAsrWorkerHealth = new SpeechRecognitionHealth("unsupported");
            return;
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            _latestAsrWorkerHealth = await probe.CheckHealthAsync(timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            _latestAsrWorkerHealth = new SpeechRecognitionHealth("offline");
        }
        catch (HttpRequestException)
        {
            _latestAsrWorkerHealth = new SpeechRecognitionHealth("offline");
        }
        catch
        {
            _latestAsrWorkerHealth = new SpeechRecognitionHealth("error");
        }
    }

    private async Task StopAudioAsync()
    {
        if (_audioCapture is null) return;
        try { await _audioCapture.StopAsync(CancellationToken.None).ConfigureAwait(false); }
        catch { /* shutdown must not be blocked by a disappearing device */ }
        lock (_audioGate)
        {
            _activeAudioInput = null;
            _lastAudioFrame = null;
            _latestAudioLevelDb = null;
        }
        _state.Update(snapshot => snapshot with { AudioStatus = "Stopped", ActiveAudioInput = null });
    }

    private void OnAudioFrameCaptured(object? sender, AudioFrame frame)
    {
        _transcriptionPipeline?.TrySubmit(frame);
        var level = AudioLevelMeter.CalculateRmsDb(frame);
        AudioInputDevice? input;
        lock (_audioGate)
        {
            _lastAudioFrame = frame with { Buffer = ReadOnlyMemory<byte>.Empty, BytesRecorded = 0 };
            _latestAudioLevelDb = level;
            input = _activeAudioInput;
        }
        if (input is null) return;
        _state.Update(snapshot => snapshot with
        {
            AudioStatus = "Capturing",
            Sources = UpsertAudioSource(snapshot.Sources, input, level, "ready")
        });
    }

    private MediaSourceState? CurrentAudioTelemetry()
    {
        AudioInputDevice? input; AudioFrame? frame; double? level;
        lock (_audioGate) { input = _activeAudioInput; frame = _lastAudioFrame; level = _latestAudioLevelDb; }
        if (input is null) return null;
        var pipeline = _transcriptionPipeline;
        var workerHealth = _latestAsrWorkerHealth;
        var lastRecognitionError = pipeline?.LastError;
        var lastPublishError = pipeline?.LastPublishError;
        var metadata = new Dictionary<string, string>
        {
            ["channels"] = (frame?.Channels ?? input.Channels).ToString(),
            ["sampleRate"] = (frame?.SampleRate ?? input.SampleRate).ToString(),
            ["levelDb"] = (level ?? -120d).ToString("F1", System.Globalization.CultureInfo.InvariantCulture),
            ["default"] = input.IsDefault ? "true" : "false",
            ["transcriptionDroppedFrames"] = (pipeline?.DroppedFrames ?? 0).ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["transcriptionRecognizedChunks"] = (pipeline?.RecognizedChunks ?? 0).ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["transcriptionSilentChunks"] = (pipeline?.SilentChunks ?? 0).ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["transcriptionFailedChunks"] = (pipeline?.FailedChunks ?? 0).ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["transcriptionConsecutiveFailures"] = (pipeline?.ConsecutiveFailures ?? 0).ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["transcriptPublishedChunks"] = (pipeline?.PublishedChunks ?? 0).ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["transcriptPublishFailures"] = (pipeline?.PublishFailedChunks ?? 0).ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["asrConfigured"] = _speechRecognitionEngine is null ? "false" : "true",
            ["asrWorkerStatus"] = workerHealth?.Status ?? (_speechRecognitionEngine is null ? "disabled" : "unknown"),
            ["asrStatus"] = pipeline?.HealthStatus ?? (_speechRecognitionEngine is null ? "disabled" : "starting"),
            ["transcriptPublishStatus"] = pipeline?.PublishStatus ?? (_speechRecognitionEngine is null ? "disabled" : "starting")
        };
        if (!string.IsNullOrWhiteSpace(workerHealth?.Version))
            metadata["asrWorkerVersion"] = workerHealth.Version!;
        if (workerHealth?.ModelLoaded is { } modelLoaded)
            metadata["asrWorkerModelLoaded"] = modelLoaded ? "true" : "false";
        if (!string.IsNullOrWhiteSpace(workerHealth?.Engine))
            metadata["asrWorkerEngine"] = workerHealth.Engine!;
        if (!string.IsNullOrWhiteSpace(workerHealth?.Device))
            metadata["asrWorkerDevice"] = workerHealth.Device!;
        if (pipeline?.LastSuccessAt is { } lastSuccessAt)
            metadata["transcriptionLastSuccessAt"] = lastSuccessAt.ToUniversalTime().ToString("O");
        if (!string.IsNullOrWhiteSpace(lastRecognitionError))
            metadata["transcriptionLastErrorCode"] = lastRecognitionError;
        if (!string.IsNullOrWhiteSpace(lastPublishError))
            metadata["transcriptPublishLastErrorCode"] = lastPublishError;
        if (frame is not null)
        {
            metadata["bitsPerSample"] = frame.BitsPerSample.ToString();
            metadata["encoding"] = frame.Encoding.ToString();
        }
        return new MediaSourceState(input.Id, input.Name, "audio_input", "ready", _clock.GetUtcNow(), metadata);
    }

    private static IReadOnlyList<SourceHealth> UpsertAudioSource(
        IReadOnlyList<SourceHealth> sources, AudioInputDevice input, double? levelDb, string status)
    {
        var next = sources.Where(item => item.SourceId != input.Id).ToList();
        next.Add(new SourceHealth(input.Id, input.Name, "audio_input", status, levelDb, null,
            $"{input.SampleRate} Hz · {input.Channels} ch"));
        return next.AsReadOnly();
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
        if (_audioCapture is not null) _audioCapture.AudioFrameCaptured -= OnAudioFrameCaptured;
        _healthSampler.Dispose();
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}
