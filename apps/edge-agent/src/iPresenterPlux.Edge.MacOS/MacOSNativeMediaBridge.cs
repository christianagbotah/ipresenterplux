using System.Text.Json;
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


    public IReadOnlyList<MacOSAudioInput> ListAudioInputs()
    {
        EnsureMacOS();
        var status = NativeMethods.AudioInputsJson(out var pointer, out var length);
        if (status != 0) throw new InvalidOperationException($"macOS audio input discovery failed with status {status}.");
        if (pointer == IntPtr.Zero || length <= 0)
        {
            if (pointer != IntPtr.Zero) NativeMethods.BufferFree(pointer, Math.Max(length, 0));
            return Array.Empty<MacOSAudioInput>();
        }
        try
        {
            var bytes = new byte[length];
            Marshal.Copy(pointer, bytes, 0, length);
            return JsonSerializer.Deserialize<List<MacOSAudioInput>>(bytes, new JsonSerializerOptions(JsonSerializerDefaults.Web))
                ?? Array.Empty<MacOSAudioInput>();
        }
        finally
        {
            NativeMethods.BufferFree(pointer, length);
        }
    }

    public void StartAudioCapture(string deviceId, AudioFrameCallback callback)
    {
        EnsureMacOS();
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);
        ArgumentNullException.ThrowIfNull(callback);
        var status = NativeMethods.AudioStart(deviceId, callback);
        if (status != 0) throw new InvalidOperationException($"macOS audio capture start failed with status {status}.");
    }

    public void StopAudioCapture()
    {
        EnsureMacOS();
        var status = NativeMethods.AudioStop();
        if (status != 0) throw new InvalidOperationException($"macOS audio capture stop failed with status {status}.");
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

    public sealed record MacOSAudioInput(string Id, string Name, int Channels, int SampleRate, bool IsDefault);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void AudioFrameCallback(
        IntPtr data, int length, int sampleRate, int channels, int bitsPerSample, int encoding, long capturedAtUnixMs);

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

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_audio_inputs_json", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int AudioInputsJson(out IntPtr value, out int length);

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_audio_start", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int AudioStart(
            [MarshalAs(UnmanagedType.LPUTF8Str)] string deviceId,
            AudioFrameCallback callback);

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_audio_stop", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int AudioStop();

        [DllImport(LibraryName, EntryPoint = "ipresenterplux_macos_buffer_free", CallingConvention = CallingConvention.Cdecl)]
        internal static extern void BufferFree(IntPtr value, int length);

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
