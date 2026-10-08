using System.ComponentModel;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Desktop;

public interface IProtectedEntitlementVault
{
    Task<byte[]?> ReadAsync(CancellationToken cancellationToken);
    Task WriteAsync(byte[] value, CancellationToken cancellationToken);
    Task DeleteAsync(CancellationToken cancellationToken);
}

public sealed class DesktopEntitlementStore : IEntitlementStore
{
    private static readonly byte[] Magic = "IPLXENT1"u8.ToArray();
    private readonly IProtectedEntitlementVault _vault;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public DesktopEntitlementStore(IProtectedEntitlementVault vault) =>
        _vault = vault ?? throw new ArgumentNullException(nameof(vault));

    public static DesktopEntitlementStore CreateDefault() =>
        new(OperatingSystem.IsWindows()
            ? new WindowsCredentialManagerEntitlementVault()
            : OperatingSystem.IsMacOS()
                ? new MacOSKeychainEntitlementVault()
                : throw new PlatformNotSupportedException("Entitlement storage requires Windows Credential Manager or macOS Keychain."));

    public async Task<DesktopEntitlementCache?> ReadAsync(CancellationToken cancellationToken)
    {
        var protectedBytes = await _vault.ReadAsync(cancellationToken).ConfigureAwait(false);
        if (protectedBytes is null) return null;
        try
        {
            return Decode(protectedBytes);
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception error) when (error is FormatException or JsonException or CryptographicException)
        {
            throw new InvalidDataException("Stored entitlement cache is invalid or corrupted.", error);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(protectedBytes);
        }
    }

    public async Task SaveAsync(DesktopEntitlementCache cache, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(cache);
        Validate(cache);
        var packed = Encode(cache);
        try
        {
            await _vault.WriteAsync(packed, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(packed);
        }
    }

    public Task ClearAsync(CancellationToken cancellationToken) => _vault.DeleteAsync(cancellationToken);

    private static byte[] Encode(DesktopEntitlementCache cache)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(cache, JsonOptions);
        var digest = SHA256.HashData(payload);
        var frame = new byte[Magic.Length + digest.Length + payload.Length];
        Magic.CopyTo(frame, 0);
        digest.CopyTo(frame, Magic.Length);
        payload.CopyTo(frame, Magic.Length + digest.Length);

        try
        {
            using var output = new MemoryStream();
            using (var brotli = new BrotliStream(output, CompressionLevel.SmallestSize, leaveOpen: true))
                brotli.Write(frame, 0, frame.Length);
            return Encoding.ASCII.GetBytes(Convert.ToBase64String(output.ToArray()));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(payload);
            CryptographicOperations.ZeroMemory(digest);
            CryptographicOperations.ZeroMemory(frame);
        }
    }

    private static DesktopEntitlementCache Decode(byte[] protectedBytes)
    {
        byte[] compressed;
        try
        {
            compressed = Convert.FromBase64String(Encoding.ASCII.GetString(protectedBytes));
        }
        catch (FormatException error)
        {
            throw new InvalidDataException("Stored entitlement cache has an invalid envelope.", error);
        }

        byte[] frame;
        try
        {
            using var source = new MemoryStream(compressed, writable: false);
            using var brotli = new BrotliStream(source, CompressionMode.Decompress);
            using var output = new MemoryStream();
            brotli.CopyTo(output);
            if (output.Length > 64 * 1024) throw new InvalidDataException("Stored entitlement cache is unexpectedly large.");
            frame = output.ToArray();
        }
        catch (InvalidDataException)
        {
            throw;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(compressed);
        }

        try
        {
            if (frame.Length <= Magic.Length + 32 || !frame.AsSpan(0, Magic.Length).SequenceEqual(Magic))
                throw new InvalidDataException("Stored entitlement cache has an invalid header.");

            var expectedDigest = frame.AsSpan(Magic.Length, 32);
            var payload = frame.AsSpan(Magic.Length + 32);
            var actualDigest = SHA256.HashData(payload);
            try
            {
                if (!CryptographicOperations.FixedTimeEquals(expectedDigest, actualDigest))
                    throw new InvalidDataException("Stored entitlement cache failed integrity validation.");
            }
            finally
            {
                CryptographicOperations.ZeroMemory(actualDigest);
            }

            var cache = JsonSerializer.Deserialize<DesktopEntitlementCache>(payload, JsonOptions)
                ?? throw new InvalidDataException("Stored entitlement cache is empty.");
            Validate(cache);
            return cache;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(frame);
        }
    }

    private static void Validate(DesktopEntitlementCache cache)
    {
        if (!Guid.TryParse(cache.ActivationId, out var activationId) || activationId == Guid.Empty ||
            string.IsNullOrWhiteSpace(cache.InstallationId) || cache.InstallationId.Length > 200 ||
            string.IsNullOrWhiteSpace(cache.ActivationToken) || cache.ActivationToken.Length > 512 ||
            string.IsNullOrWhiteSpace(cache.Envelope) || cache.Envelope.Length > 32_768 ||
            cache.LastTrustedNow == default)
        {
            throw new InvalidDataException("Stored entitlement cache contains invalid fields.");
        }
    }
}

internal sealed class WindowsCredentialManagerEntitlementVault : IProtectedEntitlementVault
{
    private const uint CredentialTypeGeneric = 1;
    private const uint PersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;
    private const int MaximumCredentialBlobBytes = 2560;
    private const string Target = "iPresenterPlux/Edge/Entitlement";

    public Task<byte[]?> ReadAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureWindows();
        return Task.FromResult(ReadRaw());
    }

    public Task WriteAsync(byte[] value, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(value);
        EnsureWindows();
        if (value.Length == 0 || value.Length > MaximumCredentialBlobBytes)
            throw new InvalidOperationException("Protected entitlement is too large for Windows Credential Manager.");

        var blob = Marshal.AllocHGlobal(value.Length);
        try
        {
            Marshal.Copy(value, 0, blob, value.Length);
            var credential = new NativeCredential
            {
                Type = CredentialTypeGeneric,
                TargetName = Target,
                CredentialBlobSize = checked((uint)value.Length),
                CredentialBlob = blob,
                Persist = PersistLocalMachine,
                UserName = Environment.UserName
            };
            if (!NativeMethods.CredWrite(ref credential, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows Credential Manager write failed.");
        }
        finally
        {
            Marshal.FreeHGlobal(blob);
        }
        return Task.CompletedTask;
    }

    public Task DeleteAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureWindows();
        if (!NativeMethods.CredDelete(Target, CredentialTypeGeneric, 0))
        {
            var error = Marshal.GetLastWin32Error();
            if (error != ErrorNotFound) throw new Win32Exception(error, "Windows Credential Manager delete failed.");
        }
        return Task.CompletedTask;
    }

    private static byte[]? ReadRaw()
    {
        if (!NativeMethods.CredRead(Target, CredentialTypeGeneric, 0, out var pointer))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == ErrorNotFound) return null;
            throw new Win32Exception(error, "Windows Credential Manager read failed.");
        }
        try
        {
            var credential = Marshal.PtrToStructure<NativeCredential>(pointer);
            if (credential.CredentialBlobSize == 0 || credential.CredentialBlob == IntPtr.Zero)
                throw new InvalidDataException("Windows Credential Manager returned an empty entitlement.");
            var raw = new byte[checked((int)credential.CredentialBlobSize)];
            Marshal.Copy(credential.CredentialBlob, raw, 0, raw.Length);
            return raw;
        }
        finally
        {
            NativeMethods.CredFree(pointer);
        }
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeCredential
    {
        public uint Flags;
        public uint Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string? TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string? TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string? UserName;
    }

    private static class NativeMethods
    {
        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

        [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CredWrite(ref NativeCredential credential, uint flags);

        [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CredDelete(string target, uint type, uint flags);

        [DllImport("advapi32.dll")]
        internal static extern void CredFree(IntPtr credential);
    }
}

internal sealed class MacOSKeychainEntitlementVault : IProtectedEntitlementVault
{
    private const string Service = "com.lightworldtech.ipresenterplux.edge.entitlement";
    private const string Account = "active";
    private const int Success = 0;
    private const int ItemNotFound = -25300;

    public Task<byte[]?> ReadAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureMacOS();
        var service = Encoding.UTF8.GetBytes(Service);
        var account = Encoding.UTF8.GetBytes(Account);
        var status = NativeMethods.SecKeychainFindGenericPassword(
            IntPtr.Zero,
            checked((uint)service.Length), service,
            checked((uint)account.Length), account,
            out var length, out var data, out var item);
        if (status == ItemNotFound) return Task.FromResult<byte[]?>(null);
        ThrowStatus(status, "read");
        try
        {
            var value = new byte[checked((int)length)];
            Marshal.Copy(data, value, 0, value.Length);
            return Task.FromResult<byte[]?>(value);
        }
        finally
        {
            if (data != IntPtr.Zero) NativeMethods.SecKeychainItemFreeContent(IntPtr.Zero, data);
            if (item != IntPtr.Zero) NativeMethods.CFRelease(item);
        }
    }

    public Task WriteAsync(byte[] value, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(value);
        EnsureMacOS();
        var service = Encoding.UTF8.GetBytes(Service);
        var account = Encoding.UTF8.GetBytes(Account);
        var status = NativeMethods.SecKeychainFindGenericPassword(
            IntPtr.Zero,
            checked((uint)service.Length), service,
            checked((uint)account.Length), account,
            out var existingLength, out var existingData, out var item);
        if (status == Success)
        {
            try
            {
                ThrowStatus(NativeMethods.SecKeychainItemModifyAttributesAndData(item, IntPtr.Zero, checked((uint)value.Length), value), "write");
            }
            finally
            {
                if (existingData != IntPtr.Zero) NativeMethods.SecKeychainItemFreeContent(IntPtr.Zero, existingData);
                if (item != IntPtr.Zero) NativeMethods.CFRelease(item);
            }
            return Task.CompletedTask;
        }
        if (status != ItemNotFound) ThrowStatus(status, "lookup");

        ThrowStatus(NativeMethods.SecKeychainAddGenericPassword(
            IntPtr.Zero,
            checked((uint)service.Length), service,
            checked((uint)account.Length), account,
            checked((uint)value.Length), value,
            out var addedItem), "write");
        if (addedItem != IntPtr.Zero) NativeMethods.CFRelease(addedItem);
        return Task.CompletedTask;
    }

    public Task DeleteAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureMacOS();
        var service = Encoding.UTF8.GetBytes(Service);
        var account = Encoding.UTF8.GetBytes(Account);
        var status = NativeMethods.SecKeychainFindGenericPassword(
            IntPtr.Zero,
            checked((uint)service.Length), service,
            checked((uint)account.Length), account,
            out var length, out var data, out var item);
        if (status == ItemNotFound) return Task.CompletedTask;
        ThrowStatus(status, "lookup");
        try
        {
            ThrowStatus(NativeMethods.SecKeychainItemDelete(item), "delete");
        }
        finally
        {
            if (data != IntPtr.Zero) NativeMethods.SecKeychainItemFreeContent(IntPtr.Zero, data);
            if (item != IntPtr.Zero) NativeMethods.CFRelease(item);
        }
        return Task.CompletedTask;
    }

    private static void EnsureMacOS()
    {
        if (!OperatingSystem.IsMacOS()) throw new PlatformNotSupportedException();
    }

    private static void ThrowStatus(int status, string operation)
    {
        if (status != Success) throw new InvalidOperationException($"macOS Keychain entitlement {operation} failed with OSStatus {status}.");
    }

    private static class NativeMethods
    {
        private const string Security = "/System/Library/Frameworks/Security.framework/Security";
        private const string CoreFoundation = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";

        [DllImport(Security)]
        internal static extern int SecKeychainFindGenericPassword(
            IntPtr keychainOrArray,
            uint serviceNameLength, byte[] serviceName,
            uint accountNameLength, byte[] accountName,
            out uint passwordLength, out IntPtr passwordData,
            out IntPtr itemRef);

        [DllImport(Security)]
        internal static extern int SecKeychainAddGenericPassword(
            IntPtr keychain,
            uint serviceNameLength, byte[] serviceName,
            uint accountNameLength, byte[] accountName,
            uint passwordLength, byte[] passwordData,
            out IntPtr itemRef);

        [DllImport(Security)]
        internal static extern int SecKeychainItemModifyAttributesAndData(
            IntPtr itemRef, IntPtr attrList, uint length, byte[] data);

        [DllImport(Security)]
        internal static extern int SecKeychainItemFreeContent(IntPtr attrList, IntPtr data);

        [DllImport(Security)]
        internal static extern int SecKeychainItemDelete(IntPtr itemRef);

        [DllImport(CoreFoundation)]
        internal static extern void CFRelease(IntPtr value);
    }
}
