using System.Runtime.InteropServices;

namespace iPresenterPlux.Edge.MacOS;

public sealed class MacOSNativeMediaBridge
{
    private const string LibraryName = "iPresenterPluxMediaBridge";
    private const int SecuritySuccess = 0;
    private const int SecurityItemNotFound = -25300;

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

    public void WriteKeychainItem(string service, string account, byte[] value)
    {
        EnsureMacOS();
        ArgumentException.ThrowIfNullOrWhiteSpace(service);
        ArgumentException.ThrowIfNullOrWhiteSpace(account);
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length == 0) throw new ArgumentException("Keychain value must not be empty.", nameof(value));

        var status = NativeMethods.KeychainWrite(service, account, value, value.Length);
        ThrowForSecurityStatus(status, "write");
    }

    public byte[]? ReadKeychainItem(string service, string account)
    {
        EnsureMacOS();
        ArgumentException.ThrowIfNullOrWhiteSpace(service);
        ArgumentException.ThrowIfNullOrWhiteSpace(account);

        var status = NativeMethods.KeychainRead(service, account, out var pointer, out var length);
        if (status == SecurityItemNotFound) return null;
        ThrowForSecurityStatus(status, "read");

        if (pointer == IntPtr.Zero || length <= 0)
        {
            if (pointer != IntPtr.Zero) NativeMethods.KeychainFree(pointer, Math.Max(length, 0));
            throw new InvalidDataException("macOS Keychain returned an empty credential buffer.");
        }

        try
        {
            var value = new byte[length];
            Marshal.Copy(pointer, value, 0, length);
            return value;
        }
        finally
        {
            NativeMethods.KeychainFree(pointer, length);
        }
    }

    public bool DeleteKeychainItem(string service, string account)
    {
        EnsureMacOS();
        ArgumentException.ThrowIfNullOrWhiteSpace(service);
        ArgumentException.ThrowIfNullOrWhiteSpace(account);

        var status = NativeMethods.KeychainDelete(service, account);
        if (status == SecurityItemNotFound) return false;
        ThrowForSecurityStatus(status, "delete");
        return true;
    }

    private static void ThrowForSecurityStatus(int status, string operation)
    {
        if (status != SecuritySuccess)
            throw new InvalidOperationException($"macOS Keychain {operation} failed with OSStatus {status}.");
    }

    private void EnsureMacOS()
    {
        if (!IsMacOS)
        {
            throw new PlatformNotSupportedException("The iPresenterPlux macOS native bridge requires macOS.");
        }
    }

    #pragma warning disable SYSLIB1054 // Swift bridge uses a stable C ABI with UTF-8/native buffers.
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

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_keychain_write", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int KeychainWrite(
            [MarshalAs(UnmanagedType.LPUTF8Str)] string service,
            [MarshalAs(UnmanagedType.LPUTF8Str)] string account,
            byte[] value,
            int length);

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_keychain_read", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int KeychainRead(
            [MarshalAs(UnmanagedType.LPUTF8Str)] string service,
            [MarshalAs(UnmanagedType.LPUTF8Str)] string account,
            out IntPtr value,
            out int length);

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_keychain_delete", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int KeychainDelete(
            [MarshalAs(UnmanagedType.LPUTF8Str)] string service,
            [MarshalAs(UnmanagedType.LPUTF8Str)] string account);

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_keychain_free", CallingConvention = CallingConvention.Cdecl)]
        internal static extern void KeychainFree(IntPtr value, int length);
    }
    #pragma warning restore SYSLIB1054
}
