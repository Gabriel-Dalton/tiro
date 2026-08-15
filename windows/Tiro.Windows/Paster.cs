using System.Runtime.InteropServices;

namespace Tiro.Windows;

/// <summary>
/// Puts the transcript on the clipboard, sends Ctrl+V to the focused window,
/// and restores the previous clipboard ~0.5 s later (SPEC-WINDOWS 4.2).
/// No macOS-style permission gate exists on Windows; the one failure mode is
/// an elevated target window (UIPI drops our input silently), which is
/// detected and reported instead of pretending to succeed.
/// </summary>
static class Paster
{
    public record Result(bool Ok, string? Reason);

    public static Result Paste(string text)
    {
        if (string.IsNullOrEmpty(text)) return new Result(false, "empty");

        if (ForegroundWindowIsElevated())
        {
            // leave the transcript on the clipboard so the user can paste manually
            TrySetClipboard(text);
            return new Result(false, "elevated");
        }

        string? previous = null;
        try { if (Clipboard.ContainsText()) previous = Clipboard.GetText(); } catch { }

        if (!TrySetClipboard(text)) return new Result(false, "clipboard");

        SendCtrlV();

        // restore after the target app has read the clipboard, as upstream does
        var restoreTimer = new System.Windows.Forms.Timer { Interval = 500 };
        restoreTimer.Tick += (_, _) =>
        {
            restoreTimer.Dispose();
            try
            {
                if (previous != null) Clipboard.SetText(previous);
            }
            catch { }
        };
        restoreTimer.Start();

        return new Result(true, null);
    }

    private static bool TrySetClipboard(string text)
    {
        // the clipboard can be held open by another process; retry briefly
        for (int i = 0; i < 5; i++)
        {
            try
            {
                Clipboard.SetText(text);
                return true;
            }
            catch
            {
                Thread.Sleep(40);
            }
        }
        return false;
    }

    private static void SendCtrlV()
    {
        var inputs = new INPUT[4];
        inputs[0] = Key(VK_CONTROL, down: true);
        inputs[1] = Key(VK_V, down: true);
        inputs[2] = Key(VK_V, down: false);
        inputs[3] = Key(VK_CONTROL, down: false);
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    }

    /// <summary>UIPI check: a non-elevated process cannot send input to an
    /// elevated window. If we cannot even query the process, assume elevated.</summary>
    private static bool ForegroundWindowIsElevated()
    {
        try
        {
            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return false;
            GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == 0) return false;
            var hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (hProc == IntPtr.Zero) return true; // access denied → almost certainly elevated
            try
            {
                if (!OpenProcessToken(hProc, TOKEN_QUERY, out var hToken)) return true;
                try
                {
                    uint elevation = 0;
                    if (GetTokenInformation(hToken, TokenElevation, ref elevation, sizeof(uint), out _))
                        return elevation != 0 && !CurrentProcessIsElevated();
                    return false;
                }
                finally { CloseHandle(hToken); }
            }
            finally { CloseHandle(hProc); }
        }
        catch
        {
            return false;
        }
    }

    private static bool CurrentProcessIsElevated()
    {
        using var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
        return new System.Security.Principal.WindowsPrincipal(identity)
            .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
    }

    // ---- interop ----

    private const ushort VK_CONTROL = 0x11;
    private const ushort VK_V = 0x56;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint INPUT_KEYBOARD = 1;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint TOKEN_QUERY = 0x0008;
    private const int TokenElevation = 20;

    private static INPUT Key(ushort vk, bool down) => new()
    {
        type = INPUT_KEYBOARD,
        U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = down ? 0 : KEYEVENTF_KEYUP } },
    };

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public MOUSEINPUT mi; // sizes the union correctly
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int infoClass, ref uint info, int infoLength, out int returnLength);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}
