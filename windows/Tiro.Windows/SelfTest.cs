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

        Log.Write(failures == 0 ? "self-test passed" : $"self-test: {failures} failure(s)");
        return failures == 0 ? 0 : 1;
    }
}
