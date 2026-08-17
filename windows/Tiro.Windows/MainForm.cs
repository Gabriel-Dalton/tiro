using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Tiro.Windows;

/// <summary>
/// The product window: a WebView2 running the same web core as the PWA, served
/// from the app folder over a virtual host (secure context, so getUserMedia and
/// the AudioWorklet behave exactly as they do on the deployed site).
/// Native <-> web protocol is documented in web/src/bridge.js.
/// </summary>
sealed class MainForm : Form
{
    private const string VirtualHost = "tiro.app";
    private readonly WebView2 _webView = new();
    private readonly AppSettings _settings;
    private bool _webReady;
    private readonly Queue<string> _outbox = new(); // messages queued until the web core says ready

    public event Action<string>? StateChanged; // idle | recording | transcribing | blocked

    public MainForm(AppSettings settings)
    {
        _settings = settings;
        Text = "Tiro";
        Width = 460;
        Height = 780;
        StartPosition = FormStartPosition.CenterScreen;
        try { Icon = new Icon(AssetPath("tiro.ico")); } catch { }

        _webView.Dock = DockStyle.Fill;
        Controls.Add(_webView);
        Load += async (_, _) => await InitWebView();

        // closing the window keeps the tray app alive; Quit lives in the tray menu
        FormClosing += (_, e) =>
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
            }
        };
    }

    private static string AssetPath(string name) =>
        Path.Combine(AppContext.BaseDirectory, "Assets", name);

    /// <summary>
    /// The WebView2 runtime ships with Windows 11, but on Windows 10 it arrives
    /// only alongside Edge or Microsoft 365 and can genuinely be absent. Without
    /// this check the app starts, fails deep inside EnsureCoreWebView2Async, and
    /// leaves a tray icon that does nothing. Say what is wrong and offer the fix.
    /// </summary>
    private bool WebViewRuntimeMissing()
    {
        try
        {
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            if (!string.IsNullOrEmpty(version))
            {
                Log.Write($"WebView2 runtime {version}");
                return false;
            }
        }
        catch (Exception ex)
        {
            Log.Write($"WebView2 runtime lookup failed: {ex.Message}");
        }

        const string url = "https://developer.microsoft.com/microsoft-edge/webview2/";
        var answer = MessageBox.Show(
            "Tiro needs the Microsoft Edge WebView2 runtime, which is not installed on this PC.\n\n" +
            "It ships with Windows 11 and usually arrives with Edge on Windows 10. It is a free " +
            "download from Microsoft and takes about a minute.\n\n" +
            "Open the download page now?",
            "Tiro needs one more component",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Information);

        if (answer == DialogResult.Yes)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                Log.Write($"could not open {url}: {ex.Message}");
            }
        }
        return true;
    }

    private async Task InitWebView()
    {
        if (WebViewRuntimeMissing())
        {
            RuntimeMissing?.Invoke();
            return;
        }

        // This app's normal state is a tray icon with no window on screen, and
        // Chromium treats a hidden page as a background tab: timers clamp to one
        // per second and the renderer is deprioritised. That is wrong for every
        // clock in a take. The pill's 20 Hz waveform would tick once a second,
        // and the 0.5 s tail that keeps the last word from being clipped would
        // stretch past a second. None of it shows up while the window is open,
        // which is the only way anyone tests it.
        //
        // rAF is a separate matter and no flag brings it back: an invisible page
        // produces no frames at all. That is why the level feed is on a timer
        // rather than on the halo's animation loop.
        var options = new CoreWebView2EnvironmentOptions
        {
            AdditionalBrowserArguments =
                "--disable-background-timer-throttling " +
                "--disable-renderer-backgrounding " +
                "--disable-backgrounding-occluded-windows",
        };
        var env = await CoreWebView2Environment.CreateAsync(
            userDataFolder: Path.Combine(Log.AppDataDir, "WebView2"),
            options: options);
        await _webView.EnsureCoreWebView2Async(env);
        var core = _webView.CoreWebView2;

        core.SetVirtualHostNameToFolderMapping(
            VirtualHost,
            Path.Combine(AppContext.BaseDirectory, "web"),
            CoreWebView2HostResourceAccessKind.Allow);

        // Pre-grant the mic to our own origin so there is no browser-style
        // prompt (the open question in RESEARCH.md, answered: the host decides).
        core.PermissionRequested += (_, e) =>
        {
            if (e.Uri.StartsWith($"https://{VirtualHost}", StringComparison.OrdinalIgnoreCase))
            {
                e.State = CoreWebView2PermissionState.Allow;
                e.Handled = true;
            }
        };

        // The web core cannot read the EXE's version, so hand it over before the
        // page loads. It shows up in the About card as the Windows build number.
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            $"window.__tiroHost = {{ version: \"{Build.Version}\" }};");

        // WIN-05. A dead render process used to mean a live-looking tray icon
        // that did nothing. It now means more than that: the state it was last
        // told is what arms the global Escape hook, so a crash mid-take would
        // leave Escape swallowed system-wide until the user quit from the tray.
        // Nothing else can un-arm it, because the only thing that ever does is a
        // state message from the page that just died.
        core.ProcessFailed += (_, e) =>
        {
            Log.Write($"WebView2 process failed: {e.ProcessFailedKind}");
            _webReady = false;
            StateChanged?.Invoke("blocked");
        };
        core.NavigationCompleted += (_, e) =>
        {
            if (e.IsSuccess) return;
            Log.Write($"navigation failed: {e.WebErrorStatus}");
            _webReady = false;
            StateChanged?.Invoke("blocked");
        };

        core.WebMessageReceived += OnWebMessage;
        core.Navigate($"https://{VirtualHost}/index.html");
        Log.Write("WebView2 initialised");
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonElement msg;
        try { msg = JsonDocument.Parse(e.WebMessageAsJson).RootElement; }
        catch { return; }
        if (msg.ValueKind != JsonValueKind.Object || !msg.TryGetProperty("type", out var typeEl)) return;

        switch (typeEl.GetString())
        {
            case "ready":
                _webReady = true;
                while (_outbox.Count > 0) _webView.CoreWebView2.PostWebMessageAsJson(_outbox.Dequeue());
                break;

            case "getKey":
                PostToWeb(new { type = "key", value = KeyStore.Load() });
                break;

            case "storeKey":
                KeyStore.Save(msg.GetProperty("value").GetString() ?? "");
                break;

            case "transcript":
            {
                var text = msg.GetProperty("text").GetString() ?? "";
                var result = Paster.Paste(text);
                PostToWeb(new { type = "pasteResult", ok = result.Ok, reason = result.Reason });
                if (!result.Ok) Log.Write($"paste failed: {result.Reason}");
                break;
            }

            case "state":
                StateChanged?.Invoke(msg.GetProperty("state").GetString() ?? "idle");
                break;

            case "problem":
            {
                // A press that produced no take. This window is where the web
                // core's own toast went, and it is usually hidden, so without
                // this the user pressed the hotkey and nothing whatsoever
                // happened on screen. Goes to the log too: "nothing happened" is
                // the hardest report to act on after the fact.
                var text = msg.TryGetProperty("text", out var textEl) ? textEl.GetString() ?? "" : "";
                var open = msg.TryGetProperty("open", out var openEl) && openEl.ValueKind == JsonValueKind.True;
                if (text.Length == 0) break;
                Log.Write($"take refused: {text}");
                TakeRefused?.Invoke(text, open);
                break;
            }

            case "level":
                // Already smoothed and normalised by the web core, which is what
                // keeps this meter and the PWA's halo from disagreeing. The
                // bridge throttles it to 20 Hz, so this is not a hot path.
                LevelChanged?.Invoke((float)msg.GetProperty("value").GetDouble());
                break;

            case "setHotkey":
            {
                var code = msg.GetProperty("code").GetString() ?? "AltRight";
                _settings.HotkeyCode = code;
                SettingsStore.Save(_settings);
                HotkeyRebound?.Invoke(code);
                break;
            }

            case "appendHistory":
            {
                // mirror to %APPDATA%\Tiro\history.jsonl, the same artefact as the
                // macOS file and a PWA export
                var line = msg.GetProperty("line").GetString();
                if (!string.IsNullOrEmpty(line))
                {
                    try
                    {
                        Directory.CreateDirectory(Log.AppDataDir);
                        File.AppendAllText(Path.Combine(Log.AppDataDir, "history.jsonl"), line + "\n");
                    }
                    catch (Exception ex) { Log.Write($"history append failed: {ex.Message}"); }
                }
                break;
            }

            case "openExternal":
            {
                // The web core cannot open a browser from inside WebView2, and it
                // must not navigate the shell away from the app. Only our own
                // release page is ever opened, checked here rather than trusted:
                // the host, not the page, decides where a click can lead.
                var url = msg.TryGetProperty("url", out var urlEl) ? urlEl.GetString() ?? "" : "";
                if (url.StartsWith("https://github.com/Gabriel-Dalton/tiro/", StringComparison.Ordinal))
                {
                    try
                    {
                        System.Diagnostics.Process.Start(
                            new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
                    }
                    catch (Exception ex) { Log.Write($"openExternal failed: {ex.Message}"); }
                }
                else
                {
                    Log.Write($"openExternal refused: {url}");
                }
                break;
            }

            case "log":
                Log.Write($"[web] {msg.GetProperty("text").GetString()}");
                break;
        }
    }

    public event Action<string>? HotkeyRebound;

    /// <summary>Raised when the WebView2 runtime is absent, so the tray can show
    /// the blocked state rather than pretending the app is ready.</summary>
    public event Action? RuntimeMissing;

    /// <summary>Mic level 0..1 while a take runs, for the pill's waveform.</summary>
    public event Action<float>? LevelChanged;

    /// <summary>A hotkey press that could not start a take, and whether opening
    /// the app is a useful answer to it. The bool is the web core's call, not a
    /// guess made here: it knows which refusals have something to fix in the
    /// app and which are the network or the microphone.</summary>
    public event Action<string, bool>? TakeRefused;

    public void PostHotkey(bool down) => PostToWeb(new { type = "hotkey", phase = down ? "down" : "up" });

    /// <summary>Throw the take away: global Escape, or the pill's X.</summary>
    public void PostCancel() => PostToWeb(new { type = "cancel" });

    /// <summary>Finish the take now: the pill's check.</summary>
    public void PostStop() => PostToWeb(new { type = "stop" });

    /// <summary>Tell the web core a newer release exists, so it can offer it in
    /// the app itself rather than only in the tray menu. The version comes from
    /// GitHub, never from anything compiled in here.</summary>
    public void PostUpdateAvailable(string version, string url) =>
        PostToWeb(new { type = "update", version, url });

    private void PostToWeb(object payload)
    {
        var json = JsonSerializer.Serialize(payload);
        if (_webReady && _webView.CoreWebView2 != null)
        {
            _webView.CoreWebView2.PostWebMessageAsJson(json);
        }
        else
        {
            _outbox.Enqueue(json);
        }
    }

    public void ShowAndFocus()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }
}
