namespace Tiro.Windows;

static class Program
{
    private const string MutexName = @"Local\TiroWindowsSingleInstance";
    private const string ShowEventName = @"Local\TiroWindowsShow";

    [STAThread]
    static void Main()
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

        Log.Write("Tiro starting");
        ApplicationConfiguration.Initialize();
        // --tray is what the autostart Run entry passes: start minimised to the tray
        bool startHidden = Environment.GetCommandLineArgs().Contains("--tray");
        Application.Run(new TrayContext(showEvent, startHidden));
    }
}
