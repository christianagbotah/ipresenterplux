using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.State;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class StreamPublishingMediaOutputServiceTests
{
    [Fact]
    public async Task ServiceChangeStopsPublisherBeforeChangingInnerOutput()
    {
        var calls = new List<string>();
        var publisher = new FakePublisher(calls);
        var inner = new FakeScopedOutput(calls);
        var output = new StreamPublishingMediaOutputService(inner, publisher);
        var serviceId = Guid.NewGuid();

        await output.SetActiveServiceAsync(serviceId, CancellationToken.None);

        Assert.Equal(
            new[] { $"publisher:{serviceId:D}", $"output:{serviceId:D}" },
            calls);
    }

    [Fact]
    public async Task ControlProcessorDiscoversPublisherFromStreamAwareOutput()
    {
        var serviceId = Guid.NewGuid();
        var calls = new List<string>();
        var publisher = new FakePublisher(calls);
        var output = new StreamPublishingMediaOutputService(new FakeScopedOutput(calls), publisher);
        var state = new AgentRuntimeState();
        state.Update(snapshot => snapshot with { ActiveServiceId = serviceId });
        var processor = new ControlCommandProcessor(state, output);
        var command = new ControlCommand(
            Guid.NewGuid().ToString("D"),
            serviceId.ToString("D"),
            "stream.start",
            DateTimeOffset.UtcNow,
            new Dictionary<string, string>());

        var result = await processor.ProcessAsync(command, CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal("stream_live", result.ResultingState);
        Assert.Equal(serviceId, publisher.Status.ServiceId);
        Assert.Contains($"start:{serviceId:D}", calls);
    }

    private sealed class FakeScopedOutput(List<string> calls) : IMediaOutputService, IServiceScopedMediaOutput
    {
        public Task StartProgramOutputAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StopProgramOutputAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task SetPreviewAsync(PresentationRenderItem item, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task TakePreviewToProgramAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task ClearProgramAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task SetActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken)
        {
            calls.Add($"output:{serviceId?.ToString("D") ?? "none"}");
            return Task.CompletedTask;
        }
    }

    private sealed class FakePublisher(List<string> calls) : IMasterStreamPublisher
    {
        private MasterStreamStatus _status = Idle();

        public MasterStreamStatus Status => _status;

        public Task<MasterStreamStatus> StartAsync(Guid serviceId, CancellationToken cancellationToken)
        {
            calls.Add($"start:{serviceId:D}");
            _status = new MasterStreamStatus(
                true,
                serviceId,
                "publishing",
                DateTimeOffset.UtcNow,
                1_000_000,
                30,
                0,
                0,
                DateTimeOffset.UtcNow,
                null);
            return Task.FromResult(_status);
        }

        public Task<MasterStreamStatus> StopAsync(CancellationToken cancellationToken)
        {
            calls.Add("stop");
            _status = Idle();
            return Task.FromResult(_status);
        }

        public Task HandleActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken)
        {
            calls.Add($"publisher:{serviceId?.ToString("D") ?? "none"}");
            if (_status.ServiceId is not null && _status.ServiceId != serviceId)
                _status = Idle();
            return Task.CompletedTask;
        }

        public ValueTask DisposeAsync()
        {
            _status = Idle();
            return ValueTask.CompletedTask;
        }

        private static MasterStreamStatus Idle() => new(
            false,
            null,
            "idle",
            null,
            null,
            null,
            0,
            0,
            null,
            null);
    }
}
