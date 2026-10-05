using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.State;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class ControlCommandProcessor(
    AgentRuntimeState state,
    IMediaOutputService? mediaOutput = null,
    TimeProvider? clock = null)
{
    private readonly AgentRuntimeState _state = state ?? throw new ArgumentNullException(nameof(state));
    private readonly IMediaOutputService? _mediaOutput = mediaOutput;
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
            var value = $"connection={snapshot.ConnectionStatus};audio={snapshot.AudioStatus};service={snapshot.ServiceMode}";
            return Success(command, value);
        }

        if (_mediaOutput is null) return Failure(command, "output_unavailable");

        try
        {
            switch (command.Type)
            {
                case "preview.prepare":
                    if (!command.Arguments.TryGetValue("itemId", out var itemId) || string.IsNullOrWhiteSpace(itemId))
                        return Failure(command, "item_id_required");
                    await _mediaOutput.SetPreviewAsync(itemId, cancellationToken).ConfigureAwait(false);
                    return Success(command, "preview_prepared");
                case "program.take":
                    await _mediaOutput.TakePreviewToProgramAsync(cancellationToken).ConfigureAwait(false);
                    return Success(command, "program_live");
                case "program.show":
                    if (!command.Arguments.TryGetValue("itemId", out var liveItemId) || string.IsNullOrWhiteSpace(liveItemId))
                        return Failure(command, "item_id_required");
                    await _mediaOutput.SetPreviewAsync(liveItemId, cancellationToken).ConfigureAwait(false);
                    await _mediaOutput.TakePreviewToProgramAsync(cancellationToken).ConfigureAwait(false);
                    return Success(command, "program_live");
                case "program.clear":
                    await _mediaOutput.ClearProgramAsync(cancellationToken).ConfigureAwait(false);
                    return Success(command, "program_clear");
                case "output.start":
                    await _mediaOutput.StartProgramOutputAsync(cancellationToken).ConfigureAwait(false);
                    return Success(command, "output_started");
                case "output.stop":
                    await _mediaOutput.StopProgramOutputAsync(cancellationToken).ConfigureAwait(false);
                    return Success(command, "output_stopped");
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
