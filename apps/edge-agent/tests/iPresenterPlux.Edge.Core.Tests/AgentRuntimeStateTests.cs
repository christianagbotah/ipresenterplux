using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.State;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class AgentRuntimeStateTests
{
    [Fact]
    public void UpdateCopiesSourcesAndNotifiesWithCommittedSnapshot()
    {
        var now = DateTimeOffset.Parse("2026-01-01T00:00:00Z");
        var state = new AgentRuntimeState(new FixedClock(now));
        var sources = new List<SourceHealth> { new("mic", "Microphone", "audio", "ready") };
        AgentSnapshot? notification = null;
        state.Changed += (_, snapshot) => notification = snapshot;

        state.Update(snapshot => snapshot with { ConnectionStatus = "Connected", Sources = sources });
        sources.Clear();

        Assert.Same(state.Snapshot, notification);
        Assert.Equal(now, state.Snapshot.UpdatedAt);
        Assert.Equal("Connected", state.Snapshot.ConnectionStatus);
        Assert.Single(state.Snapshot.Sources);
    }

    [Fact]
    public async Task ConcurrentUpdatesDoNotLoseChanges()
    {
        var state = new AgentRuntimeState();
        state.Update(snapshot => snapshot with { ServiceMode = "0" });
        await Task.WhenAll(Enumerable.Range(0, 100).Select(_ => Task.Run(() =>
            state.Update(snapshot => snapshot with { ServiceMode = (int.Parse(snapshot.ServiceMode) + 1).ToString() }))));
        Assert.Equal("100", state.Snapshot.ServiceMode);
    }

    [Fact]
    public void NotificationsRunOutsideTheStateLock()
    {
        var state = new AgentRuntimeState();
        AgentSnapshot? observed = null;
        state.Changed += (_, _) =>
        {
            var reader = new Thread(() => observed = state.Snapshot) { IsBackground = true };
            reader.Start();
            Assert.True(reader.Join(TimeSpan.FromSeconds(5)), "Callback must allow another thread to read state.");
        };
        state.Update(snapshot => snapshot with { AudioStatus = "Capturing" });
        Assert.NotNull(observed);
        Assert.Equal("Capturing", observed.AudioStatus);
    }

    [Fact]
    public void FailedUpdatePreservesSnapshotAndDoesNotNotify()
    {
        var state = new AgentRuntimeState();
        var before = state.Snapshot;
        var notifications = 0;
        state.Changed += (_, _) => notifications++;
        Assert.Throws<InvalidOperationException>(() => state.Update(_ => throw new InvalidOperationException()));
        Assert.Throws<ArgumentNullException>(() => state.Update(null!));
        Assert.Throws<ArgumentNullException>(() => state.Update(_ => null!));
        Assert.Same(before, state.Snapshot);
        Assert.Equal(0, notifications);
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
