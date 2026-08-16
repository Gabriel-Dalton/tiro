// Adapter for the Windows shell. The same web core runs in a plain browser and
// inside WebView2; this module is the only place that knows the difference.
//
// Protocol (JSON messages over window.chrome.webview):
//   host -> web:  {type:"hotkey", phase:"down"|"up"}
//                 {type:"key", value:"<api key or empty>"}         (reply to getKey)
//                 {type:"pasteResult", ok:bool, reason?:"elevated"}
//                 {type:"cancel"}                global Esc, or the pill's X
//                 {type:"stop"}                  the pill's check: finish now
//   web -> host:  {type:"ready"}
//                 {type:"transcript", text}      host pastes it into the focused app
//                 {type:"state", state}          idle|recording|transcribing|blocked
//                 {type:"level", value}          0..1 mic level for the pill waveform
//                 {type:"getKey"} / {type:"storeKey", value}       DPAPI storage
//                 {type:"setHotkey", code}
//                 {type:"appendHistory", line}   host mirrors to %APPDATA%\Tiro\history.jsonl
//                 {type:"log", text}

const webview = typeof window !== "undefined" && window.chrome && window.chrome.webview;

// The host injects this before the page loads (MainForm.InitWebView), so the
// About card can name the EXE version, not just the web core's.
const host = (typeof window !== "undefined" && window.__tiroHost) || null;

class Bridge {
  constructor() {
    this.isShell = !!webview;
    this.hostVersion = host && host.version ? String(host.version) : "";
    this.onHotkey = null;       // (phase) => {}
    this.onPasteResult = null;  // ({ok, reason}) => {}
    this.onCancel = null;       // () => {}   discard the take
    this.onStop = null;         // () => {}   finish the take now
    this._keyWaiters = [];
    this._lastLevelAt = 0;
    this._lastLevel = -1;
    if (this.isShell) {
      webview.addEventListener("message", (e) => this._onMessage(e.data));
      this._post({ type: "ready" });
    }
  }

  _post(msg) {
    if (this.isShell) webview.postMessage(msg);
  }

  _onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "hotkey":
        if (this.onHotkey) this.onHotkey(msg.phase);
        break;
      case "key": {
        const waiters = this._keyWaiters;
        this._keyWaiters = [];
        for (const w of waiters) w(msg.value || "");
        break;
      }
      case "pasteResult":
        if (this.onPasteResult) this.onPasteResult(msg);
        break;
      case "cancel":
        if (this.onCancel) this.onCancel();
        break;
      case "stop":
        if (this.onStop) this.onStop();
        break;
    }
  }

  /** DPAPI-held API key from the host. Resolves "" when none is stored. */
  fetchKey() {
    if (!this.isShell) return Promise.resolve("");
    return new Promise((resolve) => {
      this._keyWaiters.push(resolve);
      this._post({ type: "getKey" });
      setTimeout(() => resolve(""), 2000); // never hang the UI on the host
    });
  }

  storeKey(value) {
    this._post({ type: "storeKey", value: value || "" });
    return Promise.resolve();
  }

  /** Hand the finished transcript to the host, which pastes it via SendInput. */
  sendTranscript(text) {
    this._post({ type: "transcript", text });
  }

  setState(state) {
    this._post({ type: "state", state });
  }

  /** Mic level, 0..1, for the host's pill waveform.
   *
   * The caller runs this off requestAnimationFrame, so at 120 Hz on a good
   * display. Every message is a JSON serialise on this side and a parse plus a
   * UI-thread marshal on the host's, which is a lot of work to move a number
   * that redraws a 44 px window. Throttling here rather than at the call site
   * keeps the seam responsible for its own cost: 20 Hz is already faster than
   * the pill's own repaint, and identical values are dropped so silence stops
   * talking to the host at all.
   *
   * Level is deliberately the *normalised* value the halo draws, not raw RMS.
   * Getting from RMS to something that looks like a voice took a noise floor, a
   * ceiling and a gamma curve (see the halo block in app.js); duplicating that
   * arithmetic in C# would leave two meters that disagree. */
  setLevel(value) {
    if (!this.isShell) return;
    const v = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
    const now = Date.now();
    if (v === this._lastLevel) return;
    // A hard zero is the take parking itself, and it is the one value that must
    // not be dropped: lose it and the host's bars freeze at whatever the last
    // syllable left them at, for as long as the pill stays up.
    if (v !== 0 && now - this._lastLevelAt < 50) return;
    this._lastLevel = v;
    this._lastLevelAt = now;
    this._post({ type: "level", value: v });
  }

  setHotkey(code) {
    this._post({ type: "setHotkey", code });
  }

  appendHistory(line) {
    this._post({ type: "appendHistory", line });
  }

  log(text) {
    this._post({ type: "log", text });
  }
}

export const bridge = new Bridge();
