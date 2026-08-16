namespace Tiro.Windows;

/// <summary>
/// Tray lifecycle (SPEC-WINDOWS 4.3): icon reflecting the four states, a menu,
/// autostart toggle, and wiring between the keyboard hook and the web core.
/// </summary>
sealed class TrayContext : ApplicationContext
{
    private readonly NotifyIcon _tray = new();
    private readonly MainForm _mainForm;
    private readonly RecordingPill _pill = new();
    private readonly KeyboardHook _hook;
    private readonly AppSettings _settings;
    private readonly Dictionary<string, Icon> _stateIcons = new();
    private readonly RegisteredWaitHandle _showWait;

    public TrayContext(EventWaitHandle showEvent, bool startHidden)
    {
        _settings = SettingsStore.Load();
        _mainForm = new MainForm(_settings);
        _mainForm.StateChanged += OnStateChanged;
        _mainForm.RuntimeMissing += () =>
        {
            // Nothing can work without the WebView2 runtime, so show the blocked
            // icon and say so on hover rather than looking idle and ready.
            OnStateChanged("blocked");
            _tray.Text = $"Tiro {Build.Version}. WebView2 runtime missing.";
        };
        _mainForm.HotkeyRebound += (code) => _hook!.SetHotkey(code);
        _mainForm.LevelChanged += _pill.SetLevel;

        // The pill's own buttons, clicked in whatever app the user is dictating
        // into. They go back through the web core rather than acting locally:
        // it owns the take, the socket and the history, and a second authority
        // over any of those is how the two ends drift apart.
        _pill.CancelClicked += () => _mainForm.PostCancel();
        _pill.StopClicked += () => _mainForm.PostStop();

        foreach (var state in new[] { "idle", "recording", "transcribing", "blocked" })
        {
            try
            {
                _stateIcons[state] = new Icon(Path.Combine(AppContext.BaseDirectory, "Assets", $"tray-{state}.ico"));
            }
            catch (Exception ex)
            {
                Log.Write($"tray icon {state} missing: {ex.Message}");
            }
        }

        _tray.Icon = _stateIcons.GetValueOrDefault("idle") ?? SystemIcons.Application;
        _tray.Text = $"Tiro {Build.Version}. Hold the hotkey to dictate.";
        _tray.Visible = true;
        _tray.DoubleClick += (_, _) => _mainForm.ShowAndFocus();

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Tiro", null, (_, _) => _mainForm.ShowAndFocus());
        menu.Items.Add(new ToolStripSeparator());
        var autostart = new ToolStripMenuItem("Start with Windows") { Checked = _settings.Autostart, CheckOnClick = true };
        autostart.CheckedChanged += (_, _) =>
        {
            _settings.Autostart = autostart.Checked;
            SettingsStore.Save(_settings);
            SettingsStore.SetAutostart(autostart.Checked);
        };
        menu.Items.Add(autostart);
        menu.Items.Add("View log", null, (_, _) =>
        {
            try { System.Diagnostics.Process.Start("notepad.exe", Log.PathOnDisk); } catch { }
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit", null, (_, _) => Quit());
        _tray.ContextMenuStrip = menu;

        // global hotkey -> the web core's shared hold/tap state machine
        _hook = new KeyboardHook(_settings.HotkeyCode);
        _hook.HotkeyChanged += (down) => _mainForm.BeginInvoke(() => _mainForm.PostHotkey(down));
        _hook.CancelPressed += () => _mainForm.BeginInvoke(() => _mainForm.PostCancel());

        // a second launch signals this event instead of starting a second copy
        _showWait = ThreadPool.RegisterWaitForSingleObject(
            showEvent,
            (_, _) => _mainForm.BeginInvoke(() => _mainForm.ShowAndFocus()),
            null, -1, executeOnlyOnce: false);

        // The window handle must exist from launch so the WebView2, and with it
        // the warm mic and the hotkey pipeline, is alive before it is ever shown.
        _mainForm.Show();
        if (startHidden) _mainForm.Hide();

        Log.Write("tray ready");
    }

    private void OnStateChanged(string state)
    {
        if (_tray.Icon != null && _stateIcons.TryGetValue(state, out var icon)) _tray.Icon = icon;
        _pill.ShowState(state);
        // Arm the global Escape watch for exactly as long as there is something
        // to cancel. "blocked" is not a take, so it disarms too. The hook is
        // built before _mainForm.Show(), and nothing raises StateChanged until
        // the WebView2 loads on Show, so it cannot be null here.
        _hook.WatchCancel = state == "recording" || state == "transcribing";
    }

    private void Quit()
    {
        _showWait.Unregister(null);
        _hook.Dispose();
        _tray.Visible = false;
        _tray.Dispose();
        _pill.Dispose();
        Log.Write("Tiro quitting");
        ExitThread();
    }
}
