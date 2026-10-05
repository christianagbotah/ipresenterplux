using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.State;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class ControlCommandProcessorTests
{
    [Fact]
    public async Task ExecutesProgramClearOnlyInsideAssignedService()
    {
        var serviceId = Guid.Parse("11111111-1111-4111-8111-111111111111");
        var state = new AgentRuntimeState();
        state.Update(snapshot => snapshot with { ActiveServiceId = serviceId, ServiceMode = "live" });
        var output = new FakeMediaOutput();
        var processor = new ControlCommandProcessor(state, output);
        var command = new ControlCommand(
            Guid.NewGuid().ToString("D"), serviceId.ToString("D"), "program.clear", DateTimeOffset.UtcNow,
            new Dictionary<string, string>());

        var result = await processor.ProcessAsync(command, CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal("program_clear", result.ResultingState);
        Assert.Equal(1, output.ClearCount);
    }

    [Fact]
    public async Task RejectsCommandForAnotherServiceWithoutTouchingOutput()
    {
        var state = new AgentRuntimeState();
        state.Update(snapshot => snapshot with { ActiveServiceId = Guid.NewGuid(), ServiceMode = "live" });
        var output = new FakeMediaOutput();
        var processor = new ControlCommandProcessor(state, output);
        var command = new ControlCommand(
            Guid.NewGuid().ToString("D"), Guid.NewGuid().ToString("D"), "program.take", DateTimeOffset.UtcNow,
            new Dictionary<string, string>());

        var result = await processor.ProcessAsync(command, CancellationToken.None);

        Assert.False(result.Success);
        Assert.Equal("service_scope_mismatch", result.Error);
        Assert.Equal(0, output.TakeCount);
    }

    [Fact]
    public async Task HealthQueryWorksWithoutMediaOutput()
    {
        var state = new AgentRuntimeState();
        state.Update(snapshot => snapshot with { ConnectionStatus = "Connected", AudioStatus = "Capturing", ServiceMode = "live" });
        var processor = new ControlCommandProcessor(state);
        var command = new ControlCommand(
            Guid.NewGuid().ToString("D"), null, "health.query", DateTimeOffset.UtcNow,
            new Dictionary<string, string>());

        var result = await processor.ProcessAsync(command, CancellationToken.None);

        Assert.True(result.Success);
        Assert.Contains("connection=Connected", result.ResultingState);
        Assert.Contains("audio=Capturing", result.ResultingState);
    }

    private sealed class FakeMediaOutput : IMediaOutputService
    {
        public int ClearCount { get; private set; }
        public int TakeCount { get; private set; }
        public Task StartProgramOutputAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StopProgramOutputAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task SetPreviewAsync(string itemId, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task TakePreviewToProgramAsync(CancellationToken cancellationToken) { TakeCount++; return Task.CompletedTask; }
        public Task ClearProgramAsync(CancellationToken cancellationToken) { ClearCount++; return Task.CompletedTask; }
    }
}
