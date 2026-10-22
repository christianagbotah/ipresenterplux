using Xunit;

namespace iPresenterPlux.Edge.MacOS.Tests;

public sealed class MacOSProgramWiringTests
{
    [Fact]
    public void HostMixesMediaAudioWithoutChangingProgramWindowVideoCapture()
    {
        var source = File.ReadAllText(ProgramSourcePath());
        var video = File.ReadAllText(VideoSourcePath());

        Assert.Contains("var mediaAudioFrameProvider = new MacOSMediaAudioFrameProvider(nativeBridge)", source, StringComparison.Ordinal);
        Assert.Contains("await using var programAudioMixCoordinator = new ProgramAudioMixCoordinator(", source, StringComparison.Ordinal);
        Assert.Contains("_ = programAudioMixCoordinator.TrySubmitLive(frame);", source, StringComparison.Ordinal);
        Assert.DoesNotContain("_ = contributionAudioBuffer.TrySubmit(frame);", source, StringComparison.Ordinal);
        Assert.Contains("new MacOSEncodedProgramVideoSource()", source, StringComparison.Ordinal);
        Assert.Contains("programDisplay.ActiveProcessId", source, StringComparison.Ordinal);
        Assert.Contains("RequiredBridgeApiVersion = 5", video, StringComparison.Ordinal);
    }

    private static string ProgramSourcePath([System.Runtime.CompilerServices.CallerFilePath] string testFile = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(testFile)!, "..", "..", "src", "iPresenterPlux.Edge.MacOS", "Program.cs"));

    private static string VideoSourcePath([System.Runtime.CompilerServices.CallerFilePath] string testFile = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(testFile)!, "..", "..", "src", "iPresenterPlux.Edge.MacOS", "MacOSEncodedProgramVideoSource.cs"));
}
