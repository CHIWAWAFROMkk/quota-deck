$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# Only native geometry, process identity and shell notification state are collected.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace QuotaDeck {
    public static class GameProbe {
        [StructLayout(LayoutKind.Sequential)]
        public struct Rect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)]
        public struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }

        [DllImport("shell32.dll")]
        public static extern int SHQueryUserNotificationState(out int state);
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetWindowRect(IntPtr window, out Rect rect);
        [DllImport("user32.dll")]
        public static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
        [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
        [DllImport("user32.dll")]
        public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

        public static bool CoversMonitor(IntPtr window) {
            if (window == IntPtr.Zero) return false;
            // Keep the window and monitor rectangles in physical pixels on mixed-DPI displays.
            IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
            try {
                Rect rect;
                MonitorInfo info = new MonitorInfo();
                info.Size = Marshal.SizeOf(typeof(MonitorInfo));
                IntPtr monitor = MonitorFromWindow(window, 2);
                return monitor != IntPtr.Zero && GetWindowRect(window, out rect)
                    && GetMonitorInfo(monitor, ref info)
                    && rect.Left <= info.Monitor.Left && rect.Top <= info.Monitor.Top
                    && rect.Right >= info.Monitor.Right && rect.Bottom >= info.Monitor.Bottom;
            } finally {
                if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
            }
        }
    }
}
'@

$previousFact = $null
while ($true) {
    $notification = 0
    if ([QuotaDeck.GameProbe]::SHQueryUserNotificationState([ref]$notification) -ne 0) { $notification = 0 }
    $window = [QuotaDeck.GameProbe]::GetForegroundWindow()
    [uint32]$foregroundProcessId = 0
    [void][QuotaDeck.GameProbe]::GetWindowThreadProcessId($window, [ref]$foregroundProcessId)
    $exe = ''
    $executablePath = ''
    $foregroundProcess = $null
    try {
        if ($foregroundProcessId -ne 0) {
            $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction Stop
            $exe = $foregroundProcess.ProcessName + '.exe'
            $executablePath = [string]$foregroundProcess.Path
        }
    } catch {
        # A process may exit or deny access between the native query and this read.
    } finally {
        if ($null -ne $foregroundProcess) { $foregroundProcess.Dispose() }
    }
    $fact = [ordered]@{
        notification = $notification
        exe = $exe
        path = $executablePath
        covers = [QuotaDeck.GameProbe]::CoversMonitor($window)
    } | ConvertTo-Json -Compress
    if ($fact -cne $previousFact) {
        [Console]::WriteLine($fact)
        [Console]::Out.Flush()
        $previousFact = $fact
    }
    Start-Sleep -Milliseconds 1500
}
