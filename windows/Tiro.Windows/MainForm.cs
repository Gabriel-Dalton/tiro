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

        var env = await CoreWebView2Environment.CreateAsync(
            userDataFolder: Path.Combine(Log.AppDataDir, "WebView2"));
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
                var url = msg.GetProperty("url").GetString() ?? "";
                if (url.StartsWith("https://github.com/Gabriel-Dalton/tiro", StringComparison.Ordinal))
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

    public void PostHotkey(bool down) => PostToWeb(new { type = "hotkey", phase = down ? "down" : "up" });

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
