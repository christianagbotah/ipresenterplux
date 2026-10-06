using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.State;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class LocalOperatorClientTests
{
    [Fact]
    public async Task ClientControlsPreviewProgramAndClearAcrossPlatformIpc()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenterplux-desktop-ipc-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var serviceId = Guid.NewGuid();
            var state = new AgentRuntimeState();
            state.Update(snapshot => snapshot with
            {
                ActiveServiceId = serviceId,
                ConnectionStatus = "Online",
                ServiceMode = "Live"
            });
            await using var output = new LocalWebProgramOutputService(49501);
            var handler = new LocalOperatorCommandHandler(state, output);
            await using var server = new LocalOperatorIpcServer(directory, handler);
            await server.StartAsync(CancellationToken.None);
            if (!OperatingSystem.IsWindows())
            {
                var mode = File.GetUnixFileMode(server.Endpoint.UnixSocketPath);
                Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, mode);
            }
            var client = new LocalOperatorClient(directory, TimeSpan.FromSeconds(5));

            var preview = await client.SendAsync(
                LocalOperatorCommands.PreviewRender,
                new LocalOperatorPresentation("john-3-16", "scripture", "John 3:16", "For God so loved the world...", "KJV"));
            Assert.True(preview.Ok);
            Assert.Equal(serviceId, preview.Snapshot.Preview?.ServiceId);

            var take = await client.SendAsync(LocalOperatorCommands.ProgramTake);
            Assert.True(take.Ok);
            Assert.Equal("john-3-16", take.Snapshot.Program?.ItemId);

            var clear = await client.SendAsync(LocalOperatorCommands.ProgramClear);
            Assert.True(clear.Ok);
            Assert.Null(clear.Snapshot.Program);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task ClientRefusesCommandsOutsideTheLocalAllowlist()
    {
        var client = new LocalOperatorClient(Path.GetTempPath());
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => client.SendAsync("shell.exec"));
    }
}
