using System.Diagnostics;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class BoundedContributionAudioBufferTests
{
    [Fact]
    public void DisabledBufferRejectsWithoutQueueing()
    {
        var buffer = new BoundedContributionAudioBuffer(2);

        Assert.False(buffer.TrySubmit(Frame(new byte[] { 1, 2, 3, 4 })));
        Assert.Equal(new(false, null, 0, 0), buffer.Status);
    }

    [Fact]
    public async Task EnabledBufferOwnsSubmittedAudioMemory()
    {
        var serviceId = Guid.NewGuid();
        var buffer = new BoundedContributionAudioBuffer(2);
        buffer.Enable(serviceId);
        var source = new byte[] { 10, 20, 30, 40 };

        Assert.True(buffer.TrySubmit(Frame(source)));
        source[0] = 99;

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        await using var reader = buffer.ReadAllAsync(cts.Token).GetAsyncEnumerator();
        Assert.True(await reader.MoveNextAsync());
        Assert.Equal(new byte[] { 10, 20, 30, 40 }, reader.Current.Buffer.ToArray());
        Assert.Equal(1, buffer.Status.AcceptedFrames);
        Assert.Equal(0, buffer.Status.DroppedFrames);
        Assert.Equal(serviceId, buffer.Status.ServiceId);
    }

    [Fact]
    public void FullBufferDropsImmediatelyInsteadOfBlockingCaptureThread()
    {
        var buffer = new BoundedContributionAudioBuffer(1);
        buffer.Enable(Guid.NewGuid());
        Assert.True(buffer.TrySubmit(Frame(new byte[] { 1, 2, 3, 4 })));

        var stopwatch = Stopwatch.StartNew();
        var accepted = buffer.TrySubmit(Frame(new byte[] { 5, 6, 7, 8 }));
        stopwatch.Stop();

        Assert.False(accepted);
        Assert.Equal(1, buffer.Status.AcceptedFrames);
        Assert.Equal(1, buffer.Status.DroppedFrames);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromMilliseconds(100), "TrySubmit must never wait for the streaming consumer.");
    }

    [Fact]
    public async Task DisableDrainsStaleFramesBeforeNextService()
    {
        var buffer = new BoundedContributionAudioBuffer(4);
        buffer.Enable(Guid.NewGuid());
        Assert.True(buffer.TrySubmit(Frame(new byte[] { 1, 1, 1, 1 })));
        buffer.Disable();

        var nextService = Guid.NewGuid();
        buffer.Enable(nextService);
        Assert.True(buffer.TrySubmit(Frame(new byte[] { 2, 2, 2, 2 })));

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        await using var reader = buffer.ReadAllAsync(cts.Token).GetAsyncEnumerator();
        Assert.True(await reader.MoveNextAsync());
        Assert.Equal(new byte[] { 2, 2, 2, 2 }, reader.Current.Buffer.ToArray());
        Assert.Equal(nextService, buffer.Status.ServiceId);
        Assert.Equal(1, buffer.Status.AcceptedFrames);
        Assert.Equal(0, buffer.Status.DroppedFrames);
    }

    [Fact]
    public void InvalidCapturedFrameIsDroppedWithoutThrowing()
    {
        var buffer = new BoundedContributionAudioBuffer(2);
        buffer.Enable(Guid.NewGuid());
        var invalid = new AudioFrame(
            new byte[2],
            4,
            48_000,
            2,
            16,
            DateTimeOffset.UtcNow,
            AudioSampleEncoding.PcmInteger);

        Assert.False(buffer.TrySubmit(invalid));
        Assert.Equal(1, buffer.Status.DroppedFrames);
    }

    private static AudioFrame Frame(byte[] bytes) => new(
        bytes,
        bytes.Length,
        48_000,
        2,
        16,
        DateTimeOffset.UtcNow,
        AudioSampleEncoding.PcmInteger);
}
