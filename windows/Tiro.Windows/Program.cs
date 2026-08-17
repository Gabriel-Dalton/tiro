namespace Tiro.Windows;

static class Program
{
    // Setup.IsInstanceRunning probes this to find out whether a copy is running
    // before it replaces the installed EXE, so it cannot stay private.
    public const string MutexName = @"Local\TiroWindowsSingleInstance";
    private const string ShowEventName = @"Local\TiroWindowsShow";

    [STAThread]
    static void Main()
    {
        var argv = Environment.GetCommandLineArgs();

        // CI runs this after the build. It touches no window, no hook and no
        // mutex, so it must come before all of them.
        if (argv.Contains("--self-test"))
        {
            Environment.Exit(SelfTest.Run());
        }

        // Before anything that puts a window on screen: TaskDialog throws
        // without visual styles, and both the setup and uninstall prompts are
        // TaskDialogs that run before Application.Run ever does.
        ApplicationConfiguration.Initialize();

        // What Apps and Features launches. Ahead of the mutex because it has to
        // be able to stop the running copy, not queue behind it.
        if (argv.Contains("--uninstall"))
        {
            Setup.Uninstall(quiet: argv.Contains("--quiet"));
            return;
        }

        // Also ahead of the mutex, and for the same reason. Installing is
        // replacing the EXE a running copy is executing, so this has to be able
        // to ask that copy to quit. Behind the mutex it would instead be treated
        // as a second launch, poke the old version's window open, and exit,
        // which is precisely what a freshly downloaded update did before: you
        // ran the new release and the old one waved back at you.
        if (Setup.MaybeInstall()) return;

        bool relaunchInstalled;

        // The explicit scope is load-bearing. Everything below has to have let go
        // of the single-instance mutex before the relaunch at the end, or the
        // copy it starts sees a Tiro already running and exits on the spot.
        {
            // Single instance via a named mutex: two copies fighting over the mic
            // crashed upstream on macOS. Second launch pokes the first and exits.
            using var mutex = new Mutex(initiallyOwned: true, MutexName, out bool isFirst);
            using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
            if (!isFirst)
            {
                showEvent.Set(); // ask the running instance to open its window
                return;
            }

            // Created only by the instance that is going to run, so that a copy
            // preparing to install can tell "nobody is home" from "somebody is,
            // and is holding the file I am about to overwrite".
            using var quitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Setup.QuitEventName);

            Log.Write($"Tiro {Build.Version} starting");
            // --tray is what the autostart Run entry passes: start minimised to the tray
            bool startHidden = argv.Contains("--tray");
            var tray = new TrayContext(showEvent, quitEvent, startHidden);
            Application.Run(tray);
            relaunchInstalled = tray.RelaunchInstalled;
        }

        // Installed itself from the tray menu and quit so the copy in the Start
        // menu can take over. Handing off rather than staying put is what makes
        // the taskbar pin the user creates next point at the permanent file.
        if (relaunchInstalled)
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(Setup.InstalledExe)
                {
                    UseShellExecute = true,
                    WorkingDirectory = Setup.InstallDir,
                });
            }
            catch (Exception ex)
            {
                Log.Write($"could not start the installed copy: {ex.Message}");
            }
        }
    }
}
