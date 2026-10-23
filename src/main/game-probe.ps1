$ErrorActionPreference = 'Stop'
# Without a console this can throw; the JSON lines are ASCII-safe paths either way.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

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
        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
        public static extern int GetWindowLong(IntPtr window, int index);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, System.Text.StringBuilder name, ref uint size);
        [DllImport("kernel32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CloseHandle(IntPtr handle);

        // PROCESS_QUERY_LIMITED_INFORMATION also works for elevated processes, unlike Process.Path.
        public static string ProcessPath(uint processId) {
            if (processId == 0) return "";
            IntPtr process = OpenProcess(0x1000, false, processId);
            if (process == IntPtr.Zero) return "";
            try {
                var name = new System.Text.StringBuilder(1024);
                uint size = (uint)name.Capacity;
                return QueryFullProcessImageNameW(process, 0, name, ref size) ? name.ToString() : "";
            } finally {
                CloseHandle(process);
            }
        }

        public static bool CoversMonitor(IntPtr window) {
            // A maximised window spills a few pixels past the screen; with an auto-hidden taskbar it would
            // look fullscreen. It keeps its title bar, while fullscreen browsers and borderless games drop it
            // (they may still count as maximised, e.g. Edge going fullscreen from a maximised window).
            const int WS_CAPTION = 0x00C00000;
            if (window == IntPtr.Zero || (GetWindowLong(window, -16) & WS_CAPTION) == WS_CAPTION) return false;
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
    $executablePath = [QuotaDeck.GameProbe]::ProcessPath($foregroundProcessId)
    if ($executablePath) {
        $exe = [System.IO.Path]::GetFileName($executablePath)
    } else {
        $foregroundProcess = $null
        try {
            if ($foregroundProcessId -ne 0) {
                $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction Stop
                $exe = $foregroundProcess.ProcessName + '.exe'
            }
        } catch {
            # A process may exit or deny access between the native query and this read.
        } finally {
            if ($null -ne $foregroundProcess) { $foregroundProcess.Dispose() }
        }
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
