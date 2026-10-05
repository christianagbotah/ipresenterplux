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
    public async Task ProgramShowPreparesItemThenTakesItLive()
    {
        var serviceId = Guid.NewGuid();
        var state = new AgentRuntimeState();
        state.Update(snapshot => snapshot with { ActiveServiceId = serviceId, ServiceMode = "live" });
        var output = new FakeMediaOutput();
        var itemId = Guid.NewGuid().ToString("D");
        var content = new FakeContentProvider(new PresentationRenderItem(
            itemId, serviceId, "scripture", "John 3:16", "For God so loved the world", "KJV",
            new Dictionary<string, string>()));
        var processor = new ControlCommandProcessor(state, output, content);
        var command = new ControlCommand(
            Guid.NewGuid().ToString("D"), serviceId.ToString("D"), "program.show", DateTimeOffset.UtcNow,
            new Dictionary<string, string> { ["itemId"] = itemId });

        var result = await processor.ProcessAsync(command, CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(itemId, output.LastPreviewItem?.ItemId);
        Assert.Equal("John 3:16", output.LastPreviewItem?.Title);
        Assert.Equal(1, output.TakeCount);
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

    private sealed class FakeContentProvider(PresentationRenderItem item) : IPresentationContentProvider
    {
        public Task<PresentationRenderItem> GetAsync(string itemId, CancellationToken cancellationToken)
        {
            Assert.Equal(item.ItemId, itemId);
            return Task.FromResult(item);
        }
    }

    private sealed class FakeMediaOutput : IMediaOutputService
    {
        public int ClearCount { get; private set; }
        public int TakeCount { get; private set; }
        public PresentationRenderItem? LastPreviewItem { get; private set; }
        public Task StartProgramOutputAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StopProgramOutputAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task SetPreviewAsync(PresentationRenderItem item, CancellationToken cancellationToken) { LastPreviewItem = item; return Task.CompletedTask; }
        public Task TakePreviewToProgramAsync(CancellationToken cancellationToken) { TakeCount++; return Task.CompletedTask; }
        public Task ClearProgramAsync(CancellationToken cancellationToken) { ClearCount++; return Task.CompletedTask; }
    }
}
