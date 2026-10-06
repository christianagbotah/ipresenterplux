using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.State;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class LocalOperatorCommandHandlerTests
{
    [Fact]
    public async Task PreviewTakeAndClearUseAuthoritativeActiveService()
    {
        var serviceId = Guid.NewGuid();
        var state = new AgentRuntimeState();
        state.Update(s => s with { ActiveServiceId = serviceId, ConnectionStatus = "Online", ServiceMode = "Live" });
        await using var output = new LocalWebProgramOutputService(49401);
        var handler = new LocalOperatorCommandHandler(state, output);

        var preview = await handler.HandleAsync(Request(
            LocalOperatorCommands.PreviewRender,
            new LocalOperatorPresentation("scripture-1", "scripture", "John 3:16", "For God so loved the world...", "KJV")),
            CancellationToken.None);

        Assert.True(preview.Ok);
        Assert.Equal(serviceId, preview.Snapshot.Preview?.ServiceId);
        Assert.Equal("scripture-1", output.Snapshot.Preview?.ItemId);

        var take = await handler.HandleAsync(Request(LocalOperatorCommands.ProgramTake), CancellationToken.None);
        Assert.True(take.Ok);
        Assert.Equal("scripture-1", take.Snapshot.Program?.ItemId);

        var clear = await handler.HandleAsync(Request(LocalOperatorCommands.ProgramClear), CancellationToken.None);
        Assert.True(clear.Ok);
        Assert.Null(clear.Snapshot.Program);
        Assert.Equal("scripture-1", clear.Snapshot.Preview?.ItemId);
    }

    [Fact]
    public async Task LocalRehearsalContentCannotInventAServiceScope()
    {
        var state = new AgentRuntimeState();
        await using var output = new LocalWebProgramOutputService(49402);
        var handler = new LocalOperatorCommandHandler(state, output);

        var response = await handler.HandleAsync(Request(
            LocalOperatorCommands.PreviewRender,
            new LocalOperatorPresentation("rehearsal", "scripture", "Psalm 23:1", "The Lord is my shepherd.", "KJV")),
            CancellationToken.None);

        Assert.True(response.Ok);
        Assert.Equal(Guid.Empty, response.Snapshot.Preview?.ServiceId);
        Assert.Null(response.Snapshot.ActiveServiceId);
    }

    [Fact]
    public async Task RejectsUnsupportedCommandsAndOversizedContent()
    {
        var state = new AgentRuntimeState();
        await using var output = new LocalWebProgramOutputService(49403);
        var handler = new LocalOperatorCommandHandler(state, output);

        var unsupported = await handler.HandleAsync(Request("shell.exec"), CancellationToken.None);
        Assert.False(unsupported.Ok);
        Assert.Equal("unsupported_command", unsupported.ErrorCode);

        var oversized = await handler.HandleAsync(Request(
            LocalOperatorCommands.PreviewRender,
            new LocalOperatorPresentation("x", "scripture", "title", new string('x', 12001), null)),
            CancellationToken.None);
        Assert.False(oversized.Ok);
        Assert.Equal("body_invalid", oversized.ErrorCode);
    }

    [Fact]
    public async Task RecordingStartUsesRuntimeServiceAndRequiresOne()
    {
        var state = new AgentRuntimeState();
        await using var output = new LocalWebProgramOutputService(49404);
        await using var recording = new FakeRecordingService();
        var handler = new LocalOperatorCommandHandler(state, output, recording);

        var missing = await handler.HandleAsync(Request(LocalOperatorCommands.RecordingStart), CancellationToken.None);
        Assert.False(missing.Ok);
        Assert.Equal("service_required", missing.ErrorCode);

        var serviceId = Guid.NewGuid();
        state.Update(s => s with { ActiveServiceId = serviceId });
        var started = await handler.HandleAsync(Request(LocalOperatorCommands.RecordingStart), CancellationToken.None);
        Assert.True(started.Ok);
        Assert.Equal(serviceId, recording.Status.ServiceId);
        Assert.True(started.Snapshot.IsRecording);
    }

    [Fact]
    public void EndpointIsStableAndKeepsUnixSocketInsideDataDirectory()
    {
        var root = Path.Combine(Path.GetTempPath(), "ipresenterplux-ipc-tests", "church-a");
        var first = LocalOperatorIpcEndpoint.ForDataDirectory(root);
        var second = LocalOperatorIpcEndpoint.ForDataDirectory(root);

        Assert.Equal(first.PipeName, second.PipeName);
        Assert.StartsWith("ipresenterplux-operator-", first.PipeName);
        Assert.Equal(Path.Combine(Path.GetFullPath(root), "operator.sock"), first.UnixSocketPath);
    }

    [Fact]
    public void LongUnixSocketPathFallsBackToBoundedStablePath()
    {
        var root = Path.Combine(Path.GetTempPath(), "ipresenterplux-ipc-tests", new string('x', 180));
        var first = LocalOperatorIpcEndpoint.ForDataDirectory(root);
        var second = LocalOperatorIpcEndpoint.ForDataDirectory(root);

        Assert.Equal(first.UnixSocketPath, second.UnixSocketPath);
        Assert.NotEqual(Path.Combine(Path.GetFullPath(root), "operator.sock"), first.UnixSocketPath);
        Assert.True(Encoding.UTF8.GetByteCount(first.UnixSocketPath) <= 100);
    }

    private static LocalOperatorRequest Request(string command, LocalOperatorPresentation? presentation = null) =>
        new(Guid.NewGuid().ToString("D"), command, presentation);

    private sealed class FakeRecordingService : ILocalRecordingService
    {
        public LocalRecordingStatus Status { get; private set; } =
            new(false, null, null, null, null, 0, 0, null);

        public Task<LocalRecordingStatus> StartAsync(Guid serviceId, CancellationToken cancellationToken)
        {
            Status = new LocalRecordingStatus(true, serviceId, "recording-1", null, DateTimeOffset.UtcNow, 0, 0, null);
            return Task.FromResult(Status);
        }

        public Task<LocalRecordingStatus> StopAsync(CancellationToken cancellationToken)
        {
            Status = Status with { IsRecording = false };
            return Task.FromResult(Status);
        }

        public Task HandleActiveServiceAsync(Guid? serviceId, CancellationToken cancellationToken) => Task.CompletedTask;
        public bool TrySubmit(AudioFrame frame) => true;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
