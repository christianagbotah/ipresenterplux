using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class LibSrtContributionSender : ISrtContributionSender
{
    private const string NativeLibraryName = "srt";
    private const uint MinimumRuntimeVersion = 0x010507; // 1.5.7
    private const int InvalidSocket = -1;
    private const int SrtError = -1;

    private readonly SemaphoreSlim _ioGate = new(1, 1);
    private readonly object _stateGate = new();
    private readonly TimeProvider _clock;
    private int _socket = InvalidSocket;
    private SrtPublishTarget? _target;
    private bool _runtimeAcquired;
    private bool _connected;
    private string _state = "idle";
    private string? _errorCode;
    private long _bytesSent;
    private long _droppedSends;
    private int _reconnectCount;
    private DateTimeOffset? _lastSuccessfulSendAt;
    private bool _disposed;

    static LibSrtContributionSender()
    {
        NativeLibrary.SetDllImportResolver(typeof(LibSrtContributionSender).Assembly, ResolveNativeLibrary);
    }

    public LibSrtContributionSender(TimeProvider? clock = null)
    {
        _clock = clock ?? TimeProvider.System;
    }

    public SrtContributionSenderStatus Status
    {
        get
        {
            lock (_stateGate)
            {
                return new SrtContributionSenderStatus(
                    _connected,
                    _state,
                    Interlocked.Read(ref _bytesSent),
                    Interlocked.Read(ref _droppedSends),
                    Volatile.Read(ref _reconnectCount),
                    _lastSuccessfulSendAt,
                    _errorCode);
            }
        }
    }

    public async Task<SrtContributionSenderStatus> ConnectAsync(
        Uri publishUri,
        CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var target = SrtPublishTarget.Parse(publishUri);
        await _ioGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await DisconnectCoreAsync(releaseRuntime: true).ConfigureAwait(false);
            SetState(false, "connecting", null);
            Interlocked.Exchange(ref _bytesSent, 0);
            Interlocked.Exchange(ref _droppedSends, 0);
            Volatile.Write(ref _reconnectCount, 0);

            try
            {
                LibSrtRuntime.Acquire();
                _runtimeAcquired = true;
                _target = target;
                _socket = await ConnectSocketAsync(target, cancellationToken).ConfigureAwait(false);
                SetState(true, "connected", null);
                return Status;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                await DisconnectCoreAsync(releaseRuntime: true).ConfigureAwait(false);
                throw;
            }
            catch (DllNotFoundException)
            {
                await DisconnectCoreAsync(releaseRuntime: true).ConfigureAwait(false);
                return SetFailure("transport_unavailable");
            }
            catch (EntryPointNotFoundException)
            {
                await DisconnectCoreAsync(releaseRuntime: true).ConfigureAwait(false);
                return SetFailure("transport_unavailable");
            }
            catch (NotSupportedException)
            {
                await DisconnectCoreAsync(releaseRuntime: true).ConfigureAwait(false);
                return SetFailure("transport_unavailable");
            }
            catch
            {
                await DisconnectCoreAsync(releaseRuntime: true).ConfigureAwait(false);
                return SetFailure("transport_connect_failed");
            }
        }
        finally
        {
            _ioGate.Release();
        }
    }

    public async Task SendAsync(ReadOnlyMemory<byte> payload, CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (payload.IsEmpty) return;

        await _ioGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var target = _target ?? throw new InvalidOperationException("SRT sender is not connected.");
            if (payload.Length > target.PayloadSize)
                throw new ArgumentOutOfRangeException(nameof(payload), $"SRT live payload cannot exceed {target.PayloadSize} bytes.");

            var bytes = payload.ToArray();
            for (var attempt = 0; attempt < 2; attempt++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (_socket == InvalidSocket || !_connected)
                {
                    if (attempt == 0)
                    {
                        await ReconnectAsync(target, cancellationToken).ConfigureAwait(false);
                    }
                    else
                    {
                        break;
                    }
                }

                var sent = NativeMethods.srt_send(_socket, bytes, bytes.Length);
                if (sent == bytes.Length)
                {
                    Interlocked.Add(ref _bytesSent, sent);
                    lock (_stateGate)
                    {
                        _connected = true;
                        _state = "connected";
                        _errorCode = null;
                        _lastSuccessfulSendAt = _clock.GetUtcNow();
                    }
                    return;
                }

                CloseSocket();
                if (attempt == 0)
                {
                    try
                    {
                        await ReconnectAsync(target, cancellationToken).ConfigureAwait(false);
                        continue;
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch
                    {
                        break;
                    }
                }
            }

            Interlocked.Increment(ref _droppedSends);
            SetState(false, "error", "transport_disconnected");
            throw new IOException("SRT contribution transport disconnected.");
        }
        finally
        {
            _ioGate.Release();
        }
    }

    public async Task<SrtContributionSenderStatus> DisconnectAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _ioGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await DisconnectCoreAsync(releaseRuntime: true).ConfigureAwait(false);
            SetState(false, "idle", null);
            return Status;
        }
        finally
        {
            _ioGate.Release();
        }
    }

    private async Task ReconnectAsync(SrtPublishTarget target, CancellationToken cancellationToken)
    {
        SetState(false, "reconnecting", null);
        Interlocked.Increment(ref _reconnectCount);
        CloseSocket();
        await Task.Delay(TimeSpan.FromMilliseconds(150), _clock, cancellationToken).ConfigureAwait(false);
        _socket = await ConnectSocketAsync(target, cancellationToken).ConfigureAwait(false);
        SetState(true, "connected", null);
    }

    private static async Task<int> ConnectSocketAsync(
        SrtPublishTarget target,
        CancellationToken cancellationToken)
    {
        var addresses = await Dns.GetHostAddressesAsync(target.Host, cancellationToken).ConfigureAwait(false);
        var address = addresses.FirstOrDefault(item => item.AddressFamily == AddressFamily.InterNetwork)
            ?? throw new SocketException((int)SocketError.AddressFamilyNotSupported);

        var socket = NativeMethods.srt_create_socket();
        if (socket == SrtError) throw new IOException("Could not create SRT socket.");

        try
        {
            SetIntOption(socket, SrtSocketOption.TransType, 0); // SRTT_LIVE
            SetIntOption(socket, SrtSocketOption.PayloadSize, target.PayloadSize);
            SetIntOption(socket, SrtSocketOption.ConnectTimeout, 4_000);
            SetIntOption(socket, SrtSocketOption.SendTimeout, 3_000);
            SetStringOption(socket, SrtSocketOption.StreamId, target.StreamId);

            var socketAddress = BuildIpv4SocketAddress(address, target.Port);
            var connectTask = Task.Run(
                () => NativeMethods.srt_connect(socket, socketAddress, socketAddress.Length),
                CancellationToken.None);
            int result;
            try
            {
                result = await connectTask.WaitAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                NativeMethods.srt_close(socket);
                throw;
            }
            if (result == SrtError) throw new IOException("SRT connection failed.");
            return socket;
        }
        catch
        {
            NativeMethods.srt_close(socket);
            throw;
        }
    }

    private static byte[] BuildIpv4SocketAddress(IPAddress address, int port)
    {
        if (address.AddressFamily != AddressFamily.InterNetwork)
            throw new ArgumentException("Only IPv4 SRT contribution targets are currently supported.", nameof(address));
        if (port is <= 0 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));

        var result = new byte[16];
        if (OperatingSystem.IsMacOS())
        {
            result[0] = 16; // sockaddr length on Darwin/BSD.
            result[1] = 2;  // AF_INET.
        }
        else if (BitConverter.IsLittleEndian)
        {
            result[0] = 2;
            result[1] = 0;
        }
        else
        {
            result[0] = 0;
            result[1] = 2;
        }
        result[2] = (byte)(port >> 8);
        result[3] = (byte)port;
        address.GetAddressBytes().CopyTo(result, 4);
        return result;
    }

    private static void SetIntOption(int socket, SrtSocketOption option, int value)
    {
        var pointer = Marshal.AllocHGlobal(sizeof(int));
        try
        {
            Marshal.WriteInt32(pointer, value);
            if (NativeMethods.srt_setsockflag(socket, (int)option, pointer, sizeof(int)) == SrtError)
                throw new IOException("Could not configure SRT socket.");
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    private static void SetStringOption(int socket, SrtSocketOption option, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        if (bytes.Length == 0 || bytes.Length > 512)
            throw new ArgumentOutOfRangeException(nameof(value));
        var pointer = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            if (NativeMethods.srt_setsockflag(socket, (int)option, pointer, bytes.Length) == SrtError)
                throw new IOException("Could not configure SRT socket.");
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    private async Task DisconnectCoreAsync(bool releaseRuntime)
    {
        CloseSocket();
        _target = null;
        if (releaseRuntime && _runtimeAcquired)
        {
            LibSrtRuntime.Release();
            _runtimeAcquired = false;
        }
        await Task.CompletedTask;
    }

    private void CloseSocket()
    {
        var socket = Interlocked.Exchange(ref _socket, InvalidSocket);
        if (socket != InvalidSocket)
        {
            try { NativeMethods.srt_close(socket); } catch { }
        }
        lock (_stateGate) _connected = false;
    }

    private SrtContributionSenderStatus SetFailure(string errorCode)
    {
        SetState(false, "error", errorCode);
        return Status;
    }

    private void SetState(bool connected, string state, string? errorCode)
    {
        lock (_stateGate)
        {
            _connected = connected;
            _state = state;
            _errorCode = errorCode;
            if (!connected && state == "idle") _lastSuccessfulSendAt = null;
        }
    }

    private static IntPtr ResolveNativeLibrary(
        string libraryName,
        Assembly assembly,
        DllImportSearchPath? searchPath)
    {
        if (!string.Equals(libraryName, NativeLibraryName, StringComparison.Ordinal))
            return IntPtr.Zero;

        var fileName = OperatingSystem.IsWindows()
            ? "srt.dll"
            : OperatingSystem.IsMacOS()
                ? "libsrt.dylib"
                : "libsrt.so";
        var bundled = Path.Combine(AppContext.BaseDirectory, "libSrt", fileName);
        if (File.Exists(bundled) && NativeLibrary.TryLoad(bundled, out var handle)) return handle;
        return IntPtr.Zero;
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        await _ioGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            await DisconnectCoreAsync(releaseRuntime: true).ConfigureAwait(false);
            SetState(false, "idle", null);
            _disposed = true;
        }
        finally
        {
            _ioGate.Release();
            _ioGate.Dispose();
        }
    }

    private enum SrtSocketOption
    {
        SendTimeout = 13,
        ConnectTimeout = 36,
        StreamId = 46,
        PayloadSize = 49,
        TransType = 50
    }

    private static class LibSrtRuntime
    {
        private static readonly object Gate = new();
        private static int _references;

        public static void Acquire()
        {
            lock (Gate)
            {
                if (_references == 0)
                {
                    if (NativeMethods.srt_startup() == SrtError)
                        throw new IOException("Could not initialize SRT runtime.");
                    var version = NativeMethods.srt_getversion();
                    if (version < MinimumRuntimeVersion)
                    {
                        NativeMethods.srt_cleanup();
                        throw new NotSupportedException("Bundled SRT runtime is below the required security version.");
                    }
                }
                _references++;
            }
        }

        public static void Release()
        {
            lock (Gate)
            {
                if (_references <= 0) return;
                _references--;
                if (_references == 0)
                {
                    try { NativeMethods.srt_cleanup(); } catch { }
                }
            }
        }
    }

    private static class NativeMethods
    {
        [DllImport(NativeLibraryName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int srt_startup();

        [DllImport(NativeLibraryName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int srt_cleanup();

        [DllImport(NativeLibraryName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern uint srt_getversion();

        [DllImport(NativeLibraryName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int srt_create_socket();

        [DllImport(NativeLibraryName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int srt_setsockflag(int socket, int option, IntPtr value, int length);

        [DllImport(NativeLibraryName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int srt_connect(int socket, [In] byte[] name, int nameLength);

        [DllImport(NativeLibraryName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int srt_send(int socket, [In] byte[] buffer, int length);

        [DllImport(NativeLibraryName, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int srt_close(int socket);
    }
}
