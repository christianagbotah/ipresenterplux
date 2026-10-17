using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Windows;

public sealed class WindowsGraphicsSourceCatalog : IVisualSourceCatalog
{
    private const uint MonitorInfoPrimary = 0x00000001;
    private readonly Func<IReadOnlyList<WindowsNativeDisplay>> _enumerateDisplays;
    private readonly Func<IReadOnlyList<WindowsNativeWindow>> _enumerateWindows;
    private readonly TimeProvider _clock;

    public WindowsGraphicsSourceCatalog(TimeProvider? clock = null)
        : this(EnumerateDisplaysNative, EnumerateWindowsNative, clock)
    {
    }

    public WindowsGraphicsSourceCatalog(
        Func<IReadOnlyList<WindowsNativeDisplay>> enumerateDisplays,
        Func<IReadOnlyList<WindowsNativeWindow>> enumerateWindows,
        TimeProvider? clock = null)
    {
        _enumerateDisplays = enumerateDisplays ?? throw new ArgumentNullException(nameof(enumerateDisplays));
        _enumerateWindows = enumerateWindows ?? throw new ArgumentNullException(nameof(enumerateWindows));
        _clock = clock ?? TimeProvider.System;
    }

    public Task<IReadOnlyList<VisualSourceDescriptor>> ScanAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var observedAt = _clock.GetUtcNow();
        var unique = new Dictionary<string, VisualSourceDescriptor>(StringComparer.Ordinal);

        foreach (var record in _enumerateDisplays())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(record.DeviceId) && string.IsNullOrWhiteSpace(record.DeviceName)) continue;
            if (record.Width <= 0 || record.Height <= 0) continue;
            var descriptor = WindowsVisualSourceMetadata.Display(record, observedAt);
            unique.TryAdd(descriptor.SourceId, descriptor);
        }

        foreach (var record in _enumerateWindows())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (record.Handle == 0 || string.IsNullOrWhiteSpace(record.ProcessName) || string.IsNullOrWhiteSpace(record.ExecutableIdentity)) continue;
            if (WindowsVisualSourceMetadata.IsInternalWindow(record)) continue;
            var descriptor = WindowsVisualSourceMetadata.Window(record, observedAt);
            unique.TryAdd(descriptor.SourceId, descriptor);
        }

        return Task.FromResult<IReadOnlyList<VisualSourceDescriptor>>(
            unique.Values.OrderBy(source => source.Kind)
                .ThenBy(source => source.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(source => source.SourceId, StringComparer.Ordinal)
                .ToArray());
    }

    private static IReadOnlyList<WindowsNativeDisplay> EnumerateDisplaysNative()
    {
        EnsureWindows();
        var displays = new List<WindowsNativeDisplay>();
        MonitorEnumProc callback = (monitor, _, _, _) =>
        {
            var info = new MonitorInfoEx
            {
                Size = (uint)Marshal.SizeOf<MonitorInfoEx>(),
                DeviceName = string.Empty
            };
            if (!GetMonitorInfo(monitor, ref info)) return true;

            var device = new DisplayDevice
            {
                Size = (uint)Marshal.SizeOf<DisplayDevice>(),
                DeviceName = string.Empty,
                DeviceString = string.Empty,
                DeviceId = string.Empty,
                DeviceKey = string.Empty
            };
            var stableId = info.DeviceName;
            if (EnumDisplayDevices(info.DeviceName, 0, ref device, 0) && !string.IsNullOrWhiteSpace(device.DeviceId))
                stableId = device.DeviceId;

            displays.Add(new WindowsNativeDisplay(
                monitor,
                info.DeviceName,
                stableId,
                info.Monitor.Left,
                info.Monitor.Top,
                checked(info.Monitor.Right - info.Monitor.Left),
                checked(info.Monitor.Bottom - info.Monitor.Top),
                (info.Flags & MonitorInfoPrimary) != 0));
            return true;
        };

        if (!EnumDisplayMonitors(0, 0, callback, 0))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not enumerate Windows displays.");
        return displays;
    }

    private static IReadOnlyList<WindowsNativeWindow> EnumerateWindowsNative()
    {
        EnsureWindows();
        var windows = new List<WindowsNativeWindow>();
        var currentProcessId = Environment.ProcessId;
        EnumWindowsProc callback = (window, data) =>
        {
            if (window == 0 || !IsWindowVisible(window) || !GetWindowRect(window, out var rect)) return true;
            if (rect.Right <= rect.Left || rect.Bottom <= rect.Top) return true;

            GetWindowThreadProcessId(window, out var processIdValue);
            if (processIdValue == 0 || processIdValue == currentProcessId) return true;
            if (processIdValue > int.MaxValue) return true;

            try
            {
                using var process = Process.GetProcessById((int)processIdValue);
                var processName = process.ProcessName;
                if (string.IsNullOrWhiteSpace(processName)) return true;
                string executableIdentity;
                try
                {
                    executableIdentity = process.MainModule?.FileName ?? processName;
                }
                catch (Win32Exception)
                {
                    executableIdentity = processName;
                }
                catch (NotSupportedException)
                {
                    executableIdentity = processName;
                }

                windows.Add(new WindowsNativeWindow(window, (int)processIdValue, processName, executableIdentity));
            }
            catch (ArgumentException)
            {
                // The process exited between EnumWindows and inspection.
            }
            catch (InvalidOperationException)
            {
                // The process exited or its details became unavailable.
            }
            catch (Win32Exception)
            {
                // Protected/elevated process details may not be readable by this Edge user.
            }
            return true;
        };

        if (!EnumWindows(callback, 0))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not enumerate top-level Windows application windows.");
        return windows;
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Windows Graphics Capture discovery requires Windows.");
    }

    private delegate bool MonitorEnumProc(nint monitor, nint hdc, nint clipRect, nint data);
    private delegate bool EnumWindowsProc(nint window, nint data);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfoEx
    {
        public uint Size;
        public Rect Monitor;
        public Rect Work;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayDevice
    {
        public uint Size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceString;
        public uint StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceId;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceKey;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplayMonitors(nint hdc, nint clipRect, MonitorEnumProc callback, nint data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfoEx info);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplayDevices(string deviceName, uint deviceNumber, ref DisplayDevice displayDevice, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, nint data);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(nint window);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(nint window, out Rect rect);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint window, out uint processId);
}
