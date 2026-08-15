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

    private async Task InitWebView()
    {
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
                // mirror to %APPDATA%\Tiro\history.jsonl — the same artefact as the
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

            case "log":
                Log.Write($"[web] {msg.GetProperty("text").GetString()}");
                break;
        }
    }

    public event Action<string>? HotkeyRebound;

    public void PostHotkey(bool down) => PostToWeb(new { type = "hotkey", phase = down ? "down" : "up" });

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
