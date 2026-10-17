using System.Runtime.InteropServices;
using WinRT;
using Windows.Graphics.DirectX.Direct3D11;
using global::Windows.Win32;
using global::Windows.Win32.Graphics.Direct3D;
using global::Windows.Win32.Graphics.Direct3D11;

namespace iPresenterPlux.Edge.Windows;

internal sealed class WindowsDirect3DDevice : IDisposable
{
    public WindowsDirect3DDevice(ID3D11Device nativeDevice, ID3D11DeviceContext context, IDirect3DDevice winRtDevice)
    {
        NativeDevice = nativeDevice;
        Context = context;
        WinRtDevice = winRtDevice;
    }

    public ID3D11Device NativeDevice { get; }
    public ID3D11DeviceContext Context { get; }
    public IDirect3DDevice WinRtDevice { get; }

    public void Dispose()
    {
        (WinRtDevice as IDisposable)?.Dispose();
        ReleaseCom(Context);
        ReleaseCom(NativeDevice);
    }

    internal static void ReleaseCom(object? value)
    {
        if (value is null || !Marshal.IsComObject(value)) return;
        try { Marshal.FinalReleaseComObject(value); } catch { }
    }
}

internal static class Direct3DDeviceFactory
{
    public static WindowsDirect3DDevice Create()
    {
        var flags = D3D11_CREATE_DEVICE_FLAG.D3D11_CREATE_DEVICE_BGRA_SUPPORT;
        PInvoke.D3D11CreateDevice(
            null,
            D3D_DRIVER_TYPE.D3D_DRIVER_TYPE_HARDWARE,
            default,
            flags,
            ReadOnlySpan<D3D_FEATURE_LEVEL>.Empty,
            PInvoke.D3D11_SDK_VERSION,
            out var nativeDevice,
            out _,
            out var context).ThrowOnFailure();

        try
        {
            var unknown = Marshal.GetIUnknownForObject(nativeDevice);
            var dxgi = nint.Zero;
            try
            {
                var iid = new Guid("54EC77FA-1377-44E6-8C32-88FD5F44C84C");
                Marshal.ThrowExceptionForHR(Marshal.QueryInterface(unknown, in iid, out dxgi));
                Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out var inspectable));
                try
                {
                    var winRt = MarshalInspectable<IDirect3DDevice>.FromAbi(inspectable);
                    return new WindowsDirect3DDevice(nativeDevice, context, winRt);
                }
                finally
                {
                    MarshalInspectable<IDirect3DDevice>.DisposeAbi(inspectable);
                }
            }
            finally
            {
                if (dxgi != nint.Zero) Marshal.Release(dxgi);
                Marshal.Release(unknown);
            }
        }
        catch
        {
            WindowsDirect3DDevice.ReleaseCom(context);
            WindowsDirect3DDevice.ReleaseCom(nativeDevice);
            throw;
        }
    }

    [DllImport("d3d11.dll", ExactSpelling = true)]
    private static extern int CreateDirect3D11DeviceFromDXGIDevice(
        nint dxgiDevice,
        out nint graphicsDevice);
}
