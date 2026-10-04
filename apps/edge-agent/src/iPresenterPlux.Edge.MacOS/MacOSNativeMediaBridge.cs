using System.Runtime.InteropServices;

namespace iPresenterPlux.Edge.MacOS;

public sealed class MacOSNativeMediaBridge
{
    private const string LibraryName = "iPresenterPluxMediaBridge";

    public bool IsMacOS => RuntimeInformation.IsOSPlatform(OSPlatform.OSX);

    public bool IsNativeBridgeAvailable()
    {
        if (!IsMacOS) return false;

        if (!NativeLibrary.TryLoad(LibraryName, out var handle))
        {
            return false;
        }

        NativeLibrary.Free(handle);
        return true;
    }

    public int GetApiVersion()
    {
        EnsureMacOS();
        return NativeMethods.BridgeApiVersion();
    }

    public bool SupportsScreenCapture()
    {
        EnsureMacOS();
        return NativeMethods.IsScreenCaptureSupported() == 1;
    }

    public bool SupportsCameraCapture()
    {
        EnsureMacOS();
        return NativeMethods.IsCameraCaptureSupported() == 1;
    }

    public bool SupportsAudioCapture()
    {
        EnsureMacOS();
        return NativeMethods.IsAudioCaptureSupported() == 1;
    }

    private void EnsureMacOS()
    {
        if (!IsMacOS)
        {
            throw new PlatformNotSupportedException("The iPresenterPlux macOS media bridge requires macOS.");
        }
    }

    private static class NativeMethods
    {
        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_bridge_api_version")]
        internal static extern int BridgeApiVersion();

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_is_screen_capture_supported")]
        internal static extern int IsScreenCaptureSupported();

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_is_camera_capture_supported")]
        internal static extern int IsCameraCaptureSupported();

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_is_audio_capture_supported")]
        internal static extern int IsAudioCaptureSupported();
    }
}
