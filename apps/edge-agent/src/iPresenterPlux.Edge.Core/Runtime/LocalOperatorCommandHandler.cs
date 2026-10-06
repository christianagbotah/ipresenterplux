using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.State;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class LocalOperatorCommandHandler
{
    private static readonly IReadOnlyDictionary<string, string> EmptyMetadata =
        new Dictionary<string, string>();

    private readonly AgentRuntimeState _state;
    private readonly LocalWebProgramOutputService _mediaOutput;
    private readonly ILocalRecordingService? _recordingService;
    private readonly TimeProvider _clock;

    public LocalOperatorCommandHandler(
        AgentRuntimeState state,
        LocalWebProgramOutputService mediaOutput,
        ILocalRecordingService? recordingService = null,
        TimeProvider? clock = null)
    {
        _state = state ?? throw new ArgumentNullException(nameof(state));
        _mediaOutput = mediaOutput ?? throw new ArgumentNullException(nameof(mediaOutput));
        _recordingService = recordingService;
        _clock = clock ?? TimeProvider.System;
    }

    public async Task<LocalOperatorResponse> HandleAsync(
        LocalOperatorRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var requestId = request.RequestId?.Trim() ?? string.Empty;
        if (!Guid.TryParse(requestId, out _)) return Failure(requestId, "invalid_request_id");
        if (!LocalOperatorCommands.IsAllowed(request.Command)) return Failure(requestId, "unsupported_command");

        try
        {
            switch (request.Command)
            {
                case LocalOperatorCommands.SnapshotQuery:
                    return Success(requestId, "snapshot_ready");

                case LocalOperatorCommands.PreviewRender:
                    if (!TryBuildPresentation(request.Presentation, out var item, out var error))
                        return Failure(requestId, error!);
                    await _mediaOutput.SetPreviewAsync(item!, cancellationToken).ConfigureAwait(false);
                    return Success(requestId, "preview_ready");

                case LocalOperatorCommands.ProgramTake:
                    if (_mediaOutput.Snapshot.Preview is null) return Failure(requestId, "preview_required");
                    await _mediaOutput.TakePreviewToProgramAsync(cancellationToken).ConfigureAwait(false);
                    return Success(requestId, "program_live");

                case LocalOperatorCommands.ProgramClear:
                    await _mediaOutput.ClearProgramAsync(cancellationToken).ConfigureAwait(false);
                    return Success(requestId, "program_clear");

                case LocalOperatorCommands.OutputStart:
                    await _mediaOutput.StartProgramOutputAsync(cancellationToken).ConfigureAwait(false);
                    return Success(requestId, "output_started");

                case LocalOperatorCommands.OutputStop:
                    await _mediaOutput.StopProgramOutputAsync(cancellationToken).ConfigureAwait(false);
                    return Success(requestId, "output_stopped");

                case LocalOperatorCommands.RecordingStart:
                    if (_recordingService is null) return Failure(requestId, "recording_unavailable");
                    if (_state.Snapshot.ActiveServiceId is not { } activeServiceId)
                        return Failure(requestId, "service_required");
                    var started = await _recordingService.StartAsync(activeServiceId, cancellationToken).ConfigureAwait(false);
                    return Success(requestId, started.RecordingId is null ? "recording_started" : "recording_started");

                case LocalOperatorCommands.RecordingStop:
                    if (_recordingService is null) return Failure(requestId, "recording_unavailable");
                    await _recordingService.StopAsync(cancellationToken).ConfigureAwait(false);
                    return Success(requestId, "recording_stopped");

                default:
                    return Failure(requestId, "unsupported_command");
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (InvalidOperationException)
        {
            return Failure(requestId, "invalid_runtime_state");
        }
        catch
        {
            return Failure(requestId, "command_failed");
        }
    }

    private bool TryBuildPresentation(
        LocalOperatorPresentation? presentation,
        out PresentationRenderItem? item,
        out string? error)
    {
        item = null;
        error = null;
        if (presentation is null) { error = "presentation_required"; return false; }

        var itemId = presentation.ItemId?.Trim() ?? string.Empty;
        var itemType = presentation.ItemType?.Trim() ?? string.Empty;
        var title = presentation.Title?.Trim() ?? string.Empty;
        var body = presentation.Body?.Trim() ?? string.Empty;
        var footer = presentation.Footer?.Trim();

        if (itemId.Length is < 1 or > 128) { error = "item_id_invalid"; return false; }
        if (itemType.Length is < 1 or > 32) { error = "item_type_invalid"; return false; }
        if (title.Length > 200) { error = "title_too_long"; return false; }
        if (body.Length is < 1 or > 12000) { error = "body_invalid"; return false; }
        if (footer is { Length: > 500 }) { error = "footer_too_long"; return false; }

        var serviceId = _state.Snapshot.ActiveServiceId ?? Guid.Empty;
        item = new PresentationRenderItem(
            itemId,
            serviceId,
            itemType,
            title,
            body,
            string.IsNullOrWhiteSpace(footer) ? null : footer,
            EmptyMetadata);
        return true;
    }

    private LocalOperatorResponse Success(string requestId, string state) =>
        new(requestId, true, state, null, Snapshot());

    private LocalOperatorResponse Failure(string requestId, string code) =>
        new(requestId, false, code, code, Snapshot());

    private LocalOperatorSnapshot Snapshot()
    {
        var runtime = _state.Snapshot;
        var output = _mediaOutput.Snapshot;
        var recording = _recordingService?.Status;
        return new LocalOperatorSnapshot(
            output.OutputRunning,
            output.Preview,
            output.Program,
            recording?.IsRecording == true,
            recording?.RecordingId,
            runtime.ConnectionStatus,
            runtime.ActiveServiceId,
            runtime.ServiceMode,
            _clock.GetUtcNow());
    }
}
