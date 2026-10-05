using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.MacOS;

public static class MacOSPlatformProfile
{
    public static PlatformProfile Create(MacOSNativeMediaBridge? bridge = null)
    {
        bridge ??= new MacOSNativeMediaBridge();
        var nativeReady = bridge.IsNativeBridgeAvailable();

        return new(
            EdgePlatform.MacOS,
            System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
            new[]
            {
                new PlatformCapability(
                    "audio.capture",
                    "Mixer / microphone capture",
                    nativeReady && bridge.SupportsAudioCapture() ? "available" : "planned",
                    "AVAudioEngine default-input capture over native Swift bridge"),
                new PlatformCapability(
                    "camera.capture",
                    "Camera capture",
                    nativeReady && bridge.SupportsCameraCapture() ? "available" : "planned",
                    "AVFoundation"),
                new PlatformCapability(
                    "screen.capture",
                    "Screen / window capture",
                    nativeReady && bridge.SupportsScreenCapture() ? "available" : "planned",
                    "ScreenCaptureKit"),
                new PlatformCapability("video.encode", "Hardware video encode", "planned", "VideoToolbox / FFmpeg"),
                new PlatformCapability("ndi", "NDI input/output", "planned", "NDI SDK adapter"),
                new PlatformCapability("display.program", "Program display", "available", "Offline local renderer with managed Chromium kiosk output"),
                new PlatformCapability("recording.local", "Local audio recording", "available", "Segmented crash-resilient WAV from CoreAudio mixer input"),
                new PlatformCapability("atem.ptz", "ATEM / PTZ control", "planned", "Vendor/network adapters"),
            });
    }
}
