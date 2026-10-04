using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Security;

namespace iPresenterPlux.Edge.Windows;

public sealed class WindowsCredentialStore : IDeviceCredentialStore, IDisposable
{
    private const uint CredentialTypeGeneric = 1;
    private const uint PersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;
    private const int MaximumGenericCredentialBlobBytes = 2560;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private bool _disposed;

    public async Task<DeviceCredential?> ReadAsync(
        Guid organizationId,
        Guid deviceId,
        CancellationToken cancellationToken)
    {
        EnsureWindows();
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var raw = ReadRaw(TargetName(organizationId, deviceId));
            if (raw is null) return null;
            try
            {
                return DeviceCredentialEnvelopeCodec.DecodeCredential(raw);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(raw);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<DeviceCredentialMetadata?> ReadMetadataAsync(
        Guid organizationId,
        Guid deviceId,
        CancellationToken cancellationToken)
    {
        EnsureWindows();
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var raw = ReadRaw(TargetName(organizationId, deviceId));
            if (raw is null) return null;
            try
            {
                return DeviceCredentialEnvelopeCodec.DecodeMetadata(raw);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(raw);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> SaveAsync(
        DeviceCredential credential,
        Guid? expectedCredentialId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(credential);
        EnsureWindows();
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var target = TargetName(
                credential.Metadata.Identity.OrganizationId,
                credential.Metadata.Identity.DeviceId);
            var existing = ReadMetadataRaw(target);
            if (!MatchesExpectation(existing, expectedCredentialId)) return false;

            var encoded = DeviceCredentialEnvelopeCodec.Encode(credential);
            try
            {
                WriteRaw(target, encoded);
                return true;
            }
            finally
            {
                CryptographicOperations.ZeroMemory(encoded);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> MarkRevokedAsync(
        DeviceCredentialMetadata revoked,
        Guid expectedCredentialId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(revoked);
        if (expectedCredentialId == Guid.Empty)
            throw new ArgumentException("Expected credential ID must be nonempty.", nameof(expectedCredentialId));
        EnsureWindows();

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            var target = TargetName(revoked.Identity.OrganizationId, revoked.Identity.DeviceId);
            var existing = ReadMetadataRaw(target);
            if (existing?.CredentialId != expectedCredentialId) return false;

            var encoded = DeviceCredentialEnvelopeCodec.EncodeRevoked(revoked);
            try
            {
                WriteRaw(target, encoded);
                return true;
            }
            finally
            {
                CryptographicOperations.ZeroMemory(encoded);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _gate.Dispose();
    }

    private static string TargetName(Guid organizationId, Guid deviceId)
    {
        if (organizationId == Guid.Empty || deviceId == Guid.Empty)
            throw new ArgumentException("Organization and device IDs must be nonempty.");
        return $"iPresenterPlux/Edge/{organizationId:N}/{deviceId:N}";
    }

    private static DeviceCredentialMetadata? ReadMetadataRaw(string target)
    {
        var raw = ReadRaw(target);
        if (raw is null) return null;
        try
        {
            return DeviceCredentialEnvelopeCodec.DecodeMetadata(raw);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(raw);
        }
    }

    private static bool MatchesExpectation(
        DeviceCredentialMetadata? existing,
        Guid? expectedCredentialId) =>
        existing is null
            ? expectedCredentialId is null
            : expectedCredentialId == existing.CredentialId;

    private static byte[]? ReadRaw(string target)
    {
        if (!NativeMethods.CredRead(target, CredentialTypeGeneric, 0, out var credentialPointer))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == ErrorNotFound) return null;
            throw new Win32Exception(error, "Windows Credential Manager read failed.");
        }

        try
        {
            var credential = Marshal.PtrToStructure<NativeCredential>(credentialPointer);
            if (credential.CredentialBlobSize == 0) return [];
            if (credential.CredentialBlob == IntPtr.Zero)
                throw new InvalidDataException("Windows Credential Manager returned an empty blob pointer.");

            var raw = new byte[checked((int)credential.CredentialBlobSize)];
            Marshal.Copy(credential.CredentialBlob, raw, 0, raw.Length);
            return raw;
        }
        finally
        {
            NativeMethods.CredFree(credentialPointer);
        }
    }

    private static void WriteRaw(string target, byte[] value)
    {
        if (value.Length == 0 || value.Length > MaximumGenericCredentialBlobBytes)
            throw new InvalidOperationException("Credential vault envelope has an invalid size.");

        var blob = Marshal.AllocHGlobal(value.Length);
        try
        {
            Marshal.Copy(value, 0, blob, value.Length);
            var credential = new NativeCredential
            {
                Flags = 0,
                Type = CredentialTypeGeneric,
                TargetName = target,
                Comment = null,
                LastWritten = default,
                CredentialBlobSize = checked((uint)value.Length),
                CredentialBlob = blob,
                Persist = PersistLocalMachine,
                AttributeCount = 0,
                Attributes = IntPtr.Zero,
                TargetAlias = null,
                UserName = Environment.UserName
            };

            if (!NativeMethods.CredWrite(ref credential, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows Credential Manager write failed.");
        }
        finally
        {
            var zeros = new byte[value.Length];
            Marshal.Copy(zeros, 0, blob, zeros.Length);
            CryptographicOperations.ZeroMemory(zeros);
            Marshal.FreeHGlobal(blob);
        }
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Windows Credential Manager requires Windows.");
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);

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

    #pragma warning disable SYSLIB1054 // CREDENTIALW uses runtime string/struct marshalling.
    private static class NativeMethods
    {
        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CredRead(
            string target,
            uint type,
            uint flags,
            out IntPtr credentialPointer);

        [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CredWrite(ref NativeCredential credential, uint flags);

        [DllImport("advapi32.dll", EntryPoint = "CredFree")]
        internal static extern void CredFree(IntPtr buffer);
    }
    #pragma warning restore SYSLIB1054
}
