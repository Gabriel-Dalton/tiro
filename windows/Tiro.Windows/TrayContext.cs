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
    private ToolStripMenuItem? _updateItem;

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

        // Updates. The "new version" item is hidden until there is one, so the
        // menu says nothing when there is nothing to say.
        menu.Items.Add(new ToolStripSeparator());
        _updateItem = new ToolStripMenuItem("", null, (_, _) => OpenReleases()) { Visible = false };
        _updateItem.Font = new Font(_updateItem.Font, FontStyle.Bold);
        menu.Items.Add(_updateItem);
        // The check runs weekly, so on the other six days what it found last
        // time is all there is. Without this the news showed up for one launch
        // and then the menu went quiet again as though nothing was waiting.
        if (UpdateCheck.IsNewer(_settings.LastKnownVersion, Build.Version))
        {
            ShowPendingUpdate(_settings.LastKnownVersion!);
        }
        menu.Items.Add($"Version {Build.Version}", null, (_, _) => CheckForUpdatesNow());
        var updates = new ToolStripMenuItem("Check for updates weekly")
        {
            Checked = _settings.CheckForUpdates,
            CheckOnClick = true,
            ToolTipText = "Asks GitHub whether there is a newer release. Sends no identifiers.",
        };
        updates.CheckedChanged += (_, _) =>
        {
            _settings.CheckForUpdates = updates.Checked;
            SettingsStore.Save(_settings);
            Log.Write($"update check {(updates.Checked ? "enabled" : "disabled")} by the user");
        };
        menu.Items.Add(updates);

        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit", null, (_, _) => Quit());
        _tray.ContextMenuStrip = menu;

        // global hotkey -> the web core's shared hold/tap state machine
        _hook = new KeyboardHook(_settings.HotkeyCode);
        _hook.HotkeyChanged += (down) => _mainForm.BeginInvoke(() => _mainForm.PostHotkey(down));

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

        // After the app is up, never during launch: an update check must not be
        // something the first dictation of the day waits on.
        _ = MaybeCheckForUpdatesAsync();
    }

    // ---------------------------------------------------------------- updates

    /// <summary>The scheduled check: only if it is switched on, and only weekly.</summary>
    private async Task MaybeCheckForUpdatesAsync()
    {
        if (!_settings.CheckForUpdates) return;
        var last = _settings.LastUpdateCheckUtc;
        if (last.HasValue && DateTime.UtcNow - last.Value < UpdateCheck.Interval) return;
        // And do not retry a check that failed on every launch: offline, blocked
        // by a company proxy, or rate-limited behind a shared IP all look the
        // same from here, and none of them get better by asking again in a
        // minute.
        var attempt = _settings.LastUpdateAttemptUtc;
        if (attempt.HasValue && DateTime.UtcNow - attempt.Value < UpdateCheck.RetryAfterFailure) return;
        await RunUpdateCheckAsync(announce: false).ConfigureAwait(false);
    }

    /// <summary>The menu item: checks now, and says so either way, because a
    /// check you asked for that answers nothing looks broken.</summary>
    private void CheckForUpdatesNow() => _ = RunUpdateCheckAsync(announce: true);

    private async Task RunUpdateCheckAsync(bool announce)
    {
        var latest = await UpdateCheck.LatestVersionAsync().ConfigureAwait(false);

        // Every attempt is recorded, so a machine that cannot reach GitHub backs
        // off instead of asking on every launch. Only one that *reached* it
        // resets the weekly clock, because a fortnight offline must not cost a
        // fortnight of checks.
        _settings.LastUpdateAttemptUtc = DateTime.UtcNow;
        if (latest != null) _settings.LastUpdateCheckUtc = DateTime.UtcNow;
        SettingsStore.Save(_settings);

        var newer = UpdateCheck.IsNewer(latest, Build.Version);
        Log.Write($"update check: latest={latest ?? "unknown"} running={Build.Version} newer={newer}");

        // Back to the UI thread: NotifyIcon and its menu are not thread-safe.
        if (_mainForm.IsHandleCreated)
        {
            _mainForm.BeginInvoke(() => ShowUpdateResult(latest, newer, announce));
        }
    }

    private void ShowUpdateResult(string? latest, bool newer, bool announce)
    {
        if (newer && latest != null)
        {
            // Always visible to anyone who looks, whatever the release contains,
            // and remembered so it stays visible between weekly checks.
            ShowPendingUpdate(latest);
            _settings.LastKnownVersion = latest;
            SettingsStore.Save(_settings);

            // Interrupting, though, is reserved for a release that changed
            // something you would want. A fix-only one sits in the menu above
            // and says nothing: nobody should be pulled out of a sentence to be
            // told a typo was corrected. `announce` is the exception, because
            // then you asked.
            var worth = UpdateCheck.Classify(latest, Build.Version);
            if (worth == UpdateCheck.Worth.Quiet && !announce)
            {
                Log.Write($"update {latest} is fixes only; tray menu only");
                return;
            }

            // Once per version means once. Weekly checks would otherwise balloon
            // the same release at someone every week until they gave in, which is
            // the behaviour this whole policy exists to avoid. Asking explicitly
            // still answers, because then they asked.
            if (_settings.AnnouncedVersion == latest && !announce)
            {
                Log.Write($"update {latest} already announced; tray menu only");
                return;
            }
            _settings.AnnouncedVersion = latest;
            SettingsStore.Save(_settings);

            // In the app itself, where someone is actually looking. The tray menu
            // is where you go once you already suspect there is an update.
            _mainForm.PostUpdateAvailable(latest, UpdateCheck.ReleasesPage);
            // One balloon, when the news is new. Windows collapses these into the
            // notification centre, so it does not steal focus mid-sentence.
            _tray.BalloonTipTitle = $"Tiro {latest} is out";
            _tray.BalloonTipText = "You are running " + Build.Version + ". Open the tray menu to download it.";
            _tray.ShowBalloonTip(8000);
        }
        else if (announce)
        {
            _tray.BalloonTipTitle = latest == null ? "Could not check for updates" : "Tiro is up to date";
            _tray.BalloonTipText = latest == null
                ? "GitHub could not be reached. Nothing was sent."
                : $"{Build.Version} is the latest release.";
            _tray.ShowBalloonTip(5000);
        }
    }

    /// <summary>The menu item and tooltip half, which is always safe to show.</summary>
    private void ShowPendingUpdate(string version)
    {
        if (_updateItem != null)
        {
            _updateItem.Text = $"New version {version} — download";
            _updateItem.Visible = true;
        }
        _tray.Text = $"Tiro {Build.Version}. Version {version} is available.";
    }

    private static void OpenReleases()
    {
        try
        {
            System.Diagnostics.Process.Start(
                new System.Diagnostics.ProcessStartInfo(UpdateCheck.ReleasesPage) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Log.Write($"opening the releases page failed: {ex.Message}");
        }
    }

    private void OnStateChanged(string state)
    {
        if (_tray.Icon != null && _stateIcons.TryGetValue(state, out var icon)) _tray.Icon = icon;
        _pill.ShowState(state);
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
