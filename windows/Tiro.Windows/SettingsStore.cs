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

    // Nothing installs this app, so nothing updates it either. On by default,
    // because a portable app that never mentions its own releases leaves people
    // running a version with a fixed bug still in it. What the check does and
    // does not send is documented in full in UpdateCheck.cs, and the tray menu
    // turns it off for anyone who would rather it did not.
    public bool CheckForUpdates { get; set; } = true;

    // UTC, so a laptop crossing a timezone does not check twice or skip a week.
    public DateTime? LastUpdateCheckUtc { get; set; }
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

    public static void Save(AppSettings settings)
    {
        try
        {
            Directory.CreateDirectory(Log.AppDataDir);
            File.WriteAllText(SettingsPath, JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            Log.Write($"SettingsStore.Save failed: {ex.Message}");
        }
    }

    /// <summary>Autostart via the per-user Run key; off by default (SPEC-WINDOWS 4.3).</summary>
    public static void SetAutostart(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
            if (key == null) return;
            if (enabled) key.SetValue(RunValue, $"\"{Application.ExecutablePath}\" --tray");
            else key.DeleteValue(RunValue, throwOnMissingValue: false);
        }
        catch (Exception ex)
        {
            Log.Write($"SetAutostart failed: {ex.Message}");
        }
    }
}
