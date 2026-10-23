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
    private readonly OperatorCatalogCoordinator? _operatorCatalog;
    private readonly IMediaPreparationCoordinator? _mediaPreparation;
    private readonly TimeSpan _catalogMaxAge;

    public LocalOperatorCommandHandler(
        AgentRuntimeState state,
        LocalWebProgramOutputService mediaOutput,
        ILocalRecordingService? recordingService = null,
        TimeProvider? clock = null,
        OperatorCatalogCoordinator? operatorCatalog = null,
        TimeSpan? catalogMaxAge = null,
        IMediaPreparationCoordinator? mediaPreparation = null)
    {
        _state = state ?? throw new ArgumentNullException(nameof(state));
        _mediaOutput = mediaOutput ?? throw new ArgumentNullException(nameof(mediaOutput));
        _recordingService = recordingService;
        _clock = clock ?? TimeProvider.System;
        _operatorCatalog = operatorCatalog;
        _mediaPreparation = mediaPreparation;
        _catalogMaxAge = catalogMaxAge ?? TimeSpan.FromMinutes(1);
        if (_catalogMaxAge <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(catalogMaxAge), "Catalog maximum age must be positive.");
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

                case LocalOperatorCommands.CatalogQuery:
                    return await HandleCatalogQueryAsync(requestId, cancellationToken).ConfigureAwait(false);

                case LocalOperatorCommands.ScriptureResolve:
                    return await HandleScriptureResolveAsync(requestId, request.Scripture, cancellationToken).ConfigureAwait(false);

                case LocalOperatorCommands.PreviewRender:
                    if (!TryBuildPresentation(request.Presentation, out var item, out var error))
                        return Failure(requestId, error!);
                    await _mediaOutput.SetPreviewAsync(item!, cancellationToken).ConfigureAwait(false);
                    return Success(requestId, "preview_ready");

                case LocalOperatorCommands.PreviewPrepareItem:
                    return await HandlePrepareItemAsync(requestId, request.Item, cancellationToken).ConfigureAwait(false);

                case LocalOperatorCommands.ProgramTake:
                    if (_mediaOutput.Snapshot.Preview is null) return Failure(requestId, "preview_required");
                    await _mediaOutput.TakePreviewToProgramAsync(cancellationToken).ConfigureAwait(false);
                    return Success(requestId, "program_live");

                case LocalOperatorCommands.ProgramClear:
                    await _mediaOutput.ClearProgramAsync(cancellationToken).ConfigureAwait(false);
                    return Success(requestId, "program_clear");

                case LocalOperatorCommands.MediaPause:
                case LocalOperatorCommands.MediaResume:
                case LocalOperatorCommands.MediaSeek:
                    return await HandleMediaControlAsync(
                        requestId, request.Command, request.Media, cancellationToken).ConfigureAwait(false);

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
                    await _recordingService.StartAsync(activeServiceId, cancellationToken).ConfigureAwait(false);
                    return Success(requestId, "recording_started");

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

    private async Task<LocalOperatorResponse> HandleMediaControlAsync(
        string requestId,
        string command,
        LocalOperatorMediaControl? control,
        CancellationToken cancellationToken)
    {
        var program = _mediaOutput.Snapshot.Program;
        var playback = _mediaOutput.PlaybackSnapshot;
        var mediaKind = program?.Media?.MediaKind;
        if (program is null || playback is null ||
            mediaKind is not ("video" or "audio") ||
            !string.Equals(playback.ItemId, program.ItemId, StringComparison.Ordinal))
        {
            return Failure(requestId, "media_control_unavailable");
        }

        var activeServiceId = _state.Snapshot.ActiveServiceId;
        if (activeServiceId is null ||
            program.ServiceId != activeServiceId ||
            playback.ServiceId != activeServiceId)
        {
            return Failure(requestId, "catalog_scope_mismatch");
        }

        switch (command)
        {
            case LocalOperatorCommands.MediaPause:
                await _mediaOutput.PauseMediaAsync(cancellationToken).ConfigureAwait(false);
                return Success(requestId, "media_paused");
            case LocalOperatorCommands.MediaResume:
                await _mediaOutput.ResumeMediaAsync(cancellationToken).ConfigureAwait(false);
                return Success(requestId, "media_resumed");
            case LocalOperatorCommands.MediaSeek:
                if (control?.PositionSeconds is not { } position || !double.IsFinite(position))
                    return Failure(requestId, "media_seek_invalid");
                await _mediaOutput.SeekMediaAsync(position, cancellationToken).ConfigureAwait(false);
                return Success(requestId, "media_seeked");
            default:
                return Failure(requestId, "unsupported_command");
        }
    }

    private async Task<LocalOperatorResponse> HandleCatalogQueryAsync(
        string requestId,
        CancellationToken cancellationToken)
    {
        if (_operatorCatalog is null) return Failure(requestId, "catalog_unavailable");
        var activeServiceId = _state.Snapshot.ActiveServiceId;
        if (_operatorCatalog.ActiveServiceId != activeServiceId)
            return Failure(requestId, "catalog_scope_mismatch");

        var catalog = await _operatorCatalog.QueryAsync(cancellationToken).ConfigureAwait(false);
        if (catalog?.Service?.ServiceId != activeServiceId &&
            (catalog is not null || activeServiceId is not null))
        {
            return Failure(requestId, "catalog_scope_mismatch");
        }

        var stale = catalog?.IsStale(_clock.GetUtcNow(), _catalogMaxAge) == true;
        return Success(requestId, "catalog_ready", catalog: catalog, catalogStale: stale);
    }

    private async Task<LocalOperatorResponse> HandlePrepareItemAsync(
        string requestId,
        LocalOperatorItemRequest? itemRequest,
        CancellationToken cancellationToken)
    {
        var itemId = itemRequest?.ItemId?.Trim() ?? string.Empty;
        if (itemId.Length is < 1 or > 128) return Failure(requestId, "item_id_invalid");
        if (_operatorCatalog is null) return Failure(requestId, "catalog_unavailable");

        var activeServiceId = _state.Snapshot.ActiveServiceId;
        if (_operatorCatalog.ActiveServiceId != activeServiceId)
            return Failure(requestId, "catalog_scope_mismatch");

        var catalog = await _operatorCatalog.QueryAsync(cancellationToken).ConfigureAwait(false);
        if (catalog is null || catalog.Service?.ServiceId != activeServiceId)
            return Failure(requestId, "catalog_scope_mismatch");
        var serviceItem = catalog.Items.FirstOrDefault(item =>
            string.Equals(item.ItemId, itemId, StringComparison.OrdinalIgnoreCase));
        var libraryItem = catalog.LibraryItems.FirstOrDefault(item =>
            string.Equals(item.ItemId, itemId, StringComparison.OrdinalIgnoreCase));
        var catalogItem = serviceItem ?? libraryItem;
        if (catalogItem is null) return Failure(requestId, "catalog_item_not_found");
        if (serviceItem is not null && activeServiceId is null)
            return Failure(requestId, "service_required");

        var presentationScope = LocalOperatorPresentationScope.Resolve(activeServiceId);
        PresentationRenderItem renderItem;
        try
        {
            renderItem = libraryItem is not null
                ? await _operatorCatalog.ResolveLibraryPresentationAsync(itemId, presentationScope, cancellationToken).ConfigureAwait(false)
                : await _operatorCatalog.ResolvePresentationAsync(itemId, cancellationToken).ConfigureAwait(false);
        }
        catch (HttpRequestException)
        {
            return Failure(requestId, "presentation_unavailable");
        }
        catch (InvalidDataException)
        {
            return Failure(requestId, "presentation_invalid");
        }

        var expectedScope = libraryItem is not null ? presentationScope : activeServiceId!.Value;
        if (!string.Equals(renderItem.ItemId, itemId, StringComparison.OrdinalIgnoreCase) ||
            renderItem.ServiceId != expectedScope ||
            _operatorCatalog.ActiveServiceId != activeServiceId ||
            _state.Snapshot.ActiveServiceId != activeServiceId)
        {
            return Failure(requestId, "catalog_scope_mismatch");
        }
        if (!string.Equals(renderItem.ItemType, catalogItem.ItemType, StringComparison.OrdinalIgnoreCase))
            return Failure(requestId, "presentation_invalid");

        if (string.Equals(catalogItem.ItemType, "media", StringComparison.OrdinalIgnoreCase))
        {
            if (renderItem.Media is null) return Failure(requestId, "presentation_invalid");
            if (_mediaPreparation is null) return Failure(requestId, "media_preparation_unavailable");

            var preparation = await _mediaPreparation.PrepareAsync(renderItem, cancellationToken).ConfigureAwait(false);
            if (preparation.ServiceId != expectedScope ||
                !string.Equals(preparation.ItemId, itemId, StringComparison.OrdinalIgnoreCase))
            {
                return Failure(requestId, "catalog_scope_mismatch");
            }
            if (preparation.State is not (MediaPreparationState.Ready or MediaPreparationState.NotRequired))
                return Failure(requestId, preparation.ErrorCode ?? PreparationError(preparation.State));
        }

        await _mediaOutput.SetPreviewAsync(renderItem, cancellationToken).ConfigureAwait(false);
        return Success(requestId, "preview_ready");
    }

    private static string PreparationError(MediaPreparationState state) => state switch
    {
        MediaPreparationState.Queued or MediaPreparationState.Downloading or MediaPreparationState.Validating => "media_not_ready",
        MediaPreparationState.Unsupported => "media_type_unsupported",
        MediaPreparationState.Failed => "media_preparation_failed",
        _ => "media_preparation_failed"
    };

    private async Task<LocalOperatorResponse> HandleScriptureResolveAsync(
        string requestId,
        LocalOperatorScriptureQuery? scripture,
        CancellationToken cancellationToken)
    {
        if (scripture is null) return Failure(requestId, "scripture_query_required");
        var reference = scripture.Reference?.Trim() ?? string.Empty;
        if (reference.Length is < 3 or > 120) return Failure(requestId, "scripture_reference_invalid");

        var version = scripture.Version?.Trim();
        if (version is { Length: 0 or > 32 }) return Failure(requestId, "bible_version_invalid");
        if (_operatorCatalog is null) return Failure(requestId, "catalog_unavailable");

        var activeServiceId = _state.Snapshot.ActiveServiceId;
        if (activeServiceId is null) return Failure(requestId, "service_required");
        if (_operatorCatalog.ActiveServiceId != activeServiceId)
            return Failure(requestId, "catalog_scope_mismatch");

        try
        {
            var resolved = await _operatorCatalog.ResolveScriptureAsync(reference, version, cancellationToken).ConfigureAwait(false);
            if (resolved.ServiceId != activeServiceId)
                return Failure(requestId, "catalog_scope_mismatch");
            return Success(requestId, "scripture_ready", resolvedPresentation: resolved.Item);
        }
        catch (OperatorScriptureUnavailableOfflineException)
        {
            return Failure(requestId, "scripture_unavailable_offline");
        }
        catch (HttpRequestException)
        {
            return Failure(requestId, "scripture_resolve_failed");
        }
        catch (InvalidDataException)
        {
            return Failure(requestId, "scripture_resolve_failed");
        }
        catch (ArgumentException)
        {
            return Failure(requestId, "scripture_resolve_failed");
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

        var serviceId = LocalOperatorPresentationScope.Resolve(_state.Snapshot.ActiveServiceId);
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

    private LocalOperatorResponse Success(
        string requestId,
        string state,
        OperatorCatalogSnapshot? catalog = null,
        bool catalogStale = false,
        OperatorCatalogItem? resolvedPresentation = null) =>
        new(requestId, true, state, null, Snapshot(), catalog, catalogStale, resolvedPresentation);

    private LocalOperatorResponse Failure(string requestId, string code) =>
        new(requestId, false, code, code, Snapshot());

    private LocalOperatorSnapshot Snapshot()
    {
        var runtime = _state.Snapshot;
        var output = _mediaOutput.Snapshot;
        var recording = _recordingService?.Status;
        var presentationScope = LocalOperatorPresentationScope.Resolve(runtime.ActiveServiceId);
        var preparations = _mediaPreparation is not null
            ? _mediaPreparation.GetSnapshots()
                .Where(snapshot => snapshot.ServiceId == presentationScope)
                .Select(snapshot => new LocalOperatorMediaPreparation(
                    snapshot.ItemId, snapshot.ServiceId, snapshot.State, snapshot.ErrorCode))
                .ToArray()
            : Array.Empty<LocalOperatorMediaPreparation>();
        return new LocalOperatorSnapshot(
            output.OutputRunning,
            output.Preview,
            output.Program,
            recording?.IsRecording == true,
            recording?.RecordingId,
            runtime.ConnectionStatus,
            runtime.ActiveServiceId,
            runtime.ServiceMode,
            _clock.GetUtcNow(),
            _mediaOutput.PlaybackSnapshot,
            preparations,
            runtime.AudioStatus,
            runtime.ActiveAudioInput,
            runtime.AsrStatus,
            runtime.TranscriptionStatus,
            runtime.TranscriptPublishStatus);
    }
}
