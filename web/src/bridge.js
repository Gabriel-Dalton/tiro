// Adapter for the Windows shell. The same web core runs in a plain browser and
// inside WebView2; this module is the only place that knows the difference.
//
// Protocol (JSON messages over window.chrome.webview):
//   host -> web:  {type:"hotkey", phase:"down"|"up"}
//                 {type:"key", value:"<api key or empty>"}         (reply to getKey)
//                 {type:"pasteResult", ok:bool, reason?:"elevated"}
//                 {type:"cancel"}                global Esc, or the pill's X
//                 {type:"stop"}                  the pill's check: finish now
//                 {type:"update", version:"1.3.0", url}  a newer release exists
//                 {type:"altgr", present}        Right Alt is AltGr on this PC
//   web -> host:  {type:"ready"}
//                 {type:"transcript", text}      host pastes it into the focused app
//                 {type:"state", state}          idle|recording|transcribing|blocked
//                 {type:"problem", text, open}   a take that could not start
//                 {type:"level", value}          0..1 mic level for the pill waveform
//                 {type:"getKey"} / {type:"storeKey", value}       DPAPI storage
//                 {type:"setHotkey", code}
//                 {type:"appendHistory", line}   host mirrors to %APPDATA%\Tiro\history.jsonl
//                 {type:"openExternal", url}     host opens it in the real browser
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
    this.onUpdate = null;       // ({version, url}) => {}
    this.onAltGr = null;        // (present) => {}  Right Alt is AltGr here
    this._keyWaiters = [];
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
      case "altgr":
        // Only the host can see the installed keyboard layouts, so this is the
        // page being told something it has no way to work out for itself.
        if (this.onAltGr) this.onAltGr(!!msg.present);
        break;
      case "update":
        // {version, url} straight from the host's read of GitHub's latest
        // release. Nothing here knows or assumes a version number.
        if (this.onUpdate) this.onUpdate(msg);
        break;
    }
  }

  /** Ask the host to open a link in the real browser. WebView2 cannot, and
   * navigating the shell itself would replace the app with a web page. */
  openExternal(url) {
    this._post({ type: "openExternal", url });
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

  /** A take that never started, and why.
   *
   * The toast this accompanies is written into a window that in the shell is
   * normally hidden behind whatever the user is dictating into, so on Windows
   * a refused press produced nothing at all: no pill, because the state machine
   * never left idle and so never sent a state, and no message, because the only
   * place the message went was a page nobody was looking at. From the keyboard
   * it was indistinguishable from the hotkey not being hooked.
   *
   * `open` marks the reasons a user can actually do something about in the app
   * itself, which is only the missing key. The host makes those clickable and
   * leaves the rest to be read and dismissed. In a browser this does nothing:
   * the toast is already on screen, in the window that has focus. */
  problem(text, open = false) {
    this._post({ type: "problem", text: String(text || ""), open: !!open });
  }

  /** Mic level, 0..1, for the host's pill waveform.
   *
   * The caller is app.js's 50 ms level feed, which already paces this. It used
   * to be the halo's requestAnimationFrame loop, and this method carried its own
   * 50 ms throttle to cut 120 Hz down to 20. That throttle is now redundant, and
   * a limiter set to the same interval as its producer is worth removing rather
   * than leaving to sit: measured over 100 ticks of a 50 ms setInterval it threw
   * away 1 sample, since setInterval fires at *or after* its interval and only
   * occasionally lands early enough to trip. Small, but it buys nothing.
   *
   * What is worth keeping is dropping repeats, so silence stops talking to the
   * host at all rather than posting the same number twenty times a second. That
   * is what actually limits the traffic: against a steady tone the smoothed
   * value rounds to the same two decimals and most ticks send nothing.
   *
   * Level is deliberately the *normalised* value the halo draws, not raw RMS.
   * Getting from RMS to something that looks like a voice took a noise floor, a
   * ceiling and a gamma curve (`normaliseLevel` in app.js, shared by both);
   * duplicating that arithmetic in C# would leave two meters that disagree. */
  setLevel(value) {
    if (!this.isShell) return;
    const v = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
    if (v === this._lastLevel) return;
    this._lastLevel = v;
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
