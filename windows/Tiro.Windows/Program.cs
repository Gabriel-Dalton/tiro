namespace Tiro.Windows;

static class Program
{
    private const string MutexName = @"Local\TiroWindowsSingleInstance";
    private const string ShowEventName = @"Local\TiroWindowsShow";

    [STAThread]
    static void Main()
    {
        // CI runs this after the build. It touches no window, no hook and no
        // mutex, so it must come before all of them.
        if (Environment.GetCommandLineArgs().Contains("--self-test"))
        {
            Environment.Exit(SelfTest.Run());
        }

        // Single instance via a named mutex: two copies fighting over the mic
        // crashed upstream on macOS. Second launch pokes the first and exits.
        using var mutex = new Mutex(initiallyOwned: true, MutexName, out bool isFirst);
        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        if (!isFirst)
        {
            showEvent.Set(); // ask the running instance to open its window
            return;
        }

        Log.Write($"Tiro {Build.Version} starting");
        ApplicationConfiguration.Initialize();
        // --tray is what the autostart Run entry passes: start minimised to the tray
        bool startHidden = Environment.GetCommandLineArgs().Contains("--tray");
        Application.Run(new TrayContext(showEvent, startHidden));
    }
}
