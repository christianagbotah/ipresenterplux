using System.Reflection;
using System.Runtime.InteropServices;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX.Direct3D11;
using Xunit;

namespace iPresenterPlux.Edge.Windows.Tests;

public sealed class WindowsGraphicsCaptureInteropTests
{
    [Fact]
    public void WindowsSdkProjectionExposesGraphicsCaptureAndDirect3DTypes()
    {
        Assert.Equal("Windows.Graphics.Capture.GraphicsCaptureItem", typeof(GraphicsCaptureItem).FullName);
        Assert.Equal("Windows.Graphics.DirectX.Direct3D11.IDirect3DDevice", typeof(IDirect3DDevice).FullName);
    }

    [Fact]
    public void CaptureItemInteropAbiSupportsWindowAndMonitorHandles()
    {
        Assert.Equal(new Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), typeof(IGraphicsCaptureItemInterop).GUID);

        var window = typeof(IGraphicsCaptureItemInterop).GetMethod(nameof(IGraphicsCaptureItemInterop.CreateForWindow));
        var monitor = typeof(IGraphicsCaptureItemInterop).GetMethod(nameof(IGraphicsCaptureItemInterop.CreateForMonitor));

        Assert.NotNull(window);
        Assert.NotNull(monitor);
        Assert.Equal(typeof(nint), window!.GetParameters()[0].ParameterType);
        Assert.Equal(typeof(nint), monitor!.GetParameters()[0].ParameterType);
        Assert.Equal(typeof(int), window.ReturnType);
        Assert.Equal(typeof(int), monitor.ReturnType);
    }

    [ComImport]
    [Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IGraphicsCaptureItemInterop
    {
        [PreserveSig]
        int CreateForWindow(nint window, in Guid iid, out nint result);

        [PreserveSig]
        int CreateForMonitor(nint monitor, in Guid iid, out nint result);
    }
}
