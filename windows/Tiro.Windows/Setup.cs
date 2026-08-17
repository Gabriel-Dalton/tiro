using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace Tiro.Windows;

/// <summary>
/// Putting Tiro somewhere it can live, on the first run from wherever it was
/// downloaded to.
///
/// There is still no MSI and no wizard, for the reasons docs/PACKAGING.md gives:
/// Tiro registers no services and no file associations, and autostart is a tray
/// toggle rather than an install-time decision. What it did not have was any
/// answer to "where does this app live", and that turned out to matter far more
/// than the missing installer did.
///
/// What people actually hit: the download was a ZIP, Explorer will happily run an
/// EXE from inside one by extracting it to %TEMP%, and so the app they thought
/// they had installed was a file Windows deletes. Pin it to the taskbar and the
/// pin points at a temp path that is gone by the next reboot. Every launch meant
/// finding the ZIP again. The download is one EXE now, which fixes half of it;
/// this file is the other half, so that the EXE ends up somewhere permanent, in
/// the Start menu where it can be searched and pinned, and in Apps and Features
/// where it can be removed like anything else.
///
/// Per-user throughout: %LOCALAPPDATA%\Programs is the directory Windows means
/// for exactly this, and it needs no administrator rights, so installing never
/// raises a UAC prompt. Nothing is written outside the user's own profile.
/// </summary>
static class Setup
{
    /// <summary>
    /// Signalled by a copy that is about to replace the installed EXE, so the
    /// running one can let go of the file. See StopRunningInstance.
    /// </summary>
    public const string QuitEventName = @"Local\TiroWindowsQuit";

    public static readonly string InstallDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Tiro");

    public static string InstalledExe => Path.Combine(InstallDir, "Tiro.exe");

    private const string UninstallKey =
        @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Tiro";

    // ------------------------------------------------------------ pure logic
    // Everything below this line up to MaybeInstall touches no disk and no
    // registry, so SelfTest can assert it. The install decision is exactly the
    // kind of thing that fails silently in the wrong direction: get it wrong one
    // way and a winget-managed copy tries to install itself over the top of the
    // package manager, get it wrong the other and nobody is ever offered it.

    /// <summary>Two paths naming the same file, whatever their casing or trailing slash.</summary>
    public static bool SamePath(string? a, string? b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return false;
        try
        {
            return string.Equals(
                Path.GetFullPath(a).TrimEnd(Path.DirectorySeparatorChar),
                Path.GetFullPath(b).TrimEnd(Path.DirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Something else already owns this copy. winget puts portable packages under
    /// its own Packages folder and keeps a shim on PATH pointing into it; moving
    /// the EXE out from under it would leave winget upgrading and uninstalling a
    /// file that is no longer there. Program Files means an administrator put it
    /// there. In both cases the right thing to do is nothing.
    /// </summary>
    public static bool IsManagedLocation(string? exePath)
    {
        if (string.IsNullOrWhiteSpace(exePath)) return false;
        var path = exePath.Replace('/', '\\');
        string[] markers =
        {
            @"\Microsoft\WinGet\",
            @"\WinGet\Packages\",
            @"\Program Files\",
            @"\Program Files (x86)\",
            @"\Chocolatey\",
            @"\scoop\apps\",
        };
        foreach (var marker in markers)
        {
            if (path.Contains(marker, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    public static bool IsInstalled(string? exePath) => SamePath(exePath, InstalledExe);

    /// <summary>
    /// Whether to put the question in front of somebody. Declining is remembered,
    /// because a prompt that comes back every launch is worse than no prompt: it
    /// trains people to dismiss it without reading, and the app already has one
    /// thing it needs them to read (the API key).
    /// </summary>
    /// <summary>
    /// Not knowing where this process is running from is a reason to do nothing,
    /// not a reason to guess: an install that copies from a path it could not
    /// determine is an install that writes the wrong file somewhere permanent.
    /// </summary>
    public static bool ShouldOffer(string? exePath, bool declined) =>
        !string.IsNullOrWhiteSpace(exePath)
        && !declined
        && !IsInstalled(exePath)
        && !IsManagedLocation(exePath);

    // ------------------------------------------------------------- first run

    private enum Choice { Install, NotNow, Never }

    /// <summary>
    /// Returns true if this process has done its job and should exit, which is
    /// the case when it has installed a copy and handed over to it.
    /// </summary>
    public static bool MaybeInstall()
    {
        var exePath = Environment.ProcessPath;
        var settings = SettingsStore.Load();
        if (!ShouldOffer(exePath, settings.SetupDeclined)) return false;

        switch (Ask(exePath!))
        {
            case Choice.Never:
                settings.SetupDeclined = true;
                SettingsStore.Save(settings);
                Log.Write("setup declined for good; running in place from now on");
                return false;

            case Choice.NotNow:
                Log.Write("setup postponed; running in place this time");
                return false;

            default:
                return Install(exePath!, settings);
        }
    }

    private static Choice Ask(string exePath)
    {
        // Name the folder it is actually in rather than assuming Downloads. If
        // Explorer ran it out of a ZIP this reads as a Temp path, which is the
        // clearest possible statement of why the prompt is worth reading.
        var from = Path.GetDirectoryName(exePath) ?? exePath;

        var install = new TaskDialogCommandLinkButton(
            "Install Tiro",
            "Adds it to your Start menu, so you can pin it to the taskbar. Takes a second.");
        var notNow = new TaskDialogCommandLinkButton(
            "Not now",
            "Run it from where it is. You will be asked again next time.");
        var never = new TaskDialogCommandLinkButton(
            "Keep it portable",
            "Run it from where it is and stop asking. The tray menu can still install it later.");

        var page = new TaskDialogPage
        {
            Caption = "Tiro",
            Heading = "Install Tiro on this PC?",
            Text = $"Tiro is running from {from}. Installing it means it keeps working after "
                 + "that folder is cleared out, and it shows up in the Start menu, which is "
                 + "where Windows lets you pin it to the taskbar.",
            Icon = TaskDialogIcon.Information,
            Buttons = { install, notNow, never },
            AllowCancel = true,
            DefaultButton = install,
            Footnote = new TaskDialogFootnote(
                $"It goes in {InstallDir}. No administrator rights are needed, and nothing is "
                + "written outside your own user account. Remove it later from Apps and Features."),
        };

        try
        {
            var clicked = TaskDialog.ShowDialog(page);
            if (clicked == install) return Choice.Install;
            if (clicked == never) return Choice.Never;
            return Choice.NotNow; // "Not now", Escape and the close button all mean the same
        }
        catch (Exception ex)
        {
            // A dialog that will not open must not stop the app starting.
            Log.Write($"the setup prompt failed to open: {ex.Message}");
            return Choice.NotNow;
        }
    }

    // -------------------------------------------------------------- install

    private static bool Install(string exePath, AppSettings settings)
    {
        try
        {
            // A running copy has the target EXE open, and on Windows that means
            // the copy below fails rather than queues. This is also the upgrade
            // path: download the new release, run it, and the old one is asked to
            // stand down before it is replaced.
            if (!StopRunningInstance(TimeSpan.FromSeconds(10)))
            {
                Warn("Tiro is already running",
                     "Quit it first: right-click the Tiro icon in the system tray and choose "
                     + "Quit, then run this file again.");
                return true;
            }

            WriteInstallation(exePath);

            // The Run key stores a path, so autostart would still be pointing at
            // the download after this. Re-point it at the copy that is going to
            // survive, but only if it was switched on.
            if (settings.Autostart) SettingsStore.SetAutostart(true, InstalledExe);

            Log.Write($"installed to {InstalledExe}");

            Process.Start(new ProcessStartInfo(InstalledExe)
            {
                UseShellExecute = true,
                WorkingDirectory = InstallDir,
            });
            return true;
        }
        catch (Exception ex)
        {
            Log.Write($"install failed: {ex.Message}");
            Warn("Tiro could not install itself",
                 $"{ex.Message}\n\nIt will start from where it is instead, which works fine. "
                 + "You can move the file anywhere you like and run it from there.");
            return false; // carry on and run in place; a failed install is not a dead app
        }
    }

    private static void WriteInstallation(string exePath)
    {
        Directory.CreateDirectory(InstallDir);
        CopyWithRetry(exePath, InstalledExe);
        Unblock(InstalledExe);

        // Pointed at the copy just written rather than at this process, which is
        // still the download. Worth saying because the failure is quiet: a
        // shortcut to the file in Downloads survives being installed and then
        // stops working the day that folder is cleared out, which is the exact
        // complaint installing was supposed to answer.
        if (StartMenu.EnsureShortcutFor(InstalledExe))
        {
            // The app writes this shortcut on first run too, and remembers having
            // done it so that deleting it sticks. Record it here as well, or the
            // installed copy rewrites it on next launch and a user who removed it
            // gets it back.
            var settings = SettingsStore.Load();
            if (!settings.StartMenuShortcut)
            {
                settings.StartMenuShortcut = true;
                SettingsStore.Save(settings);
            }
        }

        WriteUninstallEntry();
    }

    /// <summary>
    /// The tray menu's way in, for anyone who said "not now" on the first run,
    /// or picked portable and later changed their mind. Without it the only way
    /// back from "keep it portable" is editing settings.json, which is not a
    /// route anybody should have to find.
    ///
    /// Unlike the first-run path this runs inside the app itself, which changes
    /// two things. It must not try to stop the running instance, because it is
    /// the running instance. And it cannot start the installed copy afterwards
    /// either: this process still holds the single-instance mutex, so the new
    /// one would see a Tiro already running, poke this window open and exit.
    /// Program.Main does the relaunch, once the mutex is genuinely released.
    ///
    /// Overwriting an existing installed EXE is safe here for the same reason:
    /// holding the mutex is proof that the copy in the Start menu is not
    /// running. A running image cannot be overwritten, but it can be read, which
    /// is what lets this copy itself.
    /// </summary>
    public static bool InstallInPlace()
    {
        var exePath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(exePath)) return false;

        try
        {
            WriteInstallation(exePath);

            var settings = SettingsStore.Load();
            if (settings.Autostart) SettingsStore.SetAutostart(true, InstalledExe);
            if (settings.SetupDeclined)
            {
                // They have just installed it, so the standing "stop asking" is
                // spent. Leaving it set would silently suppress the prompt if
                // they ever went back to a portable copy.
                settings.SetupDeclined = false;
                SettingsStore.Save(settings);
            }

            Log.Write($"installed to {InstalledExe} from the tray menu");
            return true;
        }
        catch (Exception ex)
        {
            Log.Write($"install from the tray menu failed: {ex.Message}");
            Warn("Tiro could not install itself",
                 $"{ex.Message}\n\nIt is still running from where it is, which works fine.");
            return false;
        }
    }

    /// <summary>
    /// True once nothing is holding the installed EXE. Program.Main owns the
    /// named mutex for the life of the app and a named kernel object dies with
    /// its last handle, so being unable to open it is the same as nobody being
    /// there.
    /// </summary>
    public static bool IsInstanceRunning()
    {
        try
        {
            if (Mutex.TryOpenExisting(Program.MutexName, out var existing))
            {
                existing.Dispose();
                return true;
            }
        }
        catch (Exception ex)
        {
            // An existing mutex we are not allowed to open still means somebody
            // is running, so this is the cautious answer rather than the tidy one.
            Log.Write($"could not probe for a running Tiro: {ex.Message}");
            return true;
        }
        return false;
    }

    private static bool StopRunningInstance(TimeSpan timeout)
    {
        if (!IsInstanceRunning()) return true;

        try
        {
            // Open, never create. Creating it here and leaving it signalled would
            // be inherited by the copy we are about to launch, which would then
            // quit itself the moment it started.
            if (EventWaitHandle.TryOpenExisting(QuitEventName, out var quit))
            {
                using (quit) quit.Set();
                Log.Write("asked the running Tiro to quit so it can be replaced");
            }
        }
        catch (Exception ex)
        {
            Log.Write($"could not signal the running Tiro: {ex.Message}");
        }

        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (!IsInstanceRunning()) return true;
            Thread.Sleep(100);
        }
        return !IsInstanceRunning();
    }

    /// <summary>
    /// Windows can hold an image open for a moment after the process that ran it
    /// has gone, so a copy straight after a clean shutdown still loses the race
    /// now and then. Retry rather than tell somebody their install failed.
    /// </summary>
    private static void CopyWithRetry(string from, string to)
    {
        Exception? last = null;
        for (var attempt = 0; attempt < 20; attempt++)
        {
            try
            {
                File.Copy(from, to, overwrite: true);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                last = ex;
                Thread.Sleep(250);
            }
        }
        throw last ?? new IOException($"could not copy {from} to {to}");
    }

    /// <summary>
    /// File.Copy brings NTFS alternate data streams with it, so the installed
    /// copy inherits the browser's Zone.Identifier and SmartScreen goes on
    /// interrupting every launch of an app the user explicitly chose to install.
    /// This is the same thing ticking Unblock in the file's Properties does, at
    /// the moment they asked for it. Nothing else about the file changes: an
    /// unsigned build stays unsigned, and docs/SIGNING.md still applies to the
    /// first launch, before any of this has happened.
    /// </summary>
    private static void Unblock(string path)
    {
        if (DeleteFileW(path + ":Zone.Identifier")) return;
        var error = Marshal.GetLastWin32Error();
        // 2 is ERROR_FILE_NOT_FOUND: there was no mark, which is the normal case
        // for a build that was not downloaded with a browser.
        if (error != 2) Log.Write($"could not clear the Mark of the Web: Win32 error {error}");
    }

    private static void WriteUninstallEntry()
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(UninstallKey);
            if (key == null) return;
            key.SetValue("DisplayName", "Tiro");
            key.SetValue("DisplayVersion", Build.Version);
            key.SetValue("Publisher", "Gabriel Dalton");
            key.SetValue("InstallLocation", InstallDir);
            key.SetValue("DisplayIcon", InstalledExe);
            key.SetValue("UninstallString", $"\"{InstalledExe}\" --uninstall");
            key.SetValue("QuietUninstallString", $"\"{InstalledExe}\" --uninstall --quiet");
            key.SetValue("URLInfoAbout", "https://github.com/Gabriel-Dalton/tiro");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            try
            {
                key.SetValue("EstimatedSize",
                    (int)(new FileInfo(InstalledExe).Length / 1024), RegistryValueKind.DWord);
            }
            catch
            {
                // cosmetic; Apps and Features just shows no size
            }
        }
        catch (Exception ex)
        {
            Log.Write($"writing the uninstall entry failed: {ex.Message}");
        }
    }

    // ------------------------------------------------------------ uninstall

    /// <summary>
    /// `Tiro.exe --uninstall`, which is what Apps and Features runs. Deliberately
    /// the same binary rather than a separate uninstaller: a second EXE would be
    /// a second thing to sign, and it would live in the folder it is trying to
    /// delete anyway.
    /// </summary>
    public static void Uninstall(bool quiet)
    {
        var alsoData = false;

        if (!quiet)
        {
            var remove = new TaskDialogButton("Remove Tiro");
            var keep = new TaskDialogButton("Cancel");
            var data = new TaskDialogVerificationCheckBox(
                "Also delete my history, settings and saved API key");

            var page = new TaskDialogPage
            {
                Caption = "Tiro",
                Heading = "Remove Tiro from this PC?",
                Text = "This deletes the app and its Start menu shortcut. Your dictation "
                     + "history, settings and API key are kept unless you tick the box below, "
                     + "so reinstalling picks up where you left off.",
                Icon = TaskDialogIcon.Warning,
                Buttons = { remove, keep },
                DefaultButton = keep,
                AllowCancel = true,
                Verification = data,
            };

            try
            {
                if (TaskDialog.ShowDialog(page) != remove) return;
                alsoData = data.Checked;
            }
            catch (Exception ex)
            {
                Log.Write($"the uninstall prompt failed to open: {ex.Message}");
                return; // never remove anything on the strength of a dialog nobody saw
            }
        }

        Log.Write($"uninstalling{(alsoData ? ", including user data" : "")}");
        StopRunningInstance(TimeSpan.FromSeconds(10));

        try { if (File.Exists(StartMenu.ShortcutPath)) File.Delete(StartMenu.ShortcutPath); }
        catch (Exception ex) { Log.Write($"removing the shortcut failed: {ex.Message}"); }

        // Removing the app un-remembers the shortcut, or a later portable copy
        // would decide one had already been written and never write its own.
        try
        {
            var settings = SettingsStore.Load();
            if (settings.StartMenuShortcut)
            {
                settings.StartMenuShortcut = false;
                SettingsStore.Save(settings);
            }
        }
        catch (Exception ex) { Log.Write($"could not forget the shortcut: {ex.Message}"); }

        SettingsStore.SetAutostart(false, InstalledExe);

        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, throwOnMissingSubKey: false); }
        catch (Exception ex) { Log.Write($"removing the uninstall entry failed: {ex.Message}"); }

        // The directories go last, and not from here: Windows will not let a
        // running image delete the folder it is running from, and this EXE is
        // exactly that when Apps and Features launched it. Hand the job to a cmd
        // that waits for this process to be gone first. ping is the wait because
        // timeout.exe wants a console, which a GUI-subsystem binary has none to
        // give it.
        var targets = new List<string> { InstallDir, Resources.CacheDir };
        if (alsoData) targets.Add(Log.AppDataDir);

        var script = new StringBuilder("/c ping -n 4 127.0.0.1 >nul");
        foreach (var dir in targets) script.Append($" & rmdir /s /q \"{dir}\" 2>nul");

        try
        {
            Process.Start(new ProcessStartInfo("cmd.exe", script.ToString())
            {
                CreateNoWindow = true,
                UseShellExecute = false,
            });
        }
        catch (Exception ex)
        {
            Log.Write($"could not schedule the folder removal: {ex.Message}");
        }
    }

    // -------------------------------------------------------------- plumbing

    private static void Warn(string heading, string text)
    {
        try
        {
            TaskDialog.ShowDialog(new TaskDialogPage
            {
                Caption = "Tiro",
                Heading = heading,
                Text = text,
                Icon = TaskDialogIcon.Warning,
                Buttons = { TaskDialogButton.OK },
            });
        }
        catch
        {
            // nothing useful left to do about a dialog that will not show
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteFileW(string fileName);
}
