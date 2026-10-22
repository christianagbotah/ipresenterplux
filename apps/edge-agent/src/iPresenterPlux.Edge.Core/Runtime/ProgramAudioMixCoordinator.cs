using System.Threading.Channels;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class ProgramAudioMixCoordinator : IAsyncDisposable
{
    private static readonly TimeSpan DefaultCadence = TimeSpan.FromMilliseconds(20);
    private readonly IContributionAudioBuffer _output;
    private readonly IMediaAudioFrameProvider _mediaProvider;
    private readonly MediaPlaybackCoordinator _playback;
    private readonly IMediaPreparationCoordinator _preparation;
    private readonly ProgramAudioMixer _mixer;
    private readonly TimeProvider _clock;
    private readonly Channel<AudioFrame> _liveFrames;
    private readonly StreamingStereoPcm16Normalizer _liveNormalizer = new(ProgramAudioMixer.OutputSampleRate);
    private readonly Queue<short> _livePcm = new();
    private readonly SemaphoreSlim _processGate = new(1, 1);
    private readonly object _runGate = new();
    private CancellationTokenSource? _runCts;
    private Task? _worker;
    private bool _mediaSessionActive;
    private bool _disposed;

    public ProgramAudioMixCoordinator(
        IContributionAudioBuffer output,
        IMediaAudioFrameProvider mediaProvider,
        MediaPlaybackCoordinator playback,
        IMediaPreparationCoordinator preparation,
        ProgramAudioMixer? mixer = null,
        TimeProvider? clock = null,
        int liveQueueCapacity = 64)
    {
        _output = output ?? throw new ArgumentNullException(nameof(output));
        _mediaProvider = mediaProvider ?? throw new ArgumentNullException(nameof(mediaProvider));
        _playback = playback ?? throw new ArgumentNullException(nameof(playback));
        _preparation = preparation ?? throw new ArgumentNullException(nameof(preparation));
        _mixer = mixer ?? new ProgramAudioMixer();
        _clock = clock ?? TimeProvider.System;
        if (liveQueueCapacity is < 1 or > 4096) throw new ArgumentOutOfRangeException(nameof(liveQueueCapacity));
        _liveFrames = Channel.CreateBounded<AudioFrame>(new BoundedChannelOptions(liveQueueCapacity)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest,
            AllowSynchronousContinuations = false
        });
    }

    public bool TrySubmitLive(AudioFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!IsValidFrame(frame)) return false;
        var owned = frame.Buffer[..frame.BytesRecorded].ToArray();
        return _liveFrames.Writer.TryWrite(frame with { Buffer = owned, BytesRecorded = owned.Length });
    }

    public Task StartAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        lock (_runGate)
        {
            if (_worker is { IsCompleted: false }) return Task.CompletedTask;
            _runCts?.Dispose();
            _runCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            _worker = Task.Run(() => RunAsync(_runCts.Token), CancellationToken.None);
        }
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        CancellationTokenSource? runCts;
        Task? worker;
        lock (_runGate)
        {
            runCts = _runCts;
            worker = _worker;
        }
        runCts?.Cancel();
        if (worker is not null)
        {
            try { await worker.WaitAsync(cancellationToken).ConfigureAwait(false); }
            catch (OperationCanceledException) when (runCts?.IsCancellationRequested == true && !cancellationToken.IsCancellationRequested) { }
        }
        lock (_runGate)
        {
            if (ReferenceEquals(_runCts, runCts))
            {
                _runCts?.Dispose();
                _runCts = null;
                _worker = null;
            }
        }
        ResetMediaSessionIfActive();
    }

    public async Task<bool> ProcessOnceAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _processGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var live = TakeLiveFrame();
            AudioFrame? media = null;
            var mediaVolume = 1f;
            var playback = _playback.Snapshot;
            var eligibleMedia = false;
            if (playback is not null &&
                playback.State == "playing" &&
                playback.MediaKind is "video" or "audio")
            {
                var prepared = _preparation.TryGet(playback.ItemId);
                if (prepared?.State == MediaPreparationState.Ready &&
                    prepared.Asset is not null &&
                    prepared.ServiceId == playback.ServiceId &&
                    prepared.Asset.ServiceId == playback.ServiceId &&
                    string.Equals(prepared.Asset.ItemId, playback.ItemId, StringComparison.Ordinal))
                {
                    eligibleMedia = true;
                    try
                    {
                        media = await _mediaProvider.ReadPcmAsync(
                            prepared.Asset,
                            playback,
                            ProgramAudioMixer.OutputSampleRate,
                            ProgramAudioMixer.OutputChannels,
                            ProgramAudioMixer.DefaultFrameSamples,
                            cancellationToken).ConfigureAwait(false);
                        _mediaSessionActive = true;

                        var current = _playback.Snapshot;
                        if (current is null ||
                            current.State != "playing" ||
                            current.ServiceId != playback.ServiceId ||
                            current.Revision != playback.Revision ||
                            !string.Equals(current.ItemId, playback.ItemId, StringComparison.Ordinal))
                        {
                            media = null;
                            eligibleMedia = false;
                        }
                        else
                        {
                            mediaVolume = (float)Math.Clamp(current.Volume, 0d, 1d);
                        }
                    }
                    catch (MediaAudioFrameProviderException)
                    {
                        media = null;
                        eligibleMedia = false;
                        ResetMediaSession();
                    }
                }
            }
            if (!eligibleMedia) ResetMediaSessionIfActive();

            var mixed = _mixer.Mix(live, media, mediaVolume);
            return _output.TrySubmit(mixed);
        }
        finally
        {
            _processGate.Release();
        }
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(DefaultCadence, _clock);
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
                await ProcessOnceAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private AudioFrame? TakeLiveFrame()
    {
        DateTimeOffset? capturedAt = null;
        while (_liveFrames.Reader.TryRead(out var frame))
        {
            capturedAt ??= frame.CapturedAt;
            var normalized = _liveNormalizer.Process(frame);
            foreach (var sample in normalized) _livePcm.Enqueue(sample);
        }

        var required = ProgramAudioMixer.DefaultFrameSamples * ProgramAudioMixer.OutputChannels;
        if (_livePcm.Count == 0) return null;
        var samples = new short[required];
        for (var index = 0; index < required && _livePcm.Count > 0; index++)
            samples[index] = _livePcm.Dequeue();
        var bytes = new byte[samples.Length * sizeof(short)];
        Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
        return new AudioFrame(
            bytes,
            bytes.Length,
            ProgramAudioMixer.OutputSampleRate,
            ProgramAudioMixer.OutputChannels,
            ProgramAudioMixer.OutputBitsPerSample,
            capturedAt ?? _clock.GetUtcNow(),
            AudioSampleEncoding.PcmInteger);
    }

    private void ResetMediaSessionIfActive()
    {
        if (!_mediaSessionActive) return;
        ResetMediaSession();
    }

    private void ResetMediaSession()
    {
        try { _mediaProvider.Reset(); } catch { }
        _mediaSessionActive = false;
    }

    private static bool IsValidFrame(AudioFrame frame) =>
        frame.BytesRecorded > 0 &&
        frame.BytesRecorded <= frame.Buffer.Length &&
        frame.SampleRate > 0 &&
        frame.Channels > 0 &&
        frame.BitsPerSample is 16 or 24 or 32 &&
        frame.BitsPerSample % 8 == 0 &&
        frame.BytesRecorded % ((frame.BitsPerSample / 8) * frame.Channels) == 0;

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        try { await StopAsync(CancellationToken.None).ConfigureAwait(false); } catch { }
        _liveFrames.Writer.TryComplete();
        _processGate.Dispose();
        _disposed = true;
    }
}
