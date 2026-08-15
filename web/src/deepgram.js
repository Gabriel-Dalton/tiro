// Deepgram streaming client. One socket per take: connect on record start,
// buffer locally until open (so connection latency can never clip speech),
// flush pre-roll and stream live, then CloseStream and wait for finals.
//
// Auth is the subprotocol array — a browser cannot set headers on a WebSocket,
// and Deepgram's REST API is CORS-blocked on purpose (docs/RESEARCH.md #1).

import { TARGET_SAMPLE_RATE, KEEPALIVE_INTERVAL_MS } from "./tokens.js";

const WSS_URL =
  "wss://api.deepgram.com/v1/listen" +
  "?model=nova-3" +
  "&smart_format=true" +
  "&punctuate=true" +
  "&interim_results=true" +
  "&encoding=linear16" +
  `&sample_rate=${TARGET_SAMPLE_RATE}` +
  "&channels=1";

const OPEN_TIMEOUT_MS = 8000;
const FINAL_TIMEOUT_MS = 6000;

/** Error with a `kind` the UI can map to the right message:
 *  "auth" (key rejected), "offline", "network", "timeout". */
export class DeepgramError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

export class DeepgramStream {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.pending = [];        // Int16Array chunks buffered before the socket opens
    this.finals = [];         // accumulated is_final transcripts
    this.opened = false;      // did the handshake ever succeed
    this.closed = false;
    this.keepAliveTimer = null;
    /** live feedback: called with (interimText, accumulatedFinalText) */
    this.onInterim = null;
    /** called if the socket dies mid-take */
    this.onError = null;
    this._finishResolve = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      if (!navigator.onLine) {
        reject(new DeepgramError("offline", "You are offline."));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { this.ws.close(); } catch {}
          reject(new DeepgramError("network", "Could not reach Deepgram."));
        }
      }, OPEN_TIMEOUT_MS);

      try {
        this.ws = new WebSocket(WSS_URL, ["token", this.apiKey]);
      } catch (e) {
        clearTimeout(timer);
        reject(new DeepgramError("network", String(e)));
        return;
      }
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.opened = true;
        clearTimeout(timer);
        for (const chunk of this.pending) this._sendChunk(chunk);
        this.pending = [];
        this._armKeepAlive();
        if (!settled) { settled = true; resolve(); }
      };

      this.ws.onmessage = (e) => this._onMessage(e);

      this.ws.onclose = (e) => {
        this._disarmKeepAlive();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          // The handshake never succeeded. A rejected key surfaces as an
          // immediate close (HTTP 401 under the hood); a dead network usually
          // hits the timeout instead. Distinguish them: the fixes differ.
          if (navigator.onLine) {
            reject(new DeepgramError("auth", "Deepgram rejected the key."));
          } else {
            reject(new DeepgramError("offline", "You are offline."));
          }
          return;
        }
        if (!this.closed) {
          // died mid-take
          this.closed = true;
          if (this._finishResolve) {
            this._finishResolve(); // resolve finish() with whatever finals we have
          } else if (this.onError) {
            this.onError(new DeepgramError("network", `Connection lost (${e.code}).`));
          }
        }
      };

      this.ws.onerror = () => { /* onclose carries the story */ };
    });
  }

  /** Safe to call before the socket is open — chunks buffer locally. */
  send(int16) {
    if (this.closed) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._sendChunk(int16);
    } else {
      this.pending.push(int16);
    }
  }

  /** Stop the take: CloseStream, wait for outstanding finals, resolve with the
   * full transcript. Never hangs: FINAL_TIMEOUT_MS caps the wait. */
  finish() {
    return new Promise((resolve) => {
      const done = () => {
        this._disarmKeepAlive();
        this.closed = true;
        try { this.ws && this.ws.close(); } catch {}
        resolve(this.finals.join(" ").replace(/\s+/g, " ").trim());
      };
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { done(); return; }
      this._finishResolve = done;
      this._finishTimer = setTimeout(done, FINAL_TIMEOUT_MS);
      try {
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch {
        done();
      }
    });
  }

  abort() {
    this.closed = true;
    this._disarmKeepAlive();
    try { this.ws && this.ws.close(); } catch {}
  }

  _sendChunk(int16) {
    // send() accepts an ArrayBufferView and transmits exactly the view's bytes
    try { this.ws.send(int16); } catch { /* onclose handles it */ }
  }

  _onMessage(e) {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "Results") {
      const alt = msg.channel && msg.channel.alternatives && msg.channel.alternatives[0];
      const text = alt ? alt.transcript : "";
      if (msg.is_final) {
        // Build the real transcript from finals only, never from interims.
        if (text) this.finals.push(text);
        if (this.onInterim) this.onInterim("", this.finals.join(" "));
      } else if (text && this.onInterim) {
        this.onInterim(text, this.finals.join(" "));
      }
    } else if (msg.type === "Metadata" && this._finishResolve) {
      // Metadata arrives after CloseStream once all finals have been delivered.
      clearTimeout(this._finishTimer);
      const r = this._finishResolve;
      this._finishResolve = null;
      r();
    }
  }

  _armKeepAlive() {
    // A thinking pause in toggle mode must not drop the socket (~10 s silence
    // timeout). Harmless while audio is flowing.
    this.keepAliveTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.closed) {
        try { this.ws.send(JSON.stringify({ type: "KeepAlive" })); } catch {}
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  _disarmKeepAlive() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
    if (this._finishTimer) clearTimeout(this._finishTimer);
  }
}

/** "Save and test": a real credential check. Opening the socket succeeds only
 * if the key is accepted (REST validation is CORS-blocked). */
export function testKey(apiKey) {
  return new Promise((resolve) => {
    if (!navigator.onLine) { resolve({ ok: false, kind: "offline" }); return; }
    let ws;
    const timer = setTimeout(() => {
      try { ws && ws.close(); } catch {}
      resolve({ ok: false, kind: "network" });
    }, OPEN_TIMEOUT_MS);
    try {
      ws = new WebSocket(WSS_URL, ["token", apiKey]);
    } catch {
      clearTimeout(timer);
      resolve({ ok: false, kind: "network" });
      return;
    }
    ws.onopen = () => {
      clearTimeout(timer);
      try { ws.send(JSON.stringify({ type: "CloseStream" })); ws.close(); } catch {}
      resolve({ ok: true });
    };
    ws.onclose = () => {
      clearTimeout(timer);
      resolve({ ok: false, kind: navigator.onLine ? "auth" : "offline" });
    };
  });
}
