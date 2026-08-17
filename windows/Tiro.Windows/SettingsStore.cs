using System.Text.Json;
using Microsoft.Win32;

namespace Tiro.Windows;

class AppSettings
{
    // Right Alt by default. Fn is invisible to Windows (firmware-resolved, no
    // scan code, RESEARCH.md #8) so upstream's default cannot port, and Right
    // Ctrl is avoided deliberately: it is half of the Right Ctrl + Scroll Lock
    // crash-dump keystroke armed on this machine.
    public string HotkeyCode { get; set; } = "AltRight";
    public bool Autostart { get; set; } = false;

    // Whether the Start Menu shortcut has ever been written. Checked rather
    // than the file itself, because the answer to "the shortcut is missing" is
    // not always "write it": someone who deleted it meant it, and an app that
    // puts it back on every launch is one you cannot get out of your Start
    // Menu. Written once; the tray item rewrites it on request after that.
    public bool StartMenuShortcut { get; set; } = false;

    // Nothing installs this app, so nothing updates it either. On by default,
    // because a portable app that never mentions its own releases leaves people
    // running a version with a fixed bug still in it. What the check does and
    // does not send is documented in full in UpdateCheck.cs, and the tray menu
    // turns it off for anyone who would rather it did not.
    public bool CheckForUpdates { get; set; } = true;

    // UTC, so a laptop crossing a timezone does not check twice or skip a week.
    public DateTime? LastUpdateCheckUtc { get; set; }

    // What the last successful check found, so the tray menu can still say
    // "New version 1.3.0" on the six days it does not check. Without this the
    // news appeared for one launch and then vanished until the next week.
    public string? LastKnownVersion { get; set; }

    // The version we have already interrupted someone about. Once per version
    // means once, not once a week for as long as they decline it.
    public string? AnnouncedVersion { get; set; }

    // Whether the first-run offer to install has been turned down for good.
    // Somebody who wants Tiro portable, on a USB stick or in a folder they sync,
    // should be asked once and then left alone; a prompt that returns every
    // launch is one people learn to dismiss without reading.
    public bool SetupDeclined { get; set; } = false;

    // A check that could not reach GitHub does not reset the weekly clock, so
    // this is what stops a blocked or rate-limited machine trying again on every
    // single launch.
    public DateTime? LastUpdateAttemptUtc { get; set; }
}

static class SettingsStore
{
    private static readonly string SettingsPath = Path.Combine(Log.AppDataDir, "settings.json");
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValue = "Tiro";

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(SettingsPath))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(SettingsPath)) ?? new AppSettings();
        }
        catch (Exception ex)
        {
            Log.Write($"SettingsStore.Load failed: {ex.Message}");
        }
        return new AppSettings();
    }

    // The weekly update check completes on a threadpool thread and writes here,
    // while the tray menu writes from the UI thread. Two WriteAllText calls
    // overlapping means one of them throws on the file share and the setting it
    // was saving is lost, silently, because the catch below logs and moves on.
    private static readonly object SaveGate = new();

    public static void Save(AppSettings settings)
    {
        try
        {
            lock (SaveGate)
            {
                Directory.CreateDirectory(Log.AppDataDir);
                File.WriteAllText(SettingsPath, JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }));
            }
        }
        catch (Exception ex)
        {
            Log.Write($"SettingsStore.Save failed: {ex.Message}");
        }
    }

    /// <summary>Autostart via the per-user Run key; off by default (SPEC-WINDOWS 4.3).</summary>
    public static void SetAutostart(bool enabled) => SetAutostart(enabled, Application.ExecutablePath);

    /// <summary>
    /// The overload exists for install and uninstall, which need to write a path
    /// that is not the one this process is running from: the copy doing the
    /// installing lives in Downloads, and the Run key has to name the copy that
    /// will still be there tomorrow. Storing the running path there was how
    /// autostart quietly stopped working the first time somebody moved the EXE.
    /// </summary>
    public static void SetAutostart(bool enabled, string exePath)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
            if (key == null) return;
            if (enabled) key.SetValue(RunValue, $"\"{exePath}\" --tray");
            else key.DeleteValue(RunValue, throwOnMissingValue: false);
        }
        catch (Exception ex)
        {
            Log.Write($"SetAutostart failed: {ex.Message}");
        }
    }
}
