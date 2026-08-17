using Microsoft.Web.WebView2.Core;

namespace Tiro.Windows;

/// <summary>
/// `Tiro.exe --self-test` — assertions over the pure logic in this app, run by
/// CI on the Windows runner right after the build.
///
/// There is no unit-test project on purpose: this is a shell around the web
/// core, and everything else it does (hooks, SendInput, DPAPI, the tray) needs a
/// desktop session and a human to mean anything, which is why the real testing
/// lives in scripts/smoke-web.mjs and in using it. What is left over is a small
/// amount of logic that can be quietly, permanently wrong — version comparison
/// being the classic one, where a string compare says 1.9.0 beats 1.10.0 and
/// every user stops being told about updates. That much is worth pinning down.
///
/// A WinExe has no console attached, so results go to the log file and the
/// verdict is the exit code: 0 for pass, 1 for fail.
/// </summary>
static class SelfTest
{
    public static int Run()
    {
        var failures = 0;

        void Check(string name, bool ok)
        {
            Log.Write($"self-test {(ok ? "ok  " : "FAIL")} {name}");
            if (!ok) failures++;
        }

        // Ordinary comparisons
        Check("a later patch is newer", UpdateCheck.IsNewer("1.0.2", "1.0.1"));
        Check("a later minor is newer", UpdateCheck.IsNewer("1.1.0", "1.0.9"));
        Check("a later major is newer", UpdateCheck.IsNewer("2.0.0", "1.9.9"));
        Check("the same version is not newer", !UpdateCheck.IsNewer("1.1.0", "1.1.0"));
        Check("an older version is not newer", !UpdateCheck.IsNewer("1.0.0", "1.1.0"));

        // The one everybody gets wrong: 10 sorts before 9 as text.
        Check("1.10.0 is newer than 1.9.0", UpdateCheck.IsNewer("1.10.0", "1.9.0"));
        Check("1.9.0 is not newer than 1.10.0", !UpdateCheck.IsNewer("1.9.0", "1.10.0"));
        Check("1.0.10 is newer than 1.0.9", UpdateCheck.IsNewer("1.0.10", "1.0.9"));

        // A "v" prefix survives whether or not the caller trimmed it
        Check("a v prefix is tolerated", UpdateCheck.IsNewer("v1.2.0", "1.1.0"));

        // Anything unparseable must mean "no update", never "update every week"
        Check("null is not newer", !UpdateCheck.IsNewer(null, "1.0.0"));
        Check("empty is not newer", !UpdateCheck.IsNewer("", "1.0.0"));
        Check("a two-part version is not newer", !UpdateCheck.IsNewer("1.2", "1.0.0"));
        Check("a nightly tag is not newer", !UpdateCheck.IsNewer("nightly", "1.0.0"));
        Check("a pre-release suffix is not newer", !UpdateCheck.IsNewer("1.2.0-beta1", "1.1.0"));
        Check("an unparseable current version is not overtaken", !UpdateCheck.IsNewer("1.2.0", "dev"));

        // The version the EXE reports has to be comparable, or none of the above
        // is reachable in the app that ships.
        Check("this build's own version parses", !UpdateCheck.IsNewer(Build.Version, Build.Version)
            && UpdateCheck.IsNewer("999.0.0", Build.Version));

        // What is worth interrupting someone over. Getting this wrong is not a
        // crash, it is either nagging people over a typo or never telling them
        // about a release that added the thing they wanted.
        Check("a new minor is a feature",
            UpdateCheck.Classify("1.3.0", "1.2.0") == UpdateCheck.Worth.Feature);
        Check("a new major is a feature",
            UpdateCheck.Classify("2.0.0", "1.9.9") == UpdateCheck.Worth.Feature);
        Check("one patch is quiet",
            UpdateCheck.Classify("1.2.1", "1.2.0") == UpdateCheck.Worth.Quiet);
        Check("two patches have piled up",
            UpdateCheck.Classify("1.2.2", "1.2.0") == UpdateCheck.Worth.Fixes);
        Check("five patches have piled up",
            UpdateCheck.Classify("1.2.5", "1.2.0") == UpdateCheck.Worth.Fixes);
        Check("the same version is nothing",
            UpdateCheck.Classify("1.2.0", "1.2.0") == UpdateCheck.Worth.None);
        Check("an older release is nothing",
            UpdateCheck.Classify("1.1.9", "1.2.0") == UpdateCheck.Worth.None);
        Check("an older major is nothing, however high its minor",
            UpdateCheck.Classify("1.99.0", "2.0.0") == UpdateCheck.Worth.None);
        Check("an unparseable tag is nothing",
            UpdateCheck.Classify("nightly", "1.2.0") == UpdateCheck.Worth.None);
        Check("1.10.0 over 1.9.0 is a feature, not a downgrade",
            UpdateCheck.Classify("1.10.0", "1.9.0") == UpdateCheck.Worth.Feature);

        // ------------------------------------------------------- distribution
        // The download is a single EXE, so everything the app needs at runtime
        // has to be inside it. A build that dropped the web core would start,
        // show an empty white window and look like a crash with no error, which
        // is the kind of thing you find out about from a user rather than a
        // build. These assertions are cheap and they run on the shipped binary.

        Check("the web core is embedded", Resources.EmbeddedWebFileCount() >= 20);
        Check("index.html is embedded", Resources.HasEmbedded("web/index.html"));
        Check("a nested source file is embedded", Resources.HasEmbedded("web/src/app.js"));
        Check("the window icon is embedded", Resources.LoadIcon("tiro.ico") != null);
        Check("the four tray icons are embedded",
            Resources.LoadIcon("tray-idle.ico") != null &&
            Resources.LoadIcon("tray-recording.ico") != null &&
            Resources.LoadIcon("tray-transcribing.ico") != null &&
            Resources.LoadIcon("tray-blocked.ico") != null);

        // The one dependency that is not managed code: WebView2's native loader.
        //
        // Asked twice, because the interesting question cannot be answered by
        // running the app. A build agent can resolve a WebView2Loader.dll from
        // elsewhere on the machine, so "the call works" passed on CI for a build
        // that shipped without one and threw DllNotFoundException on the first
        // clean PC it reached. Whether the loader is in this EXE is the part no
        // amount of runner luck can fake, so it is its own assertion.
        Check("WebView2's native loader is embedded", Resources.HasEmbedded("native/WebView2Loader.dll"));

        // And then that it actually loaded: GetAvailableBrowserVersionString is the
        // P/Invoke into it, so it is the first thing that fails if
        // Resources.EnsureNativeLoader did not get the DLL into the process. CI
        // runs this from a folder holding nothing but Tiro.exe.
        //
        // A missing runtime is a different answer from a missing loader and only
        // one of them is a packaging fault: Windows 10 without Edge legitimately
        // has no runtime, which the app already handles by offering the download.
        try
        {
            var runtime = CoreWebView2Environment.GetAvailableBrowserVersionString();
            Check($"WebView2's native loader resolves (runtime {runtime})", true);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            Check("WebView2's native loader resolves (no runtime installed, which is not ours)", true);
        }
        catch (Exception ex)
        {
            // DllNotFoundException here means the loader is not in the bundle and
            // the download is broken for everyone. Anything else is worth seeing.
            Check($"WebView2's native loader resolves ({ex.GetType().Name}: {ex.Message})", false);
        }

        // Embedded is not the same as served. Extraction is the step in between,
        // and it is where a build-machine path separator can quietly flatten
        // web/src/app.js into a file called "src\app.js" sitting in the root.
        var webRoot = Resources.EnsureWebRoot();
        Check("the web core extracts to disk", File.Exists(Path.Combine(webRoot, "index.html")));
        Check("nested files keep their folder", File.Exists(Path.Combine(webRoot, "src", "app.js")));
        Check("a second extraction is a no-op, not a wipe",
            Resources.EnsureWebRoot() == webRoot && File.Exists(Path.Combine(webRoot, "index.html")));

        // Where a copy of Tiro decides it lives. Both ways of getting this wrong
        // are silent: too eager and a winget-managed copy moves itself out from
        // under the package manager that is supposed to upgrade it, too shy and
        // nobody is ever offered the install and everyone stays in Downloads.
        Check("the same path in different case is the same file",
            Setup.SamePath(@"C:\Users\a\Tiro.exe", @"c:\users\a\tiro.exe"));
        Check("a trailing separator does not make a different path",
            Setup.SamePath(@"C:\Users\a", @"C:\Users\a\"));
        Check("different files are not the same path",
            !Setup.SamePath(@"C:\Users\a\Tiro.exe", @"C:\Users\b\Tiro.exe"));
        Check("a missing path matches nothing",
            !Setup.SamePath(null, @"C:\Tiro.exe") && !Setup.SamePath(@"C:\Tiro.exe", ""));

        const string WingetCopy =
            @"C:\Users\a\AppData\Local\Microsoft\WinGet\Packages\GabrielDalton.Tiro\Tiro.exe";
        Check("a winget package is somebody else's to manage", Setup.IsManagedLocation(WingetCopy));
        Check("Program Files is somebody else's to manage",
            Setup.IsManagedLocation(@"C:\Program Files\Tiro\Tiro.exe"));
        Check("Downloads is nobody's to manage",
            !Setup.IsManagedLocation(@"C:\Users\a\Downloads\Tiro.exe"));
        Check("a folder merely named like Program Files is not Program Files",
            !Setup.IsManagedLocation(@"C:\Users\a\My Program Files Backup\Tiro.exe"));

        Check("a fresh download is offered the install",
            Setup.ShouldOffer(@"C:\Users\a\Downloads\Tiro.exe", declined: false));
        Check("declining is remembered",
            !Setup.ShouldOffer(@"C:\Users\a\Downloads\Tiro.exe", declined: true));
        Check("the installed copy does not offer to install itself",
            !Setup.ShouldOffer(Setup.InstalledExe, declined: false));
        Check("a winget copy is never offered the install",
            !Setup.ShouldOffer(WingetCopy, declined: false));
        Check("an unknown location is never offered the install",
            !Setup.ShouldOffer(null, declined: false) && !Setup.ShouldOffer("  ", declined: false));

        // WIN-01. Which key Tiro takes on an AltGr layout. Getting this wrong
        // does not fail visibly in Tiro at all: it makes @ € { } [ ] and ~
        // untypable in every other application on the machine, which nobody
        // will connect back to a dictation app in the tray. The detection needs
        // a desktop session and real layouts, so it is not testable here, but
        // the substitution it feeds is pure and is the part that must not drift.
        Check("Right Alt is refused on an AltGr layout",
            AltGr.SafeHotkey("AltRight", true) == "ScrollLock");
        Check("Right Alt is kept where it is not AltGr",
            AltGr.SafeHotkey("AltRight", false) == "AltRight");
        // Only Right Alt is affected. Substituting a key the user deliberately
        // chose, for a problem that key does not have, is its own bug.
        Check("Scroll Lock is left alone on an AltGr layout",
            AltGr.SafeHotkey("ScrollLock", true) == "ScrollLock");
        Check("Caps Lock is left alone on an AltGr layout",
            AltGr.SafeHotkey("CapsLock", true) == "CapsLock");
        Check("Right Shift is left alone on an AltGr layout",
            AltGr.SafeHotkey("ShiftRight", true) == "ShiftRight");
        Check("Right Ctrl is left alone on an AltGr layout",
            AltGr.SafeHotkey("ControlRight", true) == "ControlRight");
        // The substitution has to land on something the hook can actually arm,
        // or the fix for WIN-01 is a hotkey that never fires.
        Check("the substitute is a key the hook knows",
            KeyboardHook.CodeToVk.ContainsKey(AltGr.SafeHotkey("AltRight", true)));

        Log.Write(failures == 0 ? "self-test passed" : $"self-test: {failures} failure(s)");
        return failures == 0 ? 0 : 1;
    }
}
