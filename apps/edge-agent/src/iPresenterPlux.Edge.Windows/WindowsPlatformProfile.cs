using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Windows;

public static class WindowsPlatformProfile
{
    public static PlatformProfile Create() => new(
        EdgePlatform.Windows,
        System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
        new[]
        {
            new PlatformCapability("audio.capture", "Mixer / microphone capture", "planned", "WASAPI shared/exclusive mode"),
            new PlatformCapability("screen.capture", "Screen / window capture", "planned", "Windows Graphics Capture"),
            new PlatformCapability("video.encode", "Hardware video encode", "planned", "Media Foundation / FFmpeg"),
            new PlatformCapability("ndi", "NDI input/output", "planned", "NDI SDK adapter"),
            new PlatformCapability("display.program", "Program / Stage displays", "planned", "Direct3D / native windows"),
            new PlatformCapability("obs.vmix", "OBS / vMix integration", "planned", "NDI, WebSocket and local adapters"),
            new PlatformCapability("atem.ptz", "ATEM / PTZ control", "planned", "Vendor/network adapters"),
        });
}
