param(
    [string]$Mode = 'full',
    [string]$OutPath = '',
    [switch]$HideWindow,
    [int]$SettleMs = 350,
    [int]$AnchorPid = 0
)

# dsh-shot capture helper (ASCII only, Windows PowerShell 5.1 compatible).
#
# Modes:
#   full    - optionally hide the DSH window, settle, grab the whole virtual
#             screen, restore the window, print one JSON report.
#   restore - restore only; the watchdog path when a capture child is killed.
#
# The whole hide -> grab -> restore sequence lives in this one process, so an
# interrupted capture can never leave the shell window hidden.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type -ReferencedAssemblies 'System.Windows.Forms','System.Drawing' -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class DshShotNative
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
    [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr hObject);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool QueryFullProcessImageNameW(IntPtr hProcess, int dwFlags, StringBuilder lpExeName, ref int lpdwSize);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    public const uint TH32CS_SNAPPROCESS = 0x00000002;
    public static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PROCESSENTRY32W
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public struct POINT { public int X; public int Y; }

    public struct WINDOWPLACEMENT
    {
        public int length;
        public int flags;
        public int showCmd;
        public POINT ptMinPosition;
        public POINT ptMaxPosition;
        public RECT rcNormalPosition;
    }

    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int SW_HIDE = 0;
    public const int SW_SHOW = 5;
    public const int SW_RESTORE = 9;
    public const int GW_OWNER = 4;

    private static readonly string[] ShellNames = new string[] { "DeepSeek Harness", "dsh-desktop", "DSH Desktop" };

    public static string Title(IntPtr hwnd)
    {
        int len = GetWindowTextLength(hwnd);
        if (len <= 0) return "";
        StringBuilder sb = new StringBuilder(len + 2);
        GetWindowText(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    public static string ImageName(uint pid)
    {
        // QueryFullProcessImageNameW with LIMITED_INFORMATION is the right tool
        // here: it works on elevated windows without PROCESS_QUERY_INFORMATION,
        // and - unlike Process.MainModule - costs a fraction of a millisecond.
        // MainModule was measured at ~2 s for one screenful of candidates (it
        // asks the kernel for the whole module list), and it dominated the
        // total capture time.
        const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (handle == IntPtr.Zero) return ProcessNameFallback(pid);
        try
        {
            int capacity = 1024;
            StringBuilder buffer = new StringBuilder(capacity);
            if (QueryFullProcessImageNameW(handle, 0, buffer, ref capacity))
            {
                string path = buffer.ToString();
                string name = System.IO.Path.GetFileNameWithoutExtension(path);
                return string.IsNullOrEmpty(name) ? path : name;
            }
            return ProcessNameFallback(pid);
        }
        finally { CloseHandle(handle); }
    }

    private static string ProcessNameFallback(uint pid)
    {
        try { return Process.GetProcessById((int)pid).ProcessName; }
        catch { return ""; }
    }

    public static uint PidOf(IntPtr hwnd)
    {
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        return pid;
    }

    /** True when that process id currently owns a window whose image is the shell. */
    public static bool AnyShellWindowFor(uint pid)
    {
        return ForPid(pid) != IntPtr.Zero;
    }

    /**
     * True when this process id's executable is one of the shell images.
     * The ancestry walk MUST be gated on this: ancestors include the terminal
     * or editor that launched the app, and hiding one of THEIR windows instead
     * of the shell's is a real hazard (measured during development: a
     * PowerShell ancestor was picked as "the DSH window").
     */
    public static bool IsShellPid(uint pid)
    {
        string image = ImageName(pid);
        foreach (string candidate in ShellNames)
        {
            if (string.Equals(candidate, image, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    /**
     * Direct parent of one process, straight from the kernel snapshot - the
     * PowerShell-side Get-Process walk it replaces cost ~2 s per capture.
     */
    public static uint ParentOf(uint pid)
    {
        IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == INVALID_HANDLE_VALUE) return 0;
        try
        {
            PROCESSENTRY32W entry = new PROCESSENTRY32W();
            entry.dwSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(PROCESSENTRY32W));
            if (!Process32FirstW(snapshot, ref entry)) return 0;
            do
            {
                if (entry.th32ProcessID == pid) return entry.th32ParentProcessID;
            } while (Process32NextW(snapshot, ref entry));
            return 0;
        }
        finally { CloseHandle(snapshot); }
    }

    private static double Area(IntPtr hwnd)
    {
        RECT r;
        if (!GetWindowRect(hwnd, out r)) return 0;
        double w = r.Right - r.Left;
        double h = r.Bottom - r.Top;
        return w > 0 && h > 0 ? w * h : 0;
    }

    /**
     * Screen rectangle of a window's CLIENT area as "left,top,right,bottom".
     *
     * The overlay fills the web content area, not the outer frame, so the crop
     * has to be the client area: GetWindowRect included the title bar, borders
     * and shadow, making the slice ~1.5x larger than the content area - which
     * still scaled the overlay and left it misaligned with the real screen.
     */
    public static string RectText(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return "";
        RECT r;
        if (!GetClientRect(hwnd, out r)) return "";
        POINT topLeft = new POINT();
        topLeft.X = r.Left;
        topLeft.Y = r.Top;
        POINT bottomRight = new POINT();
        bottomRight.X = r.Right;
        bottomRight.Y = r.Bottom;
        if (!ClientToScreen(hwnd, ref topLeft)) return "";
        if (!ClientToScreen(hwnd, ref bottomRight)) return "";
        if (bottomRight.X <= topLeft.X || bottomRight.Y <= topLeft.Y) return "";
        return string.Format("{0},{1},{2},{3}", topLeft.X, topLeft.Y, bottomRight.X, bottomRight.Y);
    }

    /** A real top-level app window: not owned, not a tool window, large enough. */
    public static bool Plausible(IntPtr hwnd)
    {
        if ((GetWindowLong(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return false;
        if (GetWindowLong(hwnd, GW_OWNER) != 0) return false;
        if (Title(hwnd).Length == 0) return false;
        // A minimized window reports a tiny rect (~107x19), so the size test
        // would reject it and the hide path would report "no window to hide"
        // even though the window is right there on the taskbar. Minimized is an
        // explicit hint that this IS the app window, so accept it outright.
        if (IsIconic(hwnd)) return true;
        return Area(hwnd) >= 200 * 150;
    }

    private static bool IsShellWindow(IntPtr hwnd, uint pid)
    {
        string image = ImageName(pid);
        foreach (string candidate in ShellNames)
        {
            if (string.Equals(candidate, image, StringComparison.OrdinalIgnoreCase)) return true;
        }
        // Reading another process's main module can be denied, in which case the
        // image name is useless - the window title is the second identification.
        return Title(hwnd).IndexOf("DeepSeek Harness", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    /** The shell window for one process. */
    public static IntPtr ForPid(uint pid)
    {
        return ForPid(pid, false);
    }

    /**
     * Window for one process. `visibleOnly` exists because the two callers want
     * different things: a CAPTURE target must be on screen (a minimized 107x19
     * icon is not something to photograph), while hiding a minimized window is
     * both safe and necessary  the user pressed "hide this window", so it has
     * to be found even while it sits minimized in the taskbar.
     */
    public static IntPtr ForPid(uint pid, bool visibleOnly)
    {
        IntPtr best = IntPtr.Zero;
        double bestArea = 0;
        EnumWindows(delegate(IntPtr hwnd, IntPtr lparam)
        {
            uint candidate;
            GetWindowThreadProcessId(hwnd, out candidate);
            if (candidate != pid) return true;
            if (!Plausible(hwnd)) return true;
            if (visibleOnly && (IsIconic(hwnd) || !IsWindowVisible(hwnd))) return true;
            double area = Area(hwnd);
            if (area > bestArea) { bestArea = area; best = hwnd; }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    /** The shell window of any process; a visible one always wins over a minimized one. */
    public static IntPtr ForAny()
    {
        IntPtr best = IntPtr.Zero;
        double bestScore = -1;
        EnumWindows(delegate(IntPtr hwnd, IntPtr lparam)
        {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (!IsShellWindow(hwnd, pid)) return true;
            if (!Plausible(hwnd)) return true;
            bool visible = IsWindowVisible(hwnd) && !IsIconic(hwnd);
            double score = Area(hwnd) * (visible ? 1 : 0.001);
            if (score > bestScore) { bestScore = score; best = hwnd; }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    public static bool CapturePlacement(IntPtr hwnd, out WINDOWPLACEMENT placement)
    {
        placement = new WINDOWPLACEMENT();
        placement.length = System.Runtime.InteropServices.Marshal.SizeOf(typeof(WINDOWPLACEMENT));
        if (hwnd == IntPtr.Zero) return false;
        return GetWindowPlacement(hwnd, ref placement);
    }

    /**
     * Bring the window back exactly as it was: SetWindowPlacement restores a
     * minimized window to the state it was minimized from, which plain
     * ShowWindow(SW_SHOW) does not (it only un-hides the taskbar button).
     */
    public static void Restore(IntPtr hwnd, WINDOWPLACEMENT placement)
    {
        if (hwnd == IntPtr.Zero) return;
        if (placement.length > 0)
        {
            WINDOWPLACEMENT copy = placement;
            SetWindowPlacement(hwnd, ref copy);
        }
        ShowWindow(hwnd, SW_SHOW);
    }

    /** Restore without a remembered placement: reconstruct from the current state. */
    public static string RestoreForPid(uint pid)
    {
        IntPtr hwnd = ForPid(pid);
        if (hwnd == IntPtr.Zero) return "not-found";
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
        ShowWindow(hwnd, SW_SHOW);
        RECT r;
        GetWindowRect(hwnd, out r);
        return string.Format("iconic={0} visible={1} rect={2},{3},{4},{5}", IsIconic(hwnd), IsWindowVisible(hwnd), r.Left, r.Top, r.Right, r.Bottom);
    }
}
'@

function Emit-Report {
    param(
        [bool]$Ok,
        [string]$ErrorText = '',
        [string]$Path = '',
        [int]$Width = 0,
        [int]$Height = 0,
        [int]$ScreenX = 0,
        [int]$ScreenY = 0,
        [int]$ScreenW = 0,
        [int]$ScreenH = 0,
        [string]$Window = '',
        [string]$WindowRect = '',
        [bool]$Hidden = $false,
        [bool]$Restored = $false
    )
    $report = [ordered]@{
        ok         = $Ok
        error      = $ErrorText
        path       = $Path
        width      = $Width
        height     = $Height
        screen     = [ordered]@{ x = $ScreenX; y = $ScreenY; width = $ScreenW; height = $ScreenH }
        window     = $Window
        windowRect = $WindowRect
        hideWindow = $Hidden
        restored   = $Restored
        mode       = $Mode
    }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $report -Compress -Depth 4))
    [Console]::Out.Flush()
}

# Resolve the shell window up front: both modes need the same handle. The
# anchor walk goes from the harness's parent upwards, so a plugin reload that
# changes process ids still lands on the Electron main process. Minimized and
# hidden windows count too - a minimized shell must still be findable, or the
# hide step would report "no window" instead of just working.
$hwnd = [IntPtr]::Zero
$shellPid = 0
try {
    if ($AnchorPid -gt 0) {
        $current = $AnchorPid
        for ($hop = 0; $hop -lt 6 -and $current -gt 0; $hop++) {
            # Only a process whose executable IS the shell may supply the window.
            # Without this gate the walk can land on the terminal/editor that
            # launched the app and hide one of its windows instead.
            if ([DshShotNative]::IsShellPid([uint32]$current)) {
                # When hiding, a minimized window still counts (hiding it is
                # safe); when not hiding, the handle is only used for reporting,
                # so a visible window is the more useful answer.
                $wantVisible = -not $HideWindow.IsPresent -and $Mode -ne 'restore'
                $candidate = [DshShotNative]::ForPid([uint32]$current, $wantVisible)
                if ($candidate -ne [IntPtr]::Zero) {
                    $hwnd = $candidate
                    $shellPid = $current
                    break
                }
            }
            # Kernel process snapshot: ~1 ms, versus seconds for the
            # PowerShell Get-Process ancestry walk this replaced.
            $current = [int][DshShotNative]::ParentOf([uint32]$current)
        }
    }
    if ($hwnd -eq [IntPtr]::Zero) {
        $hwnd = [DshShotNative]::ForAny()
        if ($hwnd -ne [IntPtr]::Zero) { $shellPid = [int][DshShotNative]::PidOf($hwnd) }
    }
} catch {
    $hwnd = [IntPtr]::Zero
}
$windowTitle = if ($hwnd -ne [IntPtr]::Zero) { [DshShotNative]::Title($hwnd) } else { '' }

if ($Mode -eq 'restore') {
    # Watchdog path: the capture child was killed, so no placement was saved.
    # Reconstruct from the shell process instead of leaving it hidden.
    $outcome = 'no-window'
    if ($shellPid -gt 0) { $outcome = [DshShotNative]::RestoreForPid([uint32]$shellPid) }
    elseif ($hwnd -ne [IntPtr]::Zero) {
        [DshShotNative]::ShowWindow($hwnd, [DshShotNative]::SW_RESTORE) | Out-Null
        [DshShotNative]::ShowWindow($hwnd, [DshShotNative]::SW_SHOW) | Out-Null
        $outcome = 'shown'
    }
    Emit-Report -Ok $true -Window $windowTitle -Restored ($outcome -ne 'no-window')
    exit 0
}

$hidden = $false
$placement = New-Object DshShotNative+WINDOWPLACEMENT
$hasPlacement = $false
try {
    # DPI awareness first, so CopyFromScreen reports physical pixels and the
    # window rect and the bitmap agree on coordinates.
    try { [DshShotNative]::SetProcessDPIAware() | Out-Null } catch { }

    if ($HideWindow) {
        if ($hwnd -eq [IntPtr]::Zero) { throw 'could not identify the DSH window to hide' }
        # Remember the exact state (including "minimized") so the restore puts
        # the window back where the user had it - not merely un-hidden.
        $hasPlacement = [DshShotNative]::CapturePlacement($hwnd, [ref]$placement)
        [DshShotNative]::ShowWindow($hwnd, [DshShotNative]::SW_HIDE) | Out-Null
        $hidden = $true
        # A fixed sleep is not enough: the compositor can still be blending the
        # window out when the grab happens, which put the window's own white
        # chrome into the top of the frame. Wait for the hide to actually take
        # effect, and keep a floor so the desktop has a frame to settle.
        Start-Sleep -Milliseconds ([Math]::Max(120, $SettleMs))
        $deadline = (Get-Date).AddMilliseconds(1500)
        while ((Get-Date) -lt $deadline) {
            if (-not [DshShotNative]::IsWindowVisible($hwnd)) { break }
            Start-Sleep -Milliseconds 60
        }
        # One extra compositor frame after the window is reported gone.
        Start-Sleep -Milliseconds 120
    }

    $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
    if ($screen.Width -le 0 -or $screen.Height -le 0) { throw 'virtual screen reported a non-positive size' }

    # Read the window rect BEFORE hiding: the overlay uses it to place the frame
    # so the window's slice of the desktop lines up with the real window. In
    # hide mode the window is gone from the screen at capture time, but it is
    # restored to exactly this rect afterwards, which is what the user sees.
    $windowRect = [DshShotNative]::RectText($hwnd)

    $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, (New-Object System.Drawing.Size($screen.Width, $screen.Height)))
    } finally {
        $graphics.Dispose()
    }

    if ([string]::IsNullOrWhiteSpace($OutPath)) {
        $OutPath = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-shot-' + [Guid]::NewGuid().ToString('n') + '.png')
    }
    $bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $width = $bitmap.Width
    $height = $bitmap.Height
    $bitmap.Dispose()

    if ($hidden) {
        [DshShotNative]::Restore($hwnd, $placement)
        $hidden = $false
    }

    Emit-Report -Ok $true -Path $OutPath -Width $width -Height $height -ScreenX $screen.X -ScreenY $screen.Y `
        -ScreenW $screen.Width -ScreenH $screen.Height -Window $windowTitle -WindowRect $windowRect `
        -Hidden ([bool]$HideWindow) -Restored $true
} catch {
    Emit-Report -Ok $false -ErrorText $_.Exception.Message -Window $windowTitle -Hidden $hidden
} finally {
    # Belt and braces: runs even when the body threw, so a failed capture can
    # never leave the shell window hidden.
    if ($hidden -and $hwnd -ne [IntPtr]::Zero) {
        try {
            if ($hasPlacement) { [DshShotNative]::Restore($hwnd, $placement) }
            else { [DshShotNative]::RestoreForPid([uint32]$shellPid) | Out-Null }
        } catch { }
    }
}

exit 0
