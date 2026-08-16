using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Tiro.Windows;

/// <summary>
/// WH_KEYBOARD_LL global hotkey (SPEC-WINDOWS 4.1). The callback does no work
/// beyond filtering and raising an event. A slow hook lags every app's typing
/// and Windows silently unhooks it. Hold/tap timing lives in the web core.
/// </summary>
sealed class KeyboardHook : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const uint LLKHF_INJECTED = 0x10;
    private const uint VK_ESCAPE = 0x1B;

    // web-core hotkey codes (KeyboardEvent.code names) -> virtual-key codes
    public static readonly Dictionary<string, uint> CodeToVk = new()
    {
        ["AltRight"] = 0xA5,     // VK_RMENU
        ["ShiftRight"] = 0xA1,   // VK_RSHIFT
        ["ControlRight"] = 0xA3, // VK_RCONTROL
        ["CapsLock"] = 0x14,     // VK_CAPITAL (advanced option; toggle is swallowed while hooked)
        ["ScrollLock"] = 0x91,   // VK_SCROLL
    };

    public event Action<bool>? HotkeyChanged; // true = down, false = up

    /// <summary>Escape, while and only while a take is running.</summary>
    public event Action? CancelPressed;

    /// <summary>Gates the Escape watch. Swallowing Escape globally would break
    /// every dialog, menu and vim session on the machine, so it is armed only
    /// for the seconds a take is actually in flight. Within those seconds
    /// swallowing it is the right call: you pressed it to stop dictating, not to
    /// dismiss whatever is behind the pill.</summary>
    public bool WatchCancel { get; set; }

    private IntPtr _hook = IntPtr.Zero;
    private readonly LowLevelKeyboardProc _proc; // rooted: the GC must not collect the delegate
    private uint _vk;
    private bool _isDown;
    private readonly System.Windows.Forms.Timer _watchdog;

    public KeyboardHook(string hotkeyCode)
    {
        _proc = Callback;
        _vk = CodeToVk.TryGetValue(hotkeyCode, out var vk) ? vk : CodeToVk["AltRight"];
        Install();
        // retry a failed install (e.g. transient resource exhaustion at login)
        _watchdog = new System.Windows.Forms.Timer { Interval = 5000 };
        _watchdog.Tick += (_, _) => { if (_hook == IntPtr.Zero) Install(); };
        _watchdog.Start();
    }

    public void SetHotkey(string code)
    {
        if (CodeToVk.TryGetValue(code, out var vk)) _vk = vk;
    }

    private void Install()
    {
        using var module = Process.GetCurrentProcess().MainModule!;
        _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(module.ModuleName), 0);
        if (_hook == IntPtr.Zero) Log.Write("SetWindowsHookEx failed");
    }

    private IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var info = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
            bool injected = (info.flags & LLKHF_INJECTED) != 0;

            if (WatchCancel && info.vkCode == VK_ESCAPE && !injected)
            {
                int m = wParam.ToInt32();
                if (m == WM_KEYDOWN || m == WM_SYSKEYDOWN) CancelPressed?.Invoke();
                return (IntPtr)1; // swallow both edges, or the app sees a stray key-up
            }

            // ignore our own SendInput Ctrl+V, or pasting would re-trigger the hook
            if (info.vkCode == _vk && !injected)
            {
                int msg = wParam.ToInt32();
                bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
                bool up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
                if (down && !_isDown)
                {
                    _isDown = true;
                    HotkeyChanged?.Invoke(true);
                }
                else if (up && _isDown)
                {
                    _isDown = false;
                    HotkeyChanged?.Invoke(false);
                }
                // swallow the key so the focused app never sees it
                // (Right Alt would otherwise activate menus, Caps would toggle)
                return (IntPtr)1;
            }
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public void Dispose()
    {
        _watchdog.Dispose();
        if (_hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        }
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetModuleHandle(string lpModuleName);
}
