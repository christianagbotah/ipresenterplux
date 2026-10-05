using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Windows;

public static class WindowsPlatformProfile
{
    public static PlatformProfile Create() => new(
        EdgePlatform.Windows,
        System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
        new[]
        {
            new PlatformCapability("audio.capture", "Mixer / microphone capture", "available", "WASAPI event-driven capture via NAudio.Wasapi 3.1.0"),
            new PlatformCapability("screen.capture", "Screen / window capture", "planned", "Windows Graphics Capture"),
            new PlatformCapability("video.encode", "Hardware video encode", "planned", "Media Foundation / FFmpeg"),
            new PlatformCapability("ndi", "NDI input/output", "planned", "NDI SDK adapter"),
            new PlatformCapability("display.program", "Program display", "available", "Offline local renderer with managed Edge/Chrome kiosk output"),
            new PlatformCapability("obs.vmix", "OBS / vMix integration", "planned", "NDI, WebSocket and local adapters"),
            new PlatformCapability("atem.ptz", "ATEM / PTZ control", "planned", "Vendor/network adapters"),
        });
}
