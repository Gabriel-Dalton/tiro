// Adapter for the Windows shell. The same web core runs in a plain browser and
// inside WebView2; this module is the only place that knows the difference.
//
// Protocol (JSON messages over window.chrome.webview):
//   host -> web:  {type:"hotkey", phase:"down"|"up"}
//                 {type:"key", value:"<api key or empty>"}         (reply to getKey)
//                 {type:"pasteResult", ok:bool, reason?:"elevated"}
//   web -> host:  {type:"ready"}
//                 {type:"transcript", text}      host pastes it into the focused app
//                 {type:"state", state}          idle|recording|transcribing|blocked
//                 {type:"getKey"} / {type:"storeKey", value}       DPAPI storage
//                 {type:"setHotkey", code}
//                 {type:"appendHistory", line}   host mirrors to %APPDATA%\Tiro\history.jsonl
//                 {type:"log", text}

const webview = typeof window !== "undefined" && window.chrome && window.chrome.webview;

class Bridge {
  constructor() {
    this.isShell = !!webview;
    this.onHotkey = null;       // (phase) => {}
    this.onPasteResult = null;  // ({ok, reason}) => {}
    this._keyWaiters = [];
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
