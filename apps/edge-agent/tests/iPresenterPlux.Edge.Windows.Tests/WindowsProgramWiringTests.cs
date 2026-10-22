using Xunit;

namespace iPresenterPlux.Edge.Windows.Tests;

public sealed class WindowsProgramWiringTests
{
    [Fact]
    public void HostRoutesNativeVisualProgramThroughExistingEncoderAndRuntimeAuthority()
    {
        var source = File.ReadAllText(ProgramSourcePath());

        Assert.Contains("var mediaVideoFrameProvider = new WindowsMediaFoundationMediaVideoFrameProvider", source, StringComparison.Ordinal);
        Assert.Contains("var renderedProgramSource = new PresentationProgramVideoSource", source, StringComparison.Ordinal);
        Assert.Contains("mediaOutput, new SkiaProgramFrameRenderer(), mediaPlayback, mediaPreparation, mediaVideoFrameProvider", source, StringComparison.Ordinal);
        Assert.Contains("var visualCatalog = new WindowsVisualSourceCatalog", source, StringComparison.Ordinal);
        Assert.Contains("var visualFactory = new WindowsVisualCaptureFactory", source, StringComparison.Ordinal);
        Assert.Contains("await using var visualRouter = new VisualProgramRouter", source, StringComparison.Ordinal);
        Assert.Contains("visualCatalog, visualFactory, renderedProgramSource", source, StringComparison.Ordinal);
        Assert.Contains("new WindowsMediaFoundationEncodedProgramVideoSource(visualRouter)", source, StringComparison.Ordinal);
        Assert.Contains("visualSourceCatalog: visualCatalog", source, StringComparison.Ordinal);
        Assert.Contains("visualRouter: visualRouter", source, StringComparison.Ordinal);
        Assert.DoesNotContain("new RenderedProgramVideoSource", source, StringComparison.Ordinal);
        Assert.DoesNotContain("WindowsMediaFoundationEncodedProgramVideoSource(new WindowsCameraCaptureSession", source, StringComparison.Ordinal);
        Assert.DoesNotContain("WindowsMediaFoundationEncodedProgramVideoSource(new WindowsGraphicsCaptureSession", source, StringComparison.Ordinal);
    }

    [Fact]
    public void NativeVisualCapabilitiesRemainPlannedUntilPhysicalUat()
    {
        var profile = WindowsPlatformProfile.Create();
        var capabilities = profile.Capabilities.ToDictionary(item => item.Key, item => item);

        Assert.Equal("planned", capabilities["screen.capture"].Status);
        Assert.Equal("planned", capabilities["camera.capture"].Status);
        Assert.Contains("implemented", capabilities["screen.capture"].Detail, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("physical", capabilities["screen.capture"].Detail, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("implemented", capabilities["camera.capture"].Detail, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("physical", capabilities["camera.capture"].Detail, StringComparison.OrdinalIgnoreCase);
    }

    private static string ProgramSourcePath([System.Runtime.CompilerServices.CallerFilePath] string testFile = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(testFile)!, "..", "..", "src", "iPresenterPlux.Edge.Windows", "Program.cs"));
}
