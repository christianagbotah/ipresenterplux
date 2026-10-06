using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Journals;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.State;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class DurableControlCommandExecutorTests : IDisposable
{
    private readonly string _directory = Path.Combine(
        Path.GetTempPath(), "ipresenterplux-command-replay-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task StartAndStopRetriesAfterRestartReuseDurableResultsWithoutReexecutingTransport()
    {
        Directory.CreateDirectory(_directory);
        var organizationId = Guid.NewGuid();
        var deviceId = Guid.NewGuid();
        var serviceId = Guid.NewGuid();
        var state = new AgentRuntimeState();
        state.Update(snapshot => snapshot with { ActiveServiceId = serviceId, ServiceMode = "live" });
        var firstPublisher = new CountingPublisher();
        var firstProcessor = new ControlCommandProcessor(state, streamPublisher: firstPublisher);
        var firstExecutor = new DurableControlCommandExecutor(
            organizationId,
            deviceId,
            new FileCompletedCommandJournal(_directory),
            firstProcessor);
        var start = Command(serviceId, "stream.start");
        var stop = Command(serviceId, "stream.stop");

        var firstStart = await firstExecutor.ExecuteAsync(start, CancellationToken.None);
        var firstStop = await firstExecutor.ExecuteAsync(stop, CancellationToken.None);

        Assert.True(firstStart.Success);
        Assert.Equal("stream_live", firstStart.ResultingState);
        Assert.True(firstStop.Success);
        Assert.Equal("stream_stopped", firstStop.ResultingState);
        Assert.Equal(1, firstPublisher.StartCount);
        Assert.Equal(1, firstPublisher.StopCount);

        // Simulate process restart plus cloud retry after an ACK was lost. The
        // transport must not run again; the exact persisted result is replayed.
        var restartedPublisher = new CountingPublisher();
        var restartedProcessor = new ControlCommandProcessor(state, streamPublisher: restartedPublisher);
        var restartedExecutor = new DurableControlCommandExecutor(
            organizationId,
            deviceId,
            new FileCompletedCommandJournal(_directory),
            restartedProcessor);

        var replayedStart = await restartedExecutor.ExecuteAsync(start, CancellationToken.None);
        var replayedStop = await restartedExecutor.ExecuteAsync(stop, CancellationToken.None);

        Assert.Equal(firstStart, replayedStart);
        Assert.Equal(firstStop, replayedStop);
        Assert.Equal(0, restartedPublisher.StartCount);
        Assert.Equal(0, restartedPublisher.StopCount);
    }

    [Fact]
    public async Task FailedJournalWriteKeepsCompletedResultPendingForRetryWithoutReexecutingCommand()
    {
        var organizationId = Guid.NewGuid();
        var deviceId = Guid.NewGuid();
        var serviceId = Guid.NewGuid();
        var state = new AgentRuntimeState();
        state.Update(snapshot => snapshot with { ActiveServiceId = serviceId, ServiceMode = "live" });
        var publisher = new CountingPublisher();
        var journal = new FailFirstStoreJournal();
        var executor = new DurableControlCommandExecutor(
            organizationId,
            deviceId,
            journal,
            new ControlCommandProcessor(state, streamPublisher: publisher));
        var command = Command(serviceId, "stream.start");

        await Assert.ThrowsAsync<IOException>(() => executor.ExecuteAsync(command, CancellationToken.None));
        Assert.Equal(1, publisher.StartCount);

        executor.FlushPending();
        var replay = await executor.ExecuteAsync(command, CancellationToken.None);

        Assert.True(replay.Success);
        Assert.Equal("stream_live", replay.ResultingState);
        Assert.Equal(1, publisher.StartCount);
    }

    private static ControlCommand Command(Guid serviceId, string type) => new(
        Guid.NewGuid().ToString("D"),
        serviceId.ToString("D"),
        type,
        DateTimeOffset.Parse("2026-10-06T13:00:00Z"),
        new Dictionary<string, string>());

    private sealed class CountingPublisher : IMasterStreamPublisher
    {
        private MasterStreamStatus _status = new(false, null, "idle", null, null, null, 0, 0, null, null);
        public int StartCount { get; private set; }
        public int StopCount { get; private set; }
        public MasterStreamStatus Status => _status;

        public Task<MasterStreamStatus> StartAsync(Guid serviceId, CancellationToken cancellationToken)
        {
            StartCount++;
            _status = new(true, serviceId, "publishing", DateTimeOffset.Parse("2026-10-06T13:00:00Z"),
                4_500_000, 30, 0, 0, DateTimeOffset.Parse("2026-10-06T13:00:00Z"), null);
            return Task.FromResult(_status);
        }

        public Task<MasterStreamStatus> StopAsync(CancellationToken cancellationToken)
        {
            StopCount++;
            _status = new(false, null, "idle", null, null, 0, 0, null, null, null);
            return Task.FromResult(_status);
        }

        public Task HandleActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken) => Task.CompletedTask;

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private sealed class FailFirstStoreJournal : ICompletedCommandJournal
    {
        private ControlCommandResult? _result;
        private bool _failed;

        public ControlCommandResult? Find(Guid organizationId, Guid deviceId, string commandId) =>
            _result?.CommandId == commandId ? _result : null;

        public void Store(Guid organizationId, Guid deviceId, ControlCommandResult result)
        {
            if (!_failed)
            {
                _failed = true;
                throw new IOException("simulated journal write failure");
            }
            _result = result;
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
