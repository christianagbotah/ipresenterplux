using System.Runtime.InteropServices;
using iPresenterPlux.Edge.Core.Models;
using WinRT;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using global::Windows.Win32.Graphics.Direct3D11;

namespace iPresenterPlux.Edge.Windows;

internal sealed class WindowsGraphicsNativeFramePool : IWindowsGraphicsNativeFramePool
{
    private const int EAccessDenied = unchecked((int)0x80070005);
    private const int EInvalidArg = unchecked((int)0x80070057);
    private const int InvalidWindowHandle = unchecked((int)0x80070578);
    private const int DxgiDeviceRemoved = unchecked((int)0x887A0005);
    private const int DxgiDeviceReset = unchecked((int)0x887A0007);

    private readonly TimeProvider _clock;
    private readonly object _gate = new();
    private WindowsDirect3DDevice? _device;
    private GraphicsCaptureItem? _item;
    private Direct3D11CaptureFramePool? _framePool;
    private GraphicsCaptureSession? _session;
    private bool _running;
    private bool _disposed;

    public WindowsGraphicsNativeFramePool(TimeProvider? clock = null)
    {
        _clock = clock ?? TimeProvider.System;
    }

    public event EventHandler? FrameArrived;
    public event EventHandler? Closed;
    public event EventHandler<WindowsGraphicsCaptureException>? Faulted;

    public Task StartAsync(VisualSourceDescriptor source, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(source);
        EnsureWindows();
        ObjectDisposedException.ThrowIf(_disposed, this);

        lock (_gate)
        {
            if (_running) return Task.CompletedTask;
            if (!GraphicsCaptureSession.IsSupported())
                throw new WindowsGraphicsCaptureException(
                    WindowsGraphicsCaptureFailureKind.Unsupported,
                    "Windows Graphics Capture is not supported on this system.");

            try
            {
                var item = source.Kind switch
                {
                    VisualSourceKind.Window => GraphicsCaptureItemFactory.ForWindow(ParseWindowHandle(source)),
                    VisualSourceKind.Display => GraphicsCaptureItemFactory.ForMonitor(ParseMonitorHandle(source)),
                    _ => throw new WindowsGraphicsCaptureException(
                        WindowsGraphicsCaptureFailureKind.Unsupported,
                        "Windows Graphics Capture requires a display or window source.")
                };
                var size = item.Size;
                if (size.Width <= 0 || size.Height <= 0)
                {
                    throw new WindowsGraphicsCaptureException(
                        WindowsGraphicsCaptureFailureKind.Disconnected,
                        "The display or window has no capturable surface.");
                }

                var device = Direct3DDeviceFactory.Create();
                Direct3D11CaptureFramePool? pool = null;
                GraphicsCaptureSession? session = null;
                try
                {
                    pool = Direct3D11CaptureFramePool.CreateFreeThreaded(
                        device.WinRtDevice,
                        DirectXPixelFormat.B8G8R8A8UIntNormalized,
                        2,
                        size);
                    session = pool.CreateCaptureSession(item);
                    pool.FrameArrived += OnNativeFrameArrived;
                    item.Closed += OnItemClosed;
                    session.StartCapture();

                    _device = device;
                    _item = item;
                    _framePool = pool;
                    _session = session;
                    _running = true;
                    device = null!;
                    item = null!;
                    pool = null;
                    session = null;
                }
                finally
                {
                    session?.Dispose();
                    pool?.Dispose();
                    device?.Dispose();
                }
            }
            catch (WindowsGraphicsCaptureException)
            {
                throw;
            }
            catch (Exception error)
            {
                throw MapNativeFailure(error);
            }
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            if (_disposed || !_running) return Task.CompletedTask;
            StopCore();
        }
        return Task.CompletedTask;
    }

    public IWindowsGraphicsNativeFrame? TryGetNextFrame()
    {
        lock (_gate)
        {
            if (_disposed || !_running || _framePool is null || _device is null) return null;
            try
            {
                var frame = _framePool.TryGetNextFrame();
                return frame is null ? null : new WindowsGraphicsNativeFrame(frame, _device, _clock);
            }
            catch (Exception error)
            {
                throw MapNativeFailure(error);
            }
        }
    }

    public void Recreate(int width, int height)
    {
        if (width <= 0 || height <= 0) return;
        lock (_gate)
        {
            if (_disposed || !_running || _framePool is null || _device is null) return;
            try
            {
                _framePool.Recreate(
                    _device.WinRtDevice,
                    DirectXPixelFormat.B8G8R8A8UIntNormalized,
                    2,
                    new SizeInt32 { Width = width, Height = height });
            }
            catch (Exception error)
            {
                var mapped = MapNativeFailure(error);
                try { Faulted?.Invoke(this, mapped); } catch { }
            }
        }
    }

    public ValueTask DisposeAsync()
    {
        lock (_gate)
        {
            if (_disposed) return ValueTask.CompletedTask;
            StopCore();
            _disposed = true;
        }
        return ValueTask.CompletedTask;
    }

    internal static WindowsGraphicsCaptureException MapNativeFailure(Exception error)
    {
        if (error is WindowsGraphicsCaptureException known) return known;
        if (error is UnauthorizedAccessException || error.HResult == EAccessDenied)
            return new WindowsGraphicsCaptureException(
                WindowsGraphicsCaptureFailureKind.Permission,
                "Windows screen capture permission was denied.",
                error);
        if (error.HResult is EInvalidArg or InvalidWindowHandle)
            return new WindowsGraphicsCaptureException(
                WindowsGraphicsCaptureFailureKind.Disconnected,
                "The selected display or window is no longer available.",
                error);
        if (error.HResult is DxgiDeviceRemoved or DxgiDeviceReset)
            return new WindowsGraphicsCaptureException(
                WindowsGraphicsCaptureFailureKind.Disconnected,
                "The graphics device or captured display was removed.",
                error);
        if (error is PlatformNotSupportedException or NotSupportedException)
            return new WindowsGraphicsCaptureException(
                WindowsGraphicsCaptureFailureKind.Unsupported,
                "Windows Graphics Capture is unsupported.",
                error);
        return new WindowsGraphicsCaptureException(
            WindowsGraphicsCaptureFailureKind.Capture,
            "Windows Graphics Capture failed.",
            error);
    }

    private void OnNativeFrameArrived(Direct3D11CaptureFramePool sender, object args)
    {
        if (_disposed || !_running) return;
        try { FrameArrived?.Invoke(this, EventArgs.Empty); } catch { }
    }

    private void OnItemClosed(GraphicsCaptureItem sender, object args)
    {
        if (_disposed || !_running) return;
        try { Closed?.Invoke(this, EventArgs.Empty); } catch { }
    }

    private void StopCore()
    {
        _running = false;
        var pool = _framePool;
        var item = _item;
        var session = _session;
        var device = _device;
        _framePool = null;
        _item = null;
        _session = null;
        _device = null;

        if (pool is not null) pool.FrameArrived -= OnNativeFrameArrived;
        if (item is not null) item.Closed -= OnItemClosed;
        try { session?.Dispose(); } catch { }
        try { pool?.Dispose(); } catch { }
        try { device?.Dispose(); } catch { }
    }

    private static nint ParseWindowHandle(VisualSourceDescriptor source)
    {
        var marker = source.NativeKey.LastIndexOf("|hwnd:", StringComparison.Ordinal);
        if (marker < 0) throw new WindowsGraphicsCaptureException(
            WindowsGraphicsCaptureFailureKind.Disconnected,
            "The window source no longer has a valid session handle.");
        var token = source.NativeKey[(marker + 6)..];
        if (!long.TryParse(token, System.Globalization.NumberStyles.HexNumber,
                System.Globalization.CultureInfo.InvariantCulture, out var value) || value == 0)
            throw new WindowsGraphicsCaptureException(
                WindowsGraphicsCaptureFailureKind.Disconnected,
                "The window source no longer has a valid session handle.");
        return (nint)value;
    }

    private static nint ParseMonitorHandle(VisualSourceDescriptor source)
    {
        if (!source.Metadata.TryGetValue("nativeMonitorHandle", out var token) ||
            !long.TryParse(token, System.Globalization.NumberStyles.HexNumber,
                System.Globalization.CultureInfo.InvariantCulture, out var value) ||
            value == 0)
            throw new WindowsGraphicsCaptureException(
                WindowsGraphicsCaptureFailureKind.Disconnected,
                "The display source no longer has a valid session handle.");
        return (nint)value;
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Windows Graphics Capture requires Windows.");
    }
}

internal sealed class WindowsGraphicsNativeFrame : IWindowsGraphicsNativeFrame
{
    private static readonly Guid DxgiAccessId = new("A9B3D012-3DF8-4B0A-B8F4-6E8A2B32F89C");
    private static readonly Guid Texture2DId = new("6F15AAF2-D208-4E89-9AB4-489535D34F9C");

    private readonly Direct3D11CaptureFrame _frame;
    private readonly WindowsDirect3DDevice _device;
    private readonly TimeProvider _clock;
    private bool _disposed;

    public WindowsGraphicsNativeFrame(Direct3D11CaptureFrame frame, WindowsDirect3DDevice device, TimeProvider clock)
    {
        _frame = frame ?? throw new ArgumentNullException(nameof(frame));
        _device = device ?? throw new ArgumentNullException(nameof(device));
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        Width = frame.ContentSize.Width;
        Height = frame.ContentSize.Height;
    }

    public int Width { get; }
    public int Height { get; }

    public WindowsGraphicsFrame ReadBgra32()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (Width <= 0 || Height <= 0)
            throw new WindowsGraphicsCaptureException(
                WindowsGraphicsCaptureFailureKind.Disconnected,
                "The captured surface has no drawable content.");

        ID3D11Texture2D? texture = null;
        ID3D11Texture2D? staging = null;
        try
        {
            texture = GetTexture(_frame.Surface);
            unsafe
            {
                D3D11_TEXTURE2D_DESC sourceDesc;
                texture.GetDesc(&sourceDesc);
                var stagingDesc = sourceDesc;
                stagingDesc.Usage = D3D11_USAGE.D3D11_USAGE_STAGING;
                stagingDesc.BindFlags = 0;
                stagingDesc.CPUAccessFlags = D3D11_CPU_ACCESS_FLAG.D3D11_CPU_ACCESS_READ;
                stagingDesc.MiscFlags = 0;
                stagingDesc.MipLevels = 1;
                stagingDesc.ArraySize = 1;
                global::Windows.Win32.Graphics_Direct3D11_ID3D11Device_Extensions.CreateTexture2D(
                    _device.NativeDevice, in stagingDesc, null, out var created);
                staging = created;
            }

            var stagingResource = (ID3D11Resource)staging!;
            var sourceResource = (ID3D11Resource)texture!;
            _device.Context.CopyResource(stagingResource, sourceResource);
            global::Windows.Win32.Graphics_Direct3D11_ID3D11DeviceContext_Extensions.Map(
                _device.Context, stagingResource, 0, D3D11_MAP.D3D11_MAP_READ, 0, out var mapped);
            try
            {
                var stride = checked(Width * 4);
                var pixels = GC.AllocateUninitializedArray<byte>(checked(stride * Height));
                unsafe
                {
                    var source = (byte*)mapped.pData;
                    for (var row = 0; row < Height; row++)
                    {
                        Marshal.Copy((nint)(source + checked((nuint)row * mapped.RowPitch)), pixels, row * stride, stride);
                    }
                }
                for (var alpha = 3; alpha < pixels.Length; alpha += 4) pixels[alpha] = byte.MaxValue;
                return new WindowsGraphicsFrame(Width, Height, stride, pixels, _clock.GetUtcNow());
            }
            finally
            {
                _device.Context.Unmap(stagingResource, 0);
            }
        }
        catch (WindowsGraphicsCaptureException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw WindowsGraphicsNativeFramePool.MapNativeFailure(error);
        }
        finally
        {
            WindowsDirect3DDevice.ReleaseCom(staging);
            WindowsDirect3DDevice.ReleaseCom(texture);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _frame.Dispose();
    }

    private static ID3D11Texture2D GetTexture(IDirect3DSurface surface)
    {
        var surfaceAbi = MarshalInspectable<IDirect3DSurface>.FromManaged(surface);
        var access = nint.Zero;
        var texture = nint.Zero;
        try
        {
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(surfaceAbi, in DxgiAccessId, out access));
            var vtable = Marshal.ReadIntPtr(access);
            var method = Marshal.ReadIntPtr(vtable, 3 * IntPtr.Size);
            var getInterface = Marshal.GetDelegateForFunctionPointer<GetInterfaceDelegate>(method);
            Marshal.ThrowExceptionForHR(getInterface(access, in Texture2DId, out texture));
            return (ID3D11Texture2D)Marshal.GetObjectForIUnknown(texture);
        }
        finally
        {
            if (texture != nint.Zero) Marshal.Release(texture);
            if (access != nint.Zero) Marshal.Release(access);
            MarshalInspectable<IDirect3DSurface>.DisposeAbi(surfaceAbi);
        }
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetInterfaceDelegate(nint @this, in Guid iid, out nint result);
}
