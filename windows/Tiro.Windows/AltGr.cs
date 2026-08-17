using System.Runtime.InteropServices;

namespace Tiro.Windows;

/// <summary>
/// Whether Right Alt is AltGr on this machine, and what to do about it (AUDIT
/// WIN-01).
///
/// On German, French, Spanish, Portuguese, Polish, Czech, Turkish and the Nordic
/// layouts, Right Alt is AltGr: it is how you type @ € { } [ ] \ and ~. The
/// default hotkey is Right Alt and the hook swallowed every matching key event,
/// so installing Tiro with defaults made those characters untypable in every
/// application on the machine, for as long as Tiro was running. The symptom
/// (cannot type @ in my email client) is almost impossible to connect back to
/// the cause (a dictation app in the tray).
///
/// Not swallowing it is not the fix, though it is the obvious one. AltGr used
/// for typing is a *tap* of Right Alt, well under the tap threshold, and a tap
/// is what puts the web core into hands-free recording. Passing the key through
/// would keep @ typable and start a take every single time someone typed it.
/// The two uses cannot share the key, so on these layouts Right Alt is not
/// offered as a hotkey at all.
///
/// The test is over *every installed layout*, not the one in the foreground.
/// Layouts are per-window on Windows, so a foreground test would arm and disarm
/// the hotkey as the user alt-tabbed between a German document and an English
/// browser, which is worse than either answer taken consistently.
/// </summary>
static class AltGr
{
    /// <summary>The hotkey to actually use, given what the user asked for and
    /// whether this machine has an AltGr layout installed.
    ///
    /// Pure, and separated from the detection above so `--self-test` can pin it
    /// down: the substitution is the part that decides whether a European user
    /// can type, and it must not be able to drift.</summary>
    public static string SafeHotkey(string requested, bool altGrPresent)
    {
        if (!altGrPresent) return requested;
        if (!string.Equals(requested, "AltRight", StringComparison.Ordinal)) return requested;
        // Scroll Lock is the one key in the list with no competing use. Right
        // Shift would swallow capitals typed with the right hand and Caps Lock
        // is already flagged as advanced, so both would trade this bug for a
        // smaller version of itself. A keyboard without a Scroll Lock key
        // leaves the button in the app working, and Settings is one click from
        // the message the user is shown when this fires.
        return "ScrollLock";
    }

    private static bool? _present;

    // Per layout, because the answer for one never changes and the scan is the
    // expensive part. This is what lets Recheck run on the hook's watchdog: a
    // recheck with no new layout installed is one GetKeyboardLayoutList and a
    // few dictionary lookups, while a genuinely new layout pays the scan once.
    private static readonly Dictionary<IntPtr, bool> _byLayout = new();

    /// <summary>True if any installed keyboard layout uses AltGr.</summary>
    public static bool IsPresent()
    {
        if (_present is bool known) return known;
        bool present;
        try
        {
            present = Detect();
        }
        catch (Exception ex)
        {
            // Unreachable in practice, but guessing "no AltGr" is the guess that
            // breaks typing across the whole machine, so guess the other way.
            Log.Write($"AltGr detection failed, assuming present: {ex.Message}");
            present = true;
        }
        _present = present;
        return present;
    }

    /// <summary>Re-read the installed layouts. Someone who has just added a
    /// German keyboard to a running copy of Tiro is exactly the person about to
    /// lose the @ key, and without this the answer would stay frozen at whatever
    /// was true when the app started. Returns true if it changed.</summary>
    public static bool Recheck()
    {
        var before = _present;
        _present = null;
        var now = IsPresent();
        if (before is bool was && was == now) return false;
        Log.Write($"AltGr layout installed: {now}");
        return true;
    }

    private static bool Detect()
    {
        var count = GetKeyboardLayoutList(0, null);
        if (count <= 0) return false;
        var list = new IntPtr[count];
        count = GetKeyboardLayoutList(count, list);

        for (int i = 0; i < count && i < list.Length; i++)
        {
            var hkl = list[i];
            if (!_byLayout.TryGetValue(hkl, out var uses))
            {
                uses = UsesAltGr(hkl);
                _byLayout[hkl] = uses;
            }
            if (uses) return true;
        }
        return false;
    }

    /// <summary>Does this layout put any character behind Ctrl+Alt? VkKeyScanEx
    /// returns the shift state in its high byte, and bit 1 (Ctrl) plus bit 2
    /// (Alt) together is what AltGr is, at the level Windows models it.</summary>
    private static bool UsesAltGr(IntPtr hkl)
    {
        foreach (var ch in Probe())
        {
            var scan = VkKeyScanEx(ch, hkl);
            if (scan == -1) continue;               // not typable on this layout
            var shift = (scan >> 8) & 0xFF;
            if ((shift & 0x06) == 0x06) return true; // Ctrl+Alt
        }
        return false;
    }

    /// <summary>The characters worth asking about.
    ///
    /// Latin-1 alone is not enough and the gap is not academic: on Polish,
    /// everything behind AltGr is a letter like ą or ż, which live in Latin
    /// Extended-A above U+00FF. A scan that stopped at 255 would report Polish
    /// as having no AltGr and hand those users the exact bug this file exists
    /// to fix. The euro sign is out on its own and is the single most common
    /// AltGr character in Europe, so it is named explicitly.</summary>
    private static IEnumerable<char> Probe()
    {
        for (char c = ' '; c <= 0xFF; c++) yield return c;        // ASCII and Latin-1
        for (char c = (char)0x100; c <= 0x24F; c++) yield return c; // Latin Extended-A and B
        yield return '€';                                     // €
    }

    [DllImport("user32.dll")]
    private static extern int GetKeyboardLayoutList(int nBuff, [Out] IntPtr[]? lpList);

    [DllImport("user32.dll")]
    private static extern short VkKeyScanEx(char ch, IntPtr dwhkl);
}
