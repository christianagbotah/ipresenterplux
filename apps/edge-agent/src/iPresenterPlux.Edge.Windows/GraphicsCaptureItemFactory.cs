using System.Runtime.InteropServices;
using WinRT;
using Windows.Graphics.Capture;

namespace iPresenterPlux.Edge.Windows;

internal static class GraphicsCaptureItemFactory
{
    private const string RuntimeClassName = "Windows.Graphics.Capture.GraphicsCaptureItem";
    private static readonly Guid InteropId = new("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356");

    public static GraphicsCaptureItem ForWindow(nint hwnd) => Create(hwnd, 3);
    public static GraphicsCaptureItem ForMonitor(nint hmonitor) => Create(hmonitor, 4);

    private static GraphicsCaptureItem Create(nint handle, int vtableSlot)
    {
        if (handle == 0) throw new ArgumentOutOfRangeException(nameof(handle));
        using var factory = ActivationFactory.Get(RuntimeClassName, InteropId);
        var vtable = Marshal.ReadIntPtr(factory.ThisPtr);
        var method = Marshal.ReadIntPtr(vtable, checked(vtableSlot * IntPtr.Size));
        var create = Marshal.GetDelegateForFunctionPointer<CreateCaptureItemDelegate>(method);
        var iid = GuidGenerator.GetIID(typeof(GraphicsCaptureItem));
        var hr = create(factory.ThisPtr, handle, in iid, out var result);
        Marshal.ThrowExceptionForHR(hr);
        try
        {
            return MarshalInspectable<GraphicsCaptureItem>.FromAbi(result);
        }
        finally
        {
            MarshalInspectable<GraphicsCaptureItem>.DisposeAbi(result);
        }
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int CreateCaptureItemDelegate(nint @this, nint handle, in Guid iid, out nint result);
}
