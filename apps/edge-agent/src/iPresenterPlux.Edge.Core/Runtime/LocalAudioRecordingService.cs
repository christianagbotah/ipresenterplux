using System.Text.Json;
using System.Threading.Channels;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class LocalAudioRecordingService : ILocalRecordingService
{
    private sealed record RecordingManifest(
        int SchemaVersion,
        string RecordingId,
        Guid ServiceId,
        DateTimeOffset StartedAt,
        DateTimeOffset? CompletedAt,
        long FramesWritten,
        long DroppedFrames,
        string? ErrorCode,
        IReadOnlyList<string> Segments);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly object _gate = new();
    private readonly string _recordingsRoot;
    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _manifestGate = new(1, 1);
    private Channel<AudioFrame>? _frames;
    private Task? _worker;
    private Guid? _serviceId;
    private string? _recordingId;
    private string? _directoryPath;
    private DateTimeOffset? _startedAt;
    private DateTimeOffset? _completedAt;
    private IReadOnlyList<string> _segments = Array.Empty<string>();
    private long _framesWritten;
    private long _droppedFrames;
    private string? _errorCode;
    private bool _disposed;

    public LocalAudioRecordingService(string dataDirectory, TimeProvider? clock = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataDirectory);
        _recordingsRoot = Path.Combine(dataDirectory, "recordings");
        Directory.CreateDirectory(_recordingsRoot);
        _clock = clock ?? TimeProvider.System;
    }

    public LocalRecordingStatus Status
    {
        get
        {
            lock (_gate)
            {
                return new LocalRecordingStatus(
                    _frames is not null,
                    _serviceId,
                    _recordingId,
                    _directoryPath,
                    _startedAt,
                    Interlocked.Read(ref _framesWritten),
                    Interlocked.Read(ref _droppedFrames),
                    _errorCode);
            }
        }
    }

    public async Task<LocalRecordingStatus> StartAsync(Guid serviceId, CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (serviceId == Guid.Empty) throw new ArgumentException("Service ID must be nonempty.", nameof(serviceId));

        Channel<AudioFrame> channel;
        string directory;
        string recordingId;
        DateTimeOffset startedAt;
        lock (_gate)
        {
            if (_frames is not null)
            {
                if (_serviceId == serviceId) return Status;
                throw new InvalidOperationException("A different service is already being recorded.");
            }

            startedAt = _clock.GetUtcNow();
            recordingId = $"{startedAt:yyyyMMdd-HHmmssfff}-{Guid.NewGuid():N}";
            directory = Path.Combine(
                _recordingsRoot,
                startedAt.ToString("yyyy"),
                startedAt.ToString("MM"),
                startedAt.ToString("dd"),
                serviceId.ToString("N"),
                recordingId);
            Directory.CreateDirectory(directory);
            channel = Channel.CreateBounded<AudioFrame>(new BoundedChannelOptions(512)
            {
                SingleReader = true,
                SingleWriter = false,
                FullMode = BoundedChannelFullMode.Wait
            });
            _frames = channel;
            _serviceId = serviceId;
            _recordingId = recordingId;
            _directoryPath = directory;
            _startedAt = startedAt;
            _completedAt = null;
            _segments = Array.Empty<string>();
            _errorCode = null;
            Interlocked.Exchange(ref _framesWritten, 0);
            Interlocked.Exchange(ref _droppedFrames, 0);
            _worker = Task.Run(() => RecordAsync(channel, directory, recordingId, serviceId, startedAt));
        }

        await WriteManifestAsync(cancellationToken).ConfigureAwait(false);
        return Status;
    }

    public async Task<LocalRecordingStatus> StopAsync(CancellationToken cancellationToken)
    {
        Channel<AudioFrame>? channel;
        Task? worker;
        lock (_gate)
        {
            channel = _frames;
            worker = _worker;
            if (channel is null) return Status;
            _frames = null;
            _worker = null;
            channel.Writer.TryComplete();
        }

        if (worker is not null)
        {
            try { await worker.WaitAsync(cancellationToken).ConfigureAwait(false); }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        }
        return Status;
    }

    public async Task HandleActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken)
    {
        Guid? recordingService;
        lock (_gate) recordingService = _frames is null ? null : _serviceId;
        if (recordingService is not null && recordingService != serviceId)
            await StopAsync(cancellationToken).ConfigureAwait(false);
    }

    public bool TrySubmit(AudioFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        Channel<AudioFrame>? channel;
        lock (_gate) channel = _frames;
        if (channel is null) return false;
        if (channel.Writer.TryWrite(frame)) return true;
        Interlocked.Increment(ref _droppedFrames);
        return false;
    }

    private async Task RecordAsync(
        Channel<AudioFrame> channel,
        string directory,
        string recordingId,
        Guid serviceId,
        DateTimeOffset startedAt)
    {
        var writer = new WaveRecordingWriter(directory, "audio");
        try
        {
            await foreach (var frame in channel.Reader.ReadAllAsync().ConfigureAwait(false))
            {
                try
                {
                    await writer.WriteAsync(frame, CancellationToken.None).ConfigureAwait(false);
                    Interlocked.Exchange(ref _framesWritten, writer.FramesWritten);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException or ArgumentException)
                {
                    lock (_gate) _errorCode = ClassifyError(error);
                    channel.Writer.TryComplete();
                    lock (_gate)
                    {
                        if (ReferenceEquals(_frames, channel)) _frames = null;
                    }
                    break;
                }
            }
        }
        finally
        {
            try { await writer.DisposeAsync().ConfigureAwait(false); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
            {
                lock (_gate) _errorCode ??= ClassifyError(error);
            }
            lock (_gate)
            {
                _segments = writer.Files.Select(Path.GetFileName).Where(name => name is not null).Cast<string>().ToArray();
                _completedAt = _clock.GetUtcNow();
                if (ReferenceEquals(_frames, channel)) _frames = null;
                if (_serviceId == serviceId && _recordingId == recordingId && _startedAt == startedAt)
                    _worker = null;
            }
            await WriteManifestAsync(CancellationToken.None).ConfigureAwait(false);
        }
    }

    private async Task WriteManifestAsync(CancellationToken cancellationToken)
    {
        await _manifestGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            RecordingManifest? manifest;
            string? directory;
            lock (_gate)
            {
                directory = _directoryPath;
                manifest = _recordingId is null || _serviceId is null || _startedAt is null || directory is null
                    ? null
                    : new RecordingManifest(
                        1,
                        _recordingId,
                        _serviceId.Value,
                        _startedAt.Value,
                        _completedAt,
                        Interlocked.Read(ref _framesWritten),
                        Interlocked.Read(ref _droppedFrames),
                        _errorCode,
                        _segments);
            }
            if (manifest is null || directory is null) return;

            try
            {
                var path = Path.Combine(directory, "recording.json");
                var temp = path + ".tmp";
                await using (var stream = new FileStream(
                    temp, FileMode.Create, FileAccess.Write, FileShare.None,
                    16 * 1024, FileOptions.Asynchronous | FileOptions.WriteThrough))
                {
                    await JsonSerializer.SerializeAsync(stream, manifest, JsonOptions, cancellationToken).ConfigureAwait(false);
                    await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                    stream.Flush(flushToDisk: true);
                }
                File.Move(temp, path, overwrite: true);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                lock (_gate) _errorCode ??= "manifest_storage";
            }
        }
        finally { _manifestGate.Release(); }
    }

    private static string ClassifyError(Exception error) => error switch
    {
        UnauthorizedAccessException => "storage_access",
        IOException => "storage_io",
        InvalidDataException => "audio_format",
        ArgumentException => "audio_format",
        _ => "recording_error"
    };

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        try { await StopAsync(CancellationToken.None).ConfigureAwait(false); }
        catch { /* shutdown must not be blocked by recording finalization */ }
        _manifestGate.Dispose();
    }
}
