using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

public sealed class VoiceScriptureStatusTests
{
    [Fact]
    public void OperatorSurfacesMicrophoneAsrAndVoiceScriptureState()
    {
        var main = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Desktop", "MainWindow.cs"));
        var contracts = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Core", "Runtime", "LocalOperatorContracts.cs"));
        var handler = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Core", "Runtime", "LocalOperatorCommandHandler.cs"));
        var runtime = File.ReadAllText(FindSourceFile("src", "iPresenterPlux.Edge.Core", "Runtime", "EdgeAgentRuntime.cs"));

        Assert.Contains("VOICE SCRIPTURE", main, StringComparison.Ordinal);
        Assert.Contains("_microphoneStatus", main, StringComparison.Ordinal);
        Assert.Contains("_asrStatus", main, StringComparison.Ordinal);
        Assert.Contains("_voiceScriptureStatus", main, StringComparison.Ordinal);
        Assert.Contains("snapshot.AudioStatus", main, StringComparison.Ordinal);
        Assert.Contains("snapshot.AsrStatus", main, StringComparison.Ordinal);
        Assert.Contains("string? AudioStatus = null", contracts, StringComparison.Ordinal);
        Assert.Contains("string? AsrStatus = null", contracts, StringComparison.Ordinal);
        Assert.Contains("runtime.AsrStatus", handler, StringComparison.Ordinal);
        Assert.Contains("AsrStatus = _latestAsrWorkerHealth", runtime, StringComparison.Ordinal);
    }

    private static string FindSourceFile(params string[] pathParts)
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine([current.FullName, .. pathParts]);
            if (File.Exists(candidate)) return candidate;
            current = current.Parent;
        }
        throw new FileNotFoundException("Could not locate requested source file from desktop test output directory.");
    }
}
