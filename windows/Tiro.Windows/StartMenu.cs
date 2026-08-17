using System.Runtime.InteropServices;
using System.Text;

namespace Tiro.Windows;

/// <summary>
/// Identity on the taskbar, and the Start Menu shortcut that pinning needs.
///
/// Nothing installs this app: people download one EXE and run it from wherever
/// it landed. That is deliberate, and it costs two things that only show up when
/// someone tries to pin it.
///
/// The first is that Windows identifies a window by its process's Application
/// User Model ID, and with none set it derives one from the executable's path.
/// A portable EXE's path is not stable: the next release is downloaded to
/// `Tiro (1).exe`, or the folder gets tidied into Documents, and the pinned
/// button is now pointing at an identity nothing will ever claim again. It stops
/// launching the app and stops grouping with its window. Declaring the ID
/// explicitly, the same string in every build, makes the pin survive all of it.
///
/// The second is that there is nothing to pin from. Pinning a running window's
/// taskbar button works, but the window is hidden most of the time by design,
/// and Start search finds nothing because no shortcut exists. So the app writes
/// one, once, and repairs its target if the EXE later moves.
///
/// The ID must match on both sides. A shortcut whose System.AppUserModel.ID
/// differs from the running process's is treated as a different application:
/// you get the pinned shortcut and a second, separate button for the live
/// window, which is the exact symptom the explicit ID was set to avoid.
/// </summary>
static class StartMenu
{
    /// <summary>Company.Product, the documented shape, and frozen. Changing it
    /// in a later release orphans every pin made by an earlier one.</summary>
    public const string AppUserModelId = "GabrielDalton.Tiro";

    public static string ShortcutPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Tiro.lnk");

    private static string ExePath => Environment.ProcessPath ?? Application.ExecutablePath;

    /// <summary>Must run before any window exists. Windows reads the ID when a
    /// window is first created and does not re-read it, so setting this after
    /// the tray icon or the main form is up leaves them on the path-derived
    /// identity for the life of the process.</summary>
    public static void SetProcessId()
    {
        try
        {
            SetCurrentProcessExplicitAppUserModelID(AppUserModelId);
        }
        catch (Exception ex)
        {
            // Down-level or locked down: the app works, pins just get the
            // path-derived identity back.
            Log.Write($"AppUserModelID not set: {ex.Message}");
        }
    }

    /// <summary>Write the Start Menu shortcut if it is missing or points at an
    /// EXE that is no longer this one. Returns true if the shortcut is in place
    /// afterwards.</summary>
    public static bool EnsureShortcut() => EnsureShortcutFor(ExePath);

    /// <summary>
    /// The same thing for a copy that is not this process, which is what
    /// installing is: Setup has just written the EXE it wants the Start Menu to
    /// point at, and that file is not the one running. Kept here rather than
    /// hand-rolled there so there is one declaration of the shell interop and one
    /// place the Application User Model ID is set. A shortcut written without it
    /// pins as a separate application from the running window, which is the whole
    /// failure this class exists to prevent.
    /// </summary>
    public static bool EnsureShortcutFor(string exe)
    {
        try
        {
            if (string.IsNullOrEmpty(exe) || !File.Exists(exe)) return false;
            if (TargetOf(ShortcutPath) is string existing &&
                string.Equals(existing, exe, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(ShortcutPath)!);
            Write(ShortcutPath, exe);
            Log.Write($"Start Menu shortcut written to {ShortcutPath}");
            return true;
        }
        catch (Exception ex)
        {
            Log.Write($"Start Menu shortcut failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Write a shortcut somewhere that is not the Start Menu, and report whether
    /// it came back with the target and the identity it was given.
    ///
    /// This exists for the self-test, and it exists because the writer shipped
    /// broken. Everything it does needs COM and the file system and nothing needs
    /// a desktop session, a window or a real Start Menu, so it is one of the few
    /// things about this app that a build agent can genuinely check. See
    /// StringPropVariant for what was wrong.
    /// </summary>
    public static bool RoundTripsShortcut(string lnk, string exe)
    {
        try
        {
            Write(lnk, exe);
            return string.Equals(TargetOf(lnk), exe, StringComparison.OrdinalIgnoreCase)
                && AppIdOf(lnk) == AppUserModelId;
        }
        catch (Exception ex)
        {
            Log.Write($"the shortcut writer is broken: {ex.GetType().Name}: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// The Application User Model ID recorded on a shortcut, or null. Read back
    /// rather than assumed: a shortcut written without it pins as a separate
    /// application from the running window, and nothing about that failure points
    /// at the missing property.
    /// </summary>
    private static string? AppIdOf(string lnk)
    {
        var link = (IShellLinkW)new ShellLink();
        try
        {
            ((IPersistFile)link).Load(lnk, 0);
            var store = (IPropertyStore)link;
            store.GetValue(ref PkeyAppUserModelId, out var value);
            try
            {
                return value.Vt == 31 && value.Value != IntPtr.Zero
                    ? Marshal.PtrToStringUni(value.Value)
                    : null;
            }
            finally
            {
                PropVariantClear(ref value);
            }
        }
        catch
        {
            return null;
        }
        finally
        {
            Marshal.FinalReleaseComObject(link);
        }
    }

    /// <summary>The EXE a shortcut points at, or null if there is no readable
    /// shortcut there.</summary>
    private static string? TargetOf(string lnk)
    {
        if (!File.Exists(lnk)) return null;
        var link = (IShellLinkW)new ShellLink();
        try
        {
            ((IPersistFile)link).Load(lnk, 0);
            var buffer = new StringBuilder(260);
            link.GetPath(buffer, buffer.Capacity, IntPtr.Zero, 0);
            var path = buffer.ToString();
            return path.Length == 0 ? null : path;
        }
        catch
        {
            return null; // corrupt or unreadable: treat as absent and rewrite
        }
        finally
        {
            Marshal.FinalReleaseComObject(link);
        }
    }

    private static void Write(string lnk, string exe)
    {
        var link = (IShellLinkW)new ShellLink();
        try
        {
            link.SetPath(exe);
            link.SetWorkingDirectory(Path.GetDirectoryName(exe) ?? "");
            link.SetDescription("Dictate anywhere with Tiro");
            // No --tray here. Someone launching from a pin or from Start is
            // asking to see the app; the autostart Run entry is the only caller
            // that wants it to come up hidden.
            link.SetArguments("");
            link.SetIconLocation(exe, 0);

            var store = (IPropertyStore)link;
            var value = StringPropVariant(AppUserModelId);
            try
            {
                store.SetValue(ref PkeyAppUserModelId, ref value);
                store.Commit();
            }
            finally
            {
                PropVariantClear(ref value);
            }

            ((IPersistFile)link).Save(lnk, true);
        }
        finally
        {
            Marshal.FinalReleaseComObject(link);
        }
    }

    // ------------------------------------------------------------------ interop

    // PKEY_AppUserModel_ID
    private static PropertyKey PkeyAppUserModelId = new(
        new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);

    // Public fields, not private readonly ones: nothing here reads them back, so
    // private would draw a "assigned but never used" warning for a struct whose
    // whole job is its memory layout. IPropertyStore.GetAt writes to them too.
    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey
    {
        public Guid FormatId;
        public int PropertyId;
        public PropertyKey(Guid formatId, int propertyId)
        {
            FormatId = formatId;
            PropertyId = propertyId;
        }
    }

    // The union starts at offset 8 on both architectures, which is what the
    // three reserved words are for. Cleared through PropVariantClear rather than
    // by hand: the string it holds was allocated by the shell's allocator.
    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariant
    {
        public ushort Vt;
        public ushort Reserved1;
        public ushort Reserved2;
        public ushort Reserved3;
        public IntPtr Value;
        public IntPtr Padding;
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink { }

    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int maxPath, IntPtr findData, uint flags);
        void GetIDList(out IntPtr idl);
        void SetIDList(IntPtr idl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int maxName);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int maxPath);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int maxArgs);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int show);
        void SetShowCmd(int show);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder icon, int maxIcon, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string icon, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr hwnd, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    [ComImport, Guid("0000010b-0000-0000-C000-000000000046"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPersistFile
    {
        void GetClassID(out Guid classId);
        [PreserveSig] int IsDirty();
        void Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
        void Save([MarshalAs(UnmanagedType.LPWStr)] string? file, [MarshalAs(UnmanagedType.Bool)] bool remember);
        void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
        void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SetCurrentProcessExplicitAppUserModelID(
        [MarshalAs(UnmanagedType.LPWStr)] string appId);

    /// <summary>
    /// A PROPVARIANT holding a string, built by hand.
    ///
    /// This was `InitPropVariantFromString` from propsys.dll, which shipped in
    /// 1.3.0 and never once worked: that function is an inline helper in
    /// propvarutil.h, not an export of any DLL, so every call threw
    /// EntryPointNotFoundException. The exception was caught and logged one line
    /// deep, the app carried on, and the result was that no Start Menu shortcut
    /// was ever written by the release whose headline was that you could pin Tiro
    /// to the taskbar. Nothing failed loudly enough to notice.
    ///
    /// What the helper does is two lines: VT_LPWSTR, and a copy of the string in
    /// memory the shell's allocator owns, which is what lets PropVariantClear
    /// free it. Doing it here removes the dependency rather than guessing at
    /// another entry point.
    /// </summary>
    private static PropVariant StringPropVariant(string value) => new()
    {
        Vt = 31, // VT_LPWSTR
        Value = Marshal.StringToCoTaskMemUni(value),
    };

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant variant);
}
