using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.MacOS;

public static class MacOSPlatformProfile
{
    public static PlatformProfile Create() => new(
        EdgePlatform.MacOS,
        System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
        new[]
        {
            new PlatformCapability("audio.capture", "Mixer / microphone capture", "planned", "CoreAudio"),
            new PlatformCapability("camera.capture", "Camera capture", "planned", "AVFoundation"),
            new PlatformCapability("screen.capture", "Screen / window capture", "planned", "ScreenCaptureKit"),
            new PlatformCapability("video.encode", "Hardware video encode", "planned", "VideoToolbox / FFmpeg"),
            new PlatformCapability("ndi", "NDI input/output", "planned", "NDI SDK adapter"),
            new PlatformCapability("display.program", "Program / Stage displays", "planned", "AppKit / Metal"),
            new PlatformCapability("atem.ptz", "ATEM / PTZ control", "planned", "Vendor/network adapters"),
        });
}
