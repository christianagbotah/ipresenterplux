using System.Threading.Channels;
using iPresenterPlux.Edge.Core.Abstractions;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class EncodedContributionStreamTransport : IContributionStreamTransport
{
    private readonly IEncodedProgramVideoSource _videoSource;
    private readonly IEncodedProgramAudioSource _audioSource;
    private readonly ISrtContributionSender _sender;
    private readonly Func<ProgramVideoCaptureTarget?> _videoTargetProvider;
    private readonly ProgramVideoCaptureOptions _videoOptions;
    private readonly ProgramAudioCaptureOptions _audioOptions;
    private readonly TimeProvider _clock;
    private readonly int _mediaQueueCapacity;
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private readonly object _stateGate = new();

    private Channel<MediaEnvelope>? _mediaChannel;
    private CancellationTokenSource? _runCts;
    private Task? _sendTask;
    private Guid? _serviceId;
    private DateTimeOffset? _startedAt;
    private bool _publishing;
    private string _state = "idle";
    private string? _errorCode;
    private long _droppedFrames;
    private long _bytesSent;
    private long _videoFramesMuxed;
    private bool _disposed;

    public EncodedContributionStreamTransport(
        IEncodedProgramVideoSource videoSource,
        IEncodedProgramAudioSource audioSource,
        ISrtContributionSender sender,
        Func<ProgramVideoCaptureTarget?> videoTargetProvider,
        ProgramVideoCaptureOptions? videoOptions = null,
        ProgramAudioCaptureOptions? audioOptions = null,
        TimeProvider? clock = null,
        int mediaQueueCapacity = 512)
    {
        _videoSource = videoSource ?? throw new ArgumentNullException(nameof(videoSource));
        _audioSource = audioSource ?? throw new ArgumentNullException(nameof(audioSource));
        _sender = sender ?? throw new ArgumentNullException(nameof(sender));
        _videoTargetProvider = videoTargetProvider ?? throw new ArgumentNullException(nameof(videoTargetProvider));
        _videoOptions = (videoOptions ?? new ProgramVideoCaptureOptions()).Validate();
        _audioOptions = (audioOptions ?? new ProgramAudioCaptureOptions()).Validate();
        _clock = clock ?? TimeProvider.System;
        _mediaQueueCapacity = mediaQueueCapacity > 0
            ? mediaQueueCapacity
            : throw new ArgumentOutOfRangeException(nameof(mediaQueueCapacity));
    }

    public ContributionStreamTransportStatus Status
    {
        get
        {
            bool publishing;
            string state;
            string? errorCode;
            DateTimeOffset? startedAt;
            lock (_stateGate)
            {
                publishing = _publishing;
                state = _state;
                errorCode = _errorCode;
                startedAt = _startedAt;
            }

            var sender = _sender.Status;
            if (publishing && !sender.IsConnected)
            {
                publishing = false;
                state = sender.State == "reconnecting" ? "reconnecting" : "error";
                errorCode ??= sender.ErrorCode ?? "transport_disconnected";
            }

            var elapsed = startedAt is null ? TimeSpan.Zero : _clock.GetUtcNow() - startedAt.Value;
            var seconds = Math.Max(elapsed.TotalSeconds, 0d);
            long? bitrate = seconds > 0d
                ? (long)Math.Round(Interlocked.Read(ref _bytesSent) * 8d / seconds)
                : null;
            double? fps = seconds > 0d
                ? Interlocked.Read(ref _videoFramesMuxed) / seconds
                : null;
            var dropped = Math.Max(0, Interlocked.Read(ref _droppedFrames)) +
                          Math.Max(0, _videoSource.Status.DroppedFrames) +
                          Math.Max(0, _audioSource.Status.DroppedFrames) +
                          Math.Max(0, sender.DroppedSends);

            return new ContributionStreamTransportStatus(
                publishing,
                NormalizeState(state),
                bitrate,
                fps,
                dropped,
                Math.Max(0, sender.ReconnectCount),
                sender.LastSuccessfulSendAt,
                NormalizeErrorCode(errorCode ?? sender.ErrorCode));
        }
    }

    public async Task<ContributionStreamTransportStatus> StartAsync(
        StreamContributionGrant grant,
        CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        ArgumentNullException.ThrowIfNull(grant);
        ValidateGrant(grant);

        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (Status.IsPublishing && _serviceId == grant.ServiceId) return Status;
            if (_runCts is not null)
                await StopCoreAsync(CancellationToken.None).ConfigureAwait(false);

            ProgramVideoCaptureTarget? target;
            try { target = _videoTargetProvider(); }
            catch { return SetFailure("source_unavailable"); }
            if (target is null) return SetFailure("source_unavailable");
            try { target.Validate(); }
            catch { return SetFailure("source_unavailable"); }

            var channel = Channel.CreateBounded<MediaEnvelope>(new BoundedChannelOptions(_mediaQueueCapacity)
            {
                SingleReader = true,
                SingleWriter = false,
                FullMode = BoundedChannelFullMode.Wait
            });
            var runCts = new CancellationTokenSource();
            lock (_stateGate)
            {
                _serviceId = grant.ServiceId;
                _startedAt = null;
                _publishing = false;
                _state = "starting";
                _errorCode = null;
                _mediaChannel = channel;
                _runCts = runCts;
            }
            Interlocked.Exchange(ref _droppedFrames, 0);
            Interlocked.Exchange(ref _bytesSent, 0);
            Interlocked.Exchange(ref _videoFramesMuxed, 0);

            _videoSource.FrameEncoded += OnVideoEncoded;
            _audioSource.FrameEncoded += OnAudioEncoded;

            try
            {
                var senderStatus = await _sender.ConnectAsync(grant.PublishUri, cancellationToken).ConfigureAwait(false);
                if (!senderStatus.IsConnected)
                {
                    SetFailure(senderStatus.ErrorCode ?? "transport_connect_failed");
                    await StopCoreAsync(CancellationToken.None).ConfigureAwait(false);
                    return Status;
                }

                _sendTask = Task.Run(() => RunSendLoopAsync(channel.Reader, runCts.Token), CancellationToken.None);

                var audio = await _audioSource.StartAsync(grant.ServiceId, _audioOptions, cancellationToken).ConfigureAwait(false);
                if (!audio.IsCapturing)
                {
                    SetFailure(MapSourceError(audio.ErrorCode));
                    await StopCoreAsync(CancellationToken.None).ConfigureAwait(false);
                    return Status;
                }

                var video = await _videoSource.StartAsync(target, _videoOptions, cancellationToken).ConfigureAwait(false);
                if (!video.IsCapturing)
                {
                    SetFailure(MapSourceError(video.ErrorCode));
                    await StopCoreAsync(CancellationToken.None).ConfigureAwait(false);
                    return Status;
                }

                lock (_stateGate)
                {
                    _publishing = true;
                    _startedAt = _clock.GetUtcNow();
                    _state = "publishing";
                    _errorCode = null;
                }
                return Status;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                await StopCoreAsync(CancellationToken.None).ConfigureAwait(false);
                throw;
            }
            catch
            {
                SetFailure("transport_connect_failed");
                await StopCoreAsync(CancellationToken.None).ConfigureAwait(false);
                return Status;
            }
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task<ContributionStreamTransportStatus> StopAsync(CancellationToken cancellationToken)
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

    private async Task<ContributionStreamTransportStatus> StopCoreAsync(CancellationToken cancellationToken)
    {
        Channel<MediaEnvelope>? channel;
        CancellationTokenSource? runCts;
        Task? sendTask;
        lock (_stateGate)
        {
            channel = _mediaChannel;
            runCts = _runCts;
            sendTask = _sendTask;
            if (runCts is null && channel is null)
            {
                _publishing = false;
                _serviceId = null;
                _startedAt = null;
                _state = "idle";
                _errorCode = null;
                return Status;
            }
            _state = "stopping";
            _publishing = false;
        }

        _videoSource.FrameEncoded -= OnVideoEncoded;
        _audioSource.FrameEncoded -= OnAudioEncoded;

        try { await _videoSource.StopAsync(CancellationToken.None).ConfigureAwait(false); }
        catch { }
        try { await _audioSource.StopAsync(CancellationToken.None).ConfigureAwait(false); }
        catch { }

        channel?.Writer.TryComplete();
        if (sendTask is not null)
        {
            try { await sendTask.WaitAsync(cancellationToken).ConfigureAwait(false); }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                runCts?.Cancel();
                throw;
            }
            catch { }
        }

        runCts?.Cancel();
        try { await _sender.DisconnectAsync(CancellationToken.None).ConfigureAwait(false); }
        catch { }

        lock (_stateGate)
        {
            if (ReferenceEquals(_runCts, runCts))
            {
                _runCts?.Dispose();
                _runCts = null;
                _mediaChannel = null;
                _sendTask = null;
            }
            _serviceId = null;
            _startedAt = null;
            _publishing = false;
            _state = "idle";
            _errorCode = null;
        }
        return Status;
    }

    private async Task RunSendLoopAsync(ChannelReader<MediaEnvelope> reader, CancellationToken cancellationToken)
    {
        var muxer = new MpegTsMuxer();
        var chunker = new MpegTsSrtChunker();
        var failed = false;
        try
        {
            await foreach (var media in reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
            {
                IReadOnlyList<byte[]> packets;
                if (media.Video is not null)
                {
                    packets = muxer.MuxVideo(media.Video);
                    Interlocked.Increment(ref _videoFramesMuxed);
                }
                else if (media.Audio is not null)
                {
                    packets = muxer.MuxAudio(media.Audio);
                }
                else
                {
                    continue;
                }

                foreach (var message in chunker.Append(packets))
                    await SendMessageAsync(message, cancellationToken).ConfigureAwait(false);
            }

            var tail = chunker.Flush();
            if (tail is not null)
                await SendMessageAsync(tail, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch
        {
            failed = true;
            lock (_stateGate)
            {
                _publishing = false;
                _state = "error";
                _errorCode = "transport_disconnected";
            }
        }
        finally
        {
            if (failed)
            {
                _videoSource.FrameEncoded -= OnVideoEncoded;
                _audioSource.FrameEncoded -= OnAudioEncoded;
                try { await _videoSource.StopAsync(CancellationToken.None).ConfigureAwait(false); } catch { }
                try { await _audioSource.StopAsync(CancellationToken.None).ConfigureAwait(false); } catch { }
                try { await _sender.DisconnectAsync(CancellationToken.None).ConfigureAwait(false); } catch { }
            }
        }
    }

    private async Task SendMessageAsync(byte[] message, CancellationToken cancellationToken)
    {
        await _sender.SendAsync(message, cancellationToken).ConfigureAwait(false);
        Interlocked.Add(ref _bytesSent, message.Length);
    }

    private void OnVideoEncoded(object? sender, EncodedProgramVideoFrame frame)
    {
        var channel = _mediaChannel;
        if (channel is not null && channel.Writer.TryWrite(MediaEnvelope.FromVideo(frame))) return;
        Interlocked.Increment(ref _droppedFrames);
    }

    private void OnAudioEncoded(object? sender, EncodedProgramAudioFrame frame)
    {
        var channel = _mediaChannel;
        if (channel is not null && channel.Writer.TryWrite(MediaEnvelope.FromAudio(frame))) return;
        Interlocked.Increment(ref _droppedFrames);
    }

    private ContributionStreamTransportStatus SetFailure(string errorCode)
    {
        lock (_stateGate)
        {
            _publishing = false;
            _state = "error";
            _errorCode = NormalizeErrorCode(errorCode) ?? "publisher_error";
        }
        return Status;
    }

    private void ValidateGrant(StreamContributionGrant grant)
    {
        if (grant.ServiceId == Guid.Empty)
            throw new ArgumentException("Contribution service ID must be nonempty.", nameof(grant));
        if (!string.Equals(grant.Protocol, "srt", StringComparison.Ordinal) ||
            !string.Equals(grant.PublishUri.Scheme, "srt", StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrWhiteSpace(grant.PublishUri.Host))
            throw new ArgumentException("Contribution transport requires an absolute SRT publish target.", nameof(grant));
        if (grant.ExpiresAt <= _clock.GetUtcNow())
            throw new InvalidOperationException("Contribution grant has expired.");
    }

    private static string MapSourceError(string? code) => code switch
    {
        "encoder_unavailable" => "encoder_unavailable",
        "encoder_failed" => "encoder_failed",
        _ => "source_unavailable"
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
        "source_unavailable" => "source_unavailable",
        "encoder_unavailable" => "encoder_unavailable",
        "encoder_failed" => "encoder_failed",
        "transport_unavailable" => "transport_unavailable",
        "transport_connect_failed" => "transport_connect_failed",
        "transport_disconnected" => "transport_disconnected",
        "transport_stop_failed" => "transport_stop_failed",
        "contribution_expired" => "contribution_expired",
        _ => "publisher_error"
    };

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        await _lifecycleGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            await StopCoreAsync(CancellationToken.None).ConfigureAwait(false);
            try { await _sender.DisposeAsync().ConfigureAwait(false); } catch { }
            try { await _videoSource.DisposeAsync().ConfigureAwait(false); } catch { }
            try { await _audioSource.DisposeAsync().ConfigureAwait(false); } catch { }
            _disposed = true;
        }
        finally
        {
            _lifecycleGate.Release();
            _lifecycleGate.Dispose();
        }
    }

    private sealed record MediaEnvelope(
        EncodedProgramVideoFrame? Video,
        EncodedProgramAudioFrame? Audio)
    {
        public static MediaEnvelope FromVideo(EncodedProgramVideoFrame frame) => new(frame, null);
        public static MediaEnvelope FromAudio(EncodedProgramAudioFrame frame) => new(null, frame);
    }
}
