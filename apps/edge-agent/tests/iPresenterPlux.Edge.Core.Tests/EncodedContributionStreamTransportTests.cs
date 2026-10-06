using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class EncodedContributionStreamTransportTests
{
    [Fact]
    public async Task StartsSourcesForGrantServiceAndSends1316ByteTransportMessages()
    {
        var video = new FakeVideoSource();
        var audio = new FakeAudioSource();
        var sender = new FakeSrtSender();
        await using var transport = CreateTransport(video, audio, sender);
        var serviceId = Guid.NewGuid();

        var started = await transport.StartAsync(Grant(serviceId), CancellationToken.None);
        Assert.True(started.IsPublishing);
        Assert.Equal(serviceId, audio.StartedServiceId);
        Assert.True(video.Status.IsCapturing);
        Assert.True(audio.Status.IsCapturing);

        video.Emit(VideoFrame(payloadLength: 2500));
        await sender.SendObserved.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var first = Assert.IsType<byte[]>(sender.Messages.FirstOrDefault());
        Assert.Equal(1316, first.Length);
        Assert.Equal(0x47, first[0]);
        Assert.Equal(0x47, first[188]);
        Assert.Equal(0x47, first[376]);

        var stopped = await transport.StopAsync(CancellationToken.None);
        Assert.False(stopped.IsPublishing);
        Assert.False(video.Status.IsCapturing);
        Assert.False(audio.Status.IsCapturing);
        Assert.False(sender.Status.IsConnected);
    }

    [Fact]
    public async Task MissingProgramTargetFailsClosedBeforeNetworkConnect()
    {
        var video = new FakeVideoSource();
        var audio = new FakeAudioSource();
        var sender = new FakeSrtSender();
        await using var transport = new EncodedContributionStreamTransport(
            video, audio, sender, () => null);

        var status = await transport.StartAsync(Grant(Guid.NewGuid()), CancellationToken.None);

        Assert.False(status.IsPublishing);
        Assert.Equal("source_unavailable", status.ErrorCode);
        Assert.Equal(0, sender.ConnectCalls);
        Assert.False(video.Status.IsCapturing);
        Assert.False(audio.Status.IsCapturing);
    }

    [Fact]
    public async Task SenderConnectionFailureDoesNotStartEncoders()
    {
        var video = new FakeVideoSource();
        var audio = new FakeAudioSource();
        var sender = new FakeSrtSender { ConnectSucceeds = false };
        await using var transport = CreateTransport(video, audio, sender);

        var status = await transport.StartAsync(Grant(Guid.NewGuid()), CancellationToken.None);

        Assert.False(status.IsPublishing);
        Assert.Equal("transport_connect_failed", status.ErrorCode);
        Assert.False(video.Status.IsCapturing);
        Assert.False(audio.Status.IsCapturing);
    }

    [Fact]
    public async Task SendFailureStopsBothEncodedSourcesAndMarksTransportDisconnected()
    {
        var video = new FakeVideoSource();
        var audio = new FakeAudioSource();
        var sender = new FakeSrtSender { FailSends = true };
        await using var transport = CreateTransport(video, audio, sender);
        await transport.StartAsync(Grant(Guid.NewGuid()), CancellationToken.None);

        video.Emit(VideoFrame(payloadLength: 2500));
        await Task.WhenAll(
            video.StopObserved.Task.WaitAsync(TimeSpan.FromSeconds(5)),
            audio.StopObserved.Task.WaitAsync(TimeSpan.FromSeconds(5)));

        var status = transport.Status;
        Assert.False(status.IsPublishing);
        Assert.Equal("transport_disconnected", status.ErrorCode);
        Assert.False(sender.Status.IsConnected);
    }

    [Fact]
    public async Task BoundedMediaQueueDropsInsteadOfBlockingEncoderCallbacks()
    {
        var video = new FakeVideoSource();
        var audio = new FakeAudioSource();
        var sender = new FakeSrtSender { BlockSends = true };
        await using var transport = CreateTransport(video, audio, sender, mediaQueueCapacity: 1);
        await transport.StartAsync(Grant(Guid.NewGuid()), CancellationToken.None);

        video.Emit(VideoFrame(payloadLength: 2500));
        await sender.SendStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var emitTask = Task.Run(() =>
        {
            for (var index = 0; index < 20; index++)
                video.Emit(VideoFrame(payloadLength: 2500, ptsUs: 33_333L * (index + 1), keyFrame: false));
        });
        await emitTask.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.True(transport.Status.DroppedFrames > 0);
        sender.ReleaseBlockedSends();
        await transport.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task ExpiredGrantIsRejectedBeforeAnySourceOrSenderMutation()
    {
        var video = new FakeVideoSource();
        var audio = new FakeAudioSource();
        var sender = new FakeSrtSender();
        await using var transport = CreateTransport(video, audio, sender);
        var expired = new StreamContributionGrant(
            Guid.NewGuid(), Guid.NewGuid(), "service/test", "srt",
            new Uri("srt://127.0.0.1:8890?streamid=publish%3Aservice%2Ftest%3Aedge%3Afixture&pkt_size=1316"),
            DateTimeOffset.UtcNow.AddMinutes(-1));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            transport.StartAsync(expired, CancellationToken.None));
        Assert.Equal(0, sender.ConnectCalls);
        Assert.False(video.Status.IsCapturing);
        Assert.False(audio.Status.IsCapturing);
    }

    private static EncodedContributionStreamTransport CreateTransport(
        FakeVideoSource video,
        FakeAudioSource audio,
        FakeSrtSender sender,
        int mediaQueueCapacity = 512) =>
        new(
            video,
            audio,
            sender,
            () => new ProgramVideoCaptureTarget(Environment.ProcessId, "iPresenterPlux program"),
            mediaQueueCapacity: mediaQueueCapacity);

    private static StreamContributionGrant Grant(Guid serviceId) =>
        new(
            Guid.NewGuid(),
            serviceId,
            $"service/{serviceId:N}",
            "srt",
            new Uri($"srt://127.0.0.1:8890?streamid=publish%3Aservice%2F{serviceId:N}%3Aedge%3Afixture&pkt_size=1316"),
            DateTimeOffset.UtcNow.AddMinutes(5));

    private static EncodedProgramVideoFrame VideoFrame(
        int payloadLength,
        long ptsUs = 0,
        bool keyFrame = true)
    {
        var data = new byte[Math.Max(6, payloadLength)];
        data[0] = 0x00;
        data[1] = 0x00;
        data[2] = 0x00;
        data[3] = 0x01;
        data[4] = keyFrame ? (byte)0x65 : (byte)0x41;
        return new EncodedProgramVideoFrame(data, 1920, 1080, "h264", "annexb", keyFrame, ptsUs);
    }

    private sealed class FakeVideoSource : IEncodedProgramVideoSource
    {
        private ProgramVideoSourceStatus _status = new(false, "idle", 0, 0, null);
        public event EventHandler<EncodedProgramVideoFrame>? FrameEncoded;
        public ProgramVideoSourceStatus Status => _status;
        public TaskCompletionSource<bool> StopObserved { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task<ProgramVideoSourceStatus> StartAsync(
            ProgramVideoCaptureTarget target,
            ProgramVideoCaptureOptions options,
            CancellationToken cancellationToken)
        {
            target.Validate();
            options.Validate();
            _status = _status with { IsCapturing = true, State = "capturing", ErrorCode = null };
            return Task.FromResult(_status);
        }

        public Task<ProgramVideoSourceStatus> StopAsync(CancellationToken cancellationToken)
        {
            _status = _status with { IsCapturing = false, State = "idle", ErrorCode = null };
            StopObserved.TrySetResult(true);
            return Task.FromResult(_status);
        }

        public void Emit(EncodedProgramVideoFrame frame)
        {
            _status = _status with { FramesEncoded = _status.FramesEncoded + 1 };
            FrameEncoded?.Invoke(this, frame);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private sealed class FakeAudioSource : IEncodedProgramAudioSource
    {
        private ProgramAudioSourceStatus _status = new(false, "idle", null, 0, 0, null);
        public event EventHandler<EncodedProgramAudioFrame>? FrameEncoded;
        public ProgramAudioSourceStatus Status => _status;
        public Guid? StartedServiceId { get; private set; }
        public TaskCompletionSource<bool> StopObserved { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task<ProgramAudioSourceStatus> StartAsync(
            Guid serviceId,
            ProgramAudioCaptureOptions options,
            CancellationToken cancellationToken)
        {
            options.Validate();
            StartedServiceId = serviceId;
            _status = _status with
            {
                IsCapturing = true,
                State = "capturing",
                ServiceId = serviceId,
                ErrorCode = null
            };
            return Task.FromResult(_status);
        }

        public Task<ProgramAudioSourceStatus> StopAsync(CancellationToken cancellationToken)
        {
            _status = _status with { IsCapturing = false, State = "idle", ServiceId = null, ErrorCode = null };
            StopObserved.TrySetResult(true);
            return Task.FromResult(_status);
        }

        public void Emit(EncodedProgramAudioFrame frame)
        {
            _status = _status with { FramesEncoded = _status.FramesEncoded + 1 };
            FrameEncoded?.Invoke(this, frame);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private sealed class FakeSrtSender : ISrtContributionSender
    {
        private readonly object _gate = new();
        private SrtContributionSenderStatus _status = new(false, "idle", 0, 0, 0, null, null);
        private TaskCompletionSource<bool> _sendRelease =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public bool ConnectSucceeds { get; init; } = true;
        public bool FailSends { get; init; }
        public bool BlockSends { get; init; }
        public int ConnectCalls { get; private set; }
        public List<byte[]> Messages { get; } = [];
        public TaskCompletionSource<bool> SendObserved { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<bool> SendStarted { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public SrtContributionSenderStatus Status
        {
            get { lock (_gate) return _status; }
        }

        public Task<SrtContributionSenderStatus> ConnectAsync(Uri publishUri, CancellationToken cancellationToken)
        {
            ConnectCalls++;
            lock (_gate)
            {
                _status = ConnectSucceeds
                    ? _status with { IsConnected = true, State = "connected", ErrorCode = null }
                    : _status with { IsConnected = false, State = "error", ErrorCode = "transport_connect_failed" };
                return Task.FromResult(_status);
            }
        }

        public async Task SendAsync(ReadOnlyMemory<byte> payload, CancellationToken cancellationToken)
        {
            SendStarted.TrySetResult(true);
            if (BlockSends)
                await _sendRelease.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
            if (FailSends) throw new IOException("Synthetic SRT send failure.");

            var copy = payload.ToArray();
            lock (_gate)
            {
                Messages.Add(copy);
                _status = _status with
                {
                    BytesSent = _status.BytesSent + copy.Length,
                    LastSuccessfulSendAt = DateTimeOffset.UtcNow
                };
            }
            SendObserved.TrySetResult(true);
        }

        public Task<SrtContributionSenderStatus> DisconnectAsync(CancellationToken cancellationToken)
        {
            lock (_gate)
            {
                _status = _status with { IsConnected = false, State = "idle", ErrorCode = null };
                return Task.FromResult(_status);
            }
        }

        public void ReleaseBlockedSends() => _sendRelease.TrySetResult(true);
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
