using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.State;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class ControlCommandProcessor(
    AgentRuntimeState state,
    IMediaOutputService? mediaOutput = null,
    IPresentationContentProvider? contentProvider = null,
    ILocalRecordingService? recordingService = null,
    TimeProvider? clock = null,
    IMasterStreamPublisher? streamPublisher = null)
{
    private readonly AgentRuntimeState _state = state ?? throw new ArgumentNullException(nameof(state));
    private readonly IMediaOutputService? _mediaOutput = mediaOutput;
    private readonly IPresentationContentProvider? _contentProvider = contentProvider;
    private readonly ILocalRecordingService? _recordingService = recordingService;
    private readonly IMasterStreamPublisher? _streamPublisher = streamPublisher ?? (mediaOutput as IStreamPublishingMediaOutput)?.StreamPublisher;
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    public async Task<ControlCommandResult> ProcessAsync(ControlCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (!Guid.TryParse(command.CommandId, out _)) return Failure(command, "invalid_command_id");

        var snapshot = _state.Snapshot;
        if (command.ServiceId is not null &&
            (!Guid.TryParse(command.ServiceId, out var serviceId) || snapshot.ActiveServiceId != serviceId))
            return Failure(command, "service_scope_mismatch");

        if (command.Type == "health.query")
        {
            var recording = _recordingService?.Status.IsRecording == true ? "recording" : "idle";
            var streaming = _streamPublisher?.Status.IsPublishing == true ? "publishing" : "idle";
            var value = $"connection={snapshot.ConnectionStatus};audio={snapshot.AudioStatus};service={snapshot.ServiceMode};recording={recording};streaming={streaming}";
            return Success(command, value);
        }

        try
        {
            switch (command.Type)
            {
                case "preview.prepare":
                    if (_mediaOutput is null) return Failure(command, "output_unavailable");
                    if (!command.Arguments.TryGetValue("itemId", out var itemId) || string.IsNullOrWhiteSpace(itemId))
                        return Failure(command, "item_id_required");
                    if (_contentProvider is null) return Failure(command, "content_unavailable");
                    var previewItem = await _contentProvider.GetAsync(itemId, cancellationToken).ConfigureAwait(false);
                    if (snapshot.ActiveServiceId != previewItem.ServiceId) return Failure(command, "content_scope_mismatch");
                    await _mediaOutput.SetPreviewAsync(previewItem, cancellationToken).ConfigureAwait(false);
                    return Success(command, "preview_prepared");

                case "program.take":
                    if (_mediaOutput is null) return Failure(command, "output_unavailable");
                    await _mediaOutput.TakePreviewToProgramAsync(cancellationToken).ConfigureAwait(false);
                    return Success(command, "program_live");

                case "program.show":
                    if (_mediaOutput is null) return Failure(command, "output_unavailable");
                    if (!command.Arguments.TryGetValue("itemId", out var liveItemId) || string.IsNullOrWhiteSpace(liveItemId))
                        return Failure(command, "item_id_required");
                    if (_contentProvider is null) return Failure(command, "content_unavailable");
                    var liveItem = await _contentProvider.GetAsync(liveItemId, cancellationToken).ConfigureAwait(false);
                    if (snapshot.ActiveServiceId != liveItem.ServiceId) return Failure(command, "content_scope_mismatch");
                    await _mediaOutput.SetPreviewAsync(liveItem, cancellationToken).ConfigureAwait(false);
                    await _mediaOutput.TakePreviewToProgramAsync(cancellationToken).ConfigureAwait(false);
                    return Success(command, "program_live");

                case "program.clear":
                    if (_mediaOutput is null) return Failure(command, "output_unavailable");
                    await _mediaOutput.ClearProgramAsync(cancellationToken).ConfigureAwait(false);
                    return Success(command, "program_clear");

                case "output.start":
                    if (_mediaOutput is null) return Failure(command, "output_unavailable");
                    await _mediaOutput.StartProgramOutputAsync(cancellationToken).ConfigureAwait(false);
                    return Success(command, "output_started");

                case "output.stop":
                    if (_mediaOutput is null) return Failure(command, "output_unavailable");
                    await _mediaOutput.StopProgramOutputAsync(cancellationToken).ConfigureAwait(false);
                    return Success(command, "output_stopped");

                case "recording.start":
                    if (_recordingService is null) return Failure(command, "recording_unavailable");
                    if (snapshot.ActiveServiceId is not { } activeServiceId) return Failure(command, "service_required");
                    var started = await _recordingService.StartAsync(activeServiceId, cancellationToken).ConfigureAwait(false);
                    return Success(command, started.RecordingId is null ? "recording_started" : $"recording_started:{started.RecordingId}");

                case "recording.stop":
                    if (_recordingService is null) return Failure(command, "recording_unavailable");
                    var stopped = await _recordingService.StopAsync(cancellationToken).ConfigureAwait(false);
                    return Success(command, stopped.RecordingId is null ? "recording_stopped" : $"recording_stopped:{stopped.RecordingId}");

                case "stream.start":
                    if (_streamPublisher is null) return Failure(command, "stream_unavailable");
                    if (snapshot.ActiveServiceId is not { } streamServiceId) return Failure(command, "service_required");
                    var streamStarted = await _streamPublisher.StartAsync(streamServiceId, cancellationToken).ConfigureAwait(false);
                    return streamStarted.IsPublishing
                        ? Success(command, "stream_live")
                        : Failure(command, streamStarted.ErrorCode ?? "stream_start_failed");

                case "stream.stop":
                    if (_streamPublisher is null) return Failure(command, "stream_unavailable");
                    var streamStopped = await _streamPublisher.StopAsync(cancellationToken).ConfigureAwait(false);
                    return !streamStopped.IsPublishing
                        ? Success(command, "stream_stopped")
                        : Failure(command, streamStopped.ErrorCode ?? "stream_stop_failed");

                default:
                    return Failure(command, "unsupported_command");
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return Failure(command, "command_failed");
        }
    }

    private ControlCommandResult Success(ControlCommand command, string state) =>
        new(command.CommandId, true, state, null, _clock.GetUtcNow());

    private ControlCommandResult Failure(ControlCommand command, string code) =>
        new(command.CommandId, false, code, code, _clock.GetUtcNow());
}
