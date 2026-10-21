using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Desktop.Update;
using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class UpdateSafetyPolicyTests
{
    [Fact]
    public void SafeWhenProgramOutputRecordingAndCriticalSessionAreIdle()
    {
        Assert.True(UpdateSafetyPolicy.IsSafe(Local(), Runtime()));
    }

    [Fact]
    public void RecordingBlocksRestartInstall()
    {
        Assert.False(UpdateSafetyPolicy.IsSafe(Local(recording: true), Runtime()));
    }

    [Fact]
    public void ProgramContentBlocksRestartInstall()
    {
        Assert.False(UpdateSafetyPolicy.IsSafe(Local(program: true), Runtime()));
    }

    [Fact]
    public void OutputRunningBlocksRestartInstall()
    {
        Assert.False(UpdateSafetyPolicy.IsSafe(Local(output: true), Runtime()));
    }

    [Fact]
    public void CriticalRuntimeSessionBlocksRestartInstall()
    {
        Assert.False(UpdateSafetyPolicy.IsSafe(Local(), Runtime(critical: true)));
    }

    private static LocalOperatorSnapshot Local(bool output = false, bool recording = false, bool program = false) => new(
        OutputRunning: output,
        Preview: null,
        Program: program ? new PresentationRenderItem(
            "program-1",
            Guid.NewGuid(),
            "slide",
            "Live",
            "Live body",
            null,
            new Dictionary<string, string>()) : null,
        IsRecording: recording,
        RecordingId: recording ? "recording-1" : null,
        ConnectionStatus: "Online",
        ActiveServiceId: null,
        ServiceMode: "rehearsal",
        UpdatedAt: DateTimeOffset.UtcNow);

    private static EdgeDesktopSnapshot Runtime(bool critical = false) => new(
        EdgeDesktopRuntimeState.Active,
        ProcessId: 1234,
        ExitCode: null,
        ControlPlaneHealthy: true,
        LocalProgramHealthy: true,
        ErrorCode: null,
        UpdatedAt: DateTimeOffset.UtcNow,
        CriticalLiveSessionActive: critical);
}
