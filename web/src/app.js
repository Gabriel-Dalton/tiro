// Tiro web core: the hold/tap state machine and all wiring. Runs identically in
// a browser (PWA) and inside the Windows WebView2 shell; src/bridge.js is the
// only seam between the two.

import { TAP_THRESHOLD_MS, TAIL_SEC, STREAMING_PER_MIN, COMPETITORS } from "./tokens.js";
import { AudioEngine, int16ToWav } from "./audio.js";
import { DeepgramStream, testKey } from "./deepgram.js";
import * as history from "./history.js";
import { monthStats, fmtMoney, fmtMinutes } from "./usage.js";
import * as settings from "./settings.js";
import { bridge } from "./bridge.js";
import { VERSION } from "./version.js";

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- state

// idle -> holdRecording -> (released > threshold) -> transcribing -> idle
//                       -> (released < threshold) -> toggleRecording -> (tap) -> transcribing
let state = "idle";
let pressedAt = 0;
let stream = null;      // DeepgramStream for the current take
let timerHandle = null;
let recordStartedAt = 0;

const engine = new AudioEngine();
engine.onDeviceChange = () => notice("Mic changed, reconnected", "warn");

// ---------------------------------------------------------------- ui helpers

function setState(next) {
  state = next;
  const talk = $("talk"), label = $("talk-label"), head = $("head-status");
  talk.classList.toggle("recording", next === "holdRecording" || next === "toggleRecording");
  talk.classList.toggle("transcribing", next === "transcribing");
  head.classList.toggle("recording", next === "holdRecording" || next === "toggleRecording");
  $("timer").hidden = next !== "holdRecording" && next !== "toggleRecording";
  if (next === "idle") {
    label.textContent = "Hold to talk";
    head.textContent = "ready";
    stopTimer();
  } else if (next === "holdRecording") {
    label.textContent = "Listening…";
    head.textContent = "recording";
    startTimer();
  } else if (next === "toggleRecording") {
    label.textContent = "Tap to stop";
    head.textContent = "recording";
  } else if (next === "transcribing") {
    label.textContent = "Transcribing…";
    head.textContent = "transcribing";
    stopTimer();
  }
  bridge.setState(next === "holdRecording" || next === "toggleRecording" ? "recording"
    : next === "transcribing" ? "transcribing" : "idle");
}

function startTimer() {
  recordStartedAt = Date.now();
  stopTimer();
  timerHandle = setInterval(() => {
    const t = Math.floor((Date.now() - recordStartedAt) / 1000);
    $("timer").textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  }, 200);
  $("timer").textContent = "0:00";
  animateLevel();
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function animateLevel() {
  const halo = $("halo");
  const tick = () => {
    if (state !== "holdRecording" && state !== "toggleRecording") {
      halo.style.opacity = "0";
      return;
    }
    const l = Math.min(1, engine.level * 3.2);
    halo.style.opacity = String(0.35 + l * 0.6);
    halo.style.transform = `scale(${1 + l * 0.45})`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let toastTimer = null;
function notice(text, tone = "warn", ms = 3200) {
  $("toast-text").textContent = text;
  $("toast-dot").className = "dot " + (tone === "ok" ? "ok" : tone === "bad" ? "bad" : "");
  $("toast").hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, ms);
}

// ---------------------------------------------------------------- recording

async function pressStart() {
  if (state === "transcribing") return;
  if (state === "toggleRecording") return; // handled on release: stop-and-insert

  const key = settings.getApiKey();
  if (!key) {
    notice("Add your Deepgram key first", "warn");
    showView("settings");
    $("settings-key").focus();
    return;
  }
  if (!navigator.onLine) {
    notice("You are offline", "bad");
    return;
  }

  try {
    await engine.start(); // no-op when already warm
  } catch {
    notice("No microphone. Check permissions", "bad", 5000);
    return;
  }

  pressedAt = Date.now();
  stream = new DeepgramStream(key);
  stream.onInterim = (interim, finals) => {
    $("live").hidden = false;
    $("live-final").textContent = finals ? finals + " " : "";
    $("live-interim").textContent = interim;
  };
  stream.onError = (err) => {
    notice(err.kind === "auth" ? "Deepgram rejected your key" : "Connection lost", "bad", 5000);
  };
  $("live").hidden = true;
  $("live-final").textContent = "";
  $("live-interim").textContent = "";
  $("result-card").hidden = true;

  // Adopt the pre-roll and stream. Chunks buffer locally until the socket is
  // open, so connect latency cannot clip the first word.
  engine.onChunk = (c) => stream && stream.send(c);
  engine.beginRecording();
  setState("holdRecording");

  stream.start().catch((err) => {
    // The socket never opened; kill the take with a precise message.
    engine.endRecording();
    engine.onChunk = null;
    if (stream) { stream.abort(); stream = null; }
    setState("idle");
    notice(
      err.kind === "auth" ? "Deepgram rejected your key. Check Settings"
        : err.kind === "offline" ? "You are offline"
        : "Could not reach Deepgram",
      "bad", 5000
    );
  });
}

function pressEnd() {
  if (state === "holdRecording") {
    if (Date.now() - pressedAt < TAP_THRESHOLD_MS) {
      setState("toggleRecording"); // quick tap: stay recording hands-free
    } else {
      stopAndInsert(); // held: insert now (we are inside the pointerup gesture)
    }
  } else if (state === "toggleRecording") {
    stopAndInsert(); // second tap
  }
}

/** Must be called synchronously inside the user gesture: the promise-valued
 * ClipboardItem is what lets the write survive the network round trip on
 * Safari (docs/RESEARCH.md #4). */
function stopAndInsert() {
  if (!stream) { setState("idle"); return; }
  const s = stream;
  stream = null;
  setState("transcribing");

  const transcriptPromise = (async () => {
    // keep streaming through the tail so the last word is not clipped
    await new Promise((r) => setTimeout(r, TAIL_SEC * 1000));
    const sec = Math.round(engine.endRecording() * 10) / 10;
    engine.onChunk = null;
    const text = await s.finish();
    finishTake(text, sec);
    if (!text) throw new Error("empty"); // reject: never clobber the clipboard with ""
    return text;
  })();

  if (!bridge.isShell) {
    writeClipboardTiered(transcriptPromise);
  } else {
    // The Windows host pastes into the focused app via SendInput instead.
    transcriptPromise.then((text) => bridge.sendTranscript(text)).catch(() => {});
  }
}

function finishTake(text, sec) {
  setState("idle");
  // Warm mic is a user choice: pre-roll versus the recording indicator/battery.
  if (!settings.getSettings().micWarm) engine.stop();
  if (!text) {
    notice("Heard nothing", "warn");
    return;
  }
  $("live").hidden = true;
  $("result-text").textContent = text;
  $("result-card").hidden = false;
  $("result-share").hidden = !navigator.share;
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  history.addEntry({ ts, text, sec }).catch(() => {});
  bridge.appendHistory(JSON.stringify({ ts, text, sec }));
}

// Clipboard tiers (SPEC-PWA 1.4). Tier 3, the visible Copy button on the
// result card, is always available regardless.
function writeClipboardTiered(transcriptPromise) {
  const setBadge = (ok) => {
    $("result-badge").textContent = ok ? "copied" : "tap copy";
    $("result-badge").className = "badge" + (ok ? "" : " warn");
  };
  let wrote = false;
  try {
    // Tier 1: promise-valued ClipboardItem, created synchronously in the gesture.
    const item = new ClipboardItem({
      "text/plain": transcriptPromise.then((t) => new Blob([t], { type: "text/plain" })),
    });
    navigator.clipboard.write([item]).then(
      () => { wrote = true; setBadge(true); },
      () => tier2()
    );
  } catch {
    tier2();
  }
  function tier2() {
    transcriptPromise.then(
      (t) => navigator.clipboard.writeText(t).then(() => { wrote = true; setBadge(true); }, () => setBadge(false)),
      () => {} // empty transcript: nothing to copy
    );
  }
  transcriptPromise.then(() => { if (!wrote) setBadge(false); }, () => {});
}

// ---------------------------------------------------------------- talk button

const talk = $("talk");
let activePointer = null;

talk.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (activePointer !== null) return;
  activePointer = e.pointerId;
  try { talk.setPointerCapture(e.pointerId); } catch {}
  pressStart();
});
talk.addEventListener("pointerup", (e) => {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  pressEnd();
});
talk.addEventListener("pointercancel", (e) => {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  pressEnd();
});
talk.addEventListener("contextmenu", (e) => e.preventDefault());

// Desktop browsers: optional hold-to-talk key while the tab is focused.
// The Windows shell drives the same pressStart/pressEnd via its global hook.
let keyHeld = false;
window.addEventListener("keydown", (e) => {
  const s = settings.getSettings();
  if (!s.desktopHotkey || bridge.isShell) return;
  if (e.code !== s.hotkeyCode || e.repeat || keyHeld) return;
  const t = document.activeElement && document.activeElement.tagName;
  if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
  keyHeld = true;
  e.preventDefault();
  pressStart();
});
window.addEventListener("keyup", (e) => {
  const s = settings.getSettings();
  if (!keyHeld || e.code !== s.hotkeyCode) return;
  keyHeld = false;
  e.preventDefault();
  pressEnd();
});

// Windows shell: global hotkey events arrive over the bridge.
bridge.onHotkey = (phase) => {
  if (phase === "down") pressStart();
  else pressEnd();
};
bridge.onPasteResult = (r) => {
  if (!r.ok) {
    notice(
      r.reason === "elevated"
        ? "That window is elevated. The transcript is on the clipboard, paste it yourself"
        : "Could not paste. The transcript is on the clipboard",
      "warn", 5000
    );
  }
};

// ---------------------------------------------------------------- result card

$("result-copy").addEventListener("click", async () => {
  const text = $("result-text").textContent;
  try {
    await navigator.clipboard.writeText(text);
    $("result-badge").textContent = "copied";
    $("result-badge").className = "badge";
  } catch {
    // last resort: select the text so the OS copy affordance can take over
    const range = document.createRange();
    range.selectNodeContents($("result-text"));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    notice("Select and copy manually", "warn");
  }
});
$("result-share").addEventListener("click", () => {
  navigator.share({ text: $("result-text").textContent }).catch(() => {});
});

// ---------------------------------------------------------------- views

function showView(name) {
  for (const v of document.querySelectorAll(".view")) v.classList.remove("active");
  $(`view-${name}`).classList.add("active");
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.view === name);
  if (name === "history") renderHistory();
  if (name === "usage") renderUsage();
}
for (const t of document.querySelectorAll(".tab")) {
  t.addEventListener("click", () => showView(t.dataset.view));
}

// ---------------------------------------------------------------- history view

async function renderHistory() {
  const q = $("history-search").value.trim().toLowerCase();
  const rows = await history.allEntries();
  const filtered = q ? rows.filter((r) => r.text.toLowerCase().includes(q)) : rows;
  const list = $("history-list");
  list.textContent = "";
  $("history-empty").hidden = filtered.length > 0;

  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  let lastDay = "";
  for (const r of filtered) {
    const d = new Date(r.ts);
    const day = dayFmt.format(d);
    if (day !== lastDay) {
      lastDay = day;
      const h = document.createElement("div");
      h.className = "history-day caps";
      h.textContent = day;
      list.appendChild(h);
    }
    const entry = document.createElement("div");
    entry.className = "history-entry";
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = r.text;
    const meta = document.createElement("div");
    meta.className = "meta";
    const time = document.createElement("time");
    time.textContent = `${timeFmt.format(d)} · ${(r.sec || 0).toFixed(1)}s`;
    const copy = document.createElement("button");
    copy.className = "btn-pill";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(r.text);
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy"), 1200);
      } catch {
        notice("Copy failed", "bad");
      }
    });
    meta.append(time, copy);
    entry.append(text, meta);
    list.appendChild(entry);
  }
}
$("history-search").addEventListener("input", renderHistory);

async function exportHistory() {
  const jsonl = await history.exportJsonl();
  if (!jsonl) { notice("History is empty", "warn"); return; }
  const blob = new Blob([jsonl], { type: "application/jsonl" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "history.jsonl";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$("history-export").addEventListener("click", exportHistory);
$("settings-export").addEventListener("click", exportHistory);

$("history-import").addEventListener("click", () => $("history-import-file").click());
$("history-import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const added = await history.importJsonl(await file.text());
  notice(`Imported ${added} entr${added === 1 ? "y" : "ies"}`, "ok");
  e.target.value = "";
  renderHistory();
});

// ---------------------------------------------------------------- usage view

async function renderUsage() {
  const rows = await history.allEntries();
  const s = monthStats(rows);
  $("usage-minutes").textContent = fmtMinutes(s.minutes);
  $("usage-cost").textContent = fmtMoney(s.cost);
  $("usage-rate").textContent = `at $${STREAMING_PER_MIN}/min`;
  $("usage-count").textContent = String(s.count);

  const bars = $("daily-bars");
  bars.textContent = "";
  const peak = Math.max(...s.dailyMinutes, 0);
  const peakIdx = s.dailyMinutes.indexOf(peak);
  s.dailyMinutes.forEach((m, i) => {
    const b = document.createElement("div");
    b.className = "bar" + (i + 1 > s.today ? " future" : m === 0 ? " zero" : i === peakIdx && peak > 0 ? " peak" : "");
    b.style.height = `${peak > 0 ? Math.max(4, (m / peak) * 100) : 4}%`;
    b.title = `Day ${i + 1}: ${fmtMinutes(m)}`;
    bars.appendChild(b);
  });

  const cmp = $("compare-bars");
  cmp.textContent = "";
  const maxV = Math.max(...COMPETITORS.map((c) => c.perMonth));
  const rowsData = [{ name: "Tiro", perMonth: s.cost, tiro: true }, ...COMPETITORS];
  for (const r of rowsData) {
    const row = document.createElement("div");
    row.className = "compare-row" + (r.tiro ? " tiro" : "");
    row.innerHTML = `<span class="name"></span><span class="track"><span class="fill"></span></span><span class="val"></span>`;
    row.querySelector(".name").textContent = r.name;
    row.querySelector(".fill").style.width = `${Math.min(100, (r.perMonth / maxV) * 100)}%`;
    row.querySelector(".val").textContent = fmtMoney(r.perMonth);
    cmp.appendChild(row);
  }
  $("usage-note").textContent =
    `You save ${fmtMoney(s.savedVsCheapest)} versus the cheapest subscription this month. ` +
    `Break-even is about ${Math.round(s.breakEvenHours)} hours of dictation a month.`;
}

// ---------------------------------------------------------------- settings view

async function saveAndTestKey(inputEl, statusEl) {
  const key = inputEl.value.trim();
  if (!key) { statusEl("Enter a key first", "bad"); return; }
  statusEl("Testing…", "warn");
  const r = await testKey(key);
  if (r.ok) {
    await settings.setApiKey(key);
    statusEl("Valid", "ok");
    $("setup-card").hidden = true;
    notice("Key saved. Hold the button and speak", "ok");
  } else {
    statusEl(
      r.kind === "auth" ? "Key rejected by Deepgram" : r.kind === "offline" ? "You are offline" : "Could not reach Deepgram",
      "bad"
    );
  }
}

$("settings-key-save").addEventListener("click", () =>
  saveAndTestKey($("settings-key"), (text, tone) => {
    const b = $("key-badge");
    b.hidden = false;
    b.textContent = text;
    b.className = "badge" + (tone === "ok" ? "" : tone === "bad" ? " bad" : " warn");
  })
);
$("setup-save").addEventListener("click", () =>
  saveAndTestKey($("setup-key"), (text, tone) => {
    $("setup-status").textContent = text;
    $("setup-status").style.color = tone === "bad" ? "var(--red-600)" : tone === "ok" ? "var(--green-600)" : "var(--ink-500)";
  })
);

$("set-warm").addEventListener("change", async (e) => {
  settings.setSetting("micWarm", e.target.checked);
  if (e.target.checked) {
    try { await engine.start(); } catch { notice("Microphone unavailable", "bad"); }
  } else if (state === "idle") {
    engine.stop();
  }
});
$("set-hotkey-on").addEventListener("change", (e) => settings.setSetting("desktopHotkey", e.target.checked));
$("set-hotkey").addEventListener("change", (e) => settings.setSetting("hotkeyCode", e.target.value));

$("settings-clear-history").addEventListener("click", async () => {
  if (!confirm("Delete all history on this device?")) return;
  await history.clearAll();
  notice("History cleared", "ok");
});
$("settings-clear-all").addEventListener("click", async () => {
  if (!confirm("Delete history, settings and the stored API key?")) return;
  await history.clearAll();
  settings.clearAllSettings();
  if (bridge.isShell) await bridge.storeKey("");
  location.reload();
});

// resampler acceptance check: record 5 s, rebuild a WAV, play it back
$("debug-wav").addEventListener("click", async () => {
  const status = $("debug-wav-status");
  try {
    await engine.start();
  } catch {
    status.textContent = "mic unavailable";
    return;
  }
  const chunks = [];
  const prevChunk = engine.onChunk;
  engine.onChunk = (c) => chunks.push(c);
  engine.beginRecording();
  let left = 5;
  status.textContent = `recording… ${left}`;
  const iv = setInterval(() => { left--; status.textContent = `recording… ${left}`; }, 1000);
  await new Promise((r) => setTimeout(r, 5000));
  clearInterval(iv);
  engine.endRecording();
  engine.onChunk = prevChunk;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Int16Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  status.textContent = "playing back…";
  const audio = new Audio(URL.createObjectURL(int16ToWav(all)));
  audio.onended = () => { status.textContent = "done. Correct pitch means the resampler is right"; };
  audio.play();
});

// ---------------------------------------------------------------- boot

async function boot() {
  // Which build this is. The EXE ships with the web core, so its version
  // normally matches; if someone has mixed the two, say both numbers rather
  // than picking one and being wrong.
  const mixed = bridge.hostVersion && bridge.hostVersion !== VERSION;
  $("about-version").textContent =
    mixed ? `web core ${VERSION} · windows app ${bridge.hostVersion}`
      : `${VERSION} · ${bridge.isShell ? "windows app" : "web app"}`;

  // Windows shell: the DPAPI-held key wins over any cached one.
  if (bridge.isShell) {
    const hostKey = await bridge.fetchKey();
    if (hostKey) localStorage.setItem("tiro.apiKey", hostKey);
    $("key-storage-note").textContent = "Held by Windows (DPAPI, this user only).";
    $("hotkey-title").textContent = "global hotkey";
    $("hotkey-enable-row").hidden = true;
    $("hotkey-note").hidden = false;
    $("talk-hint").textContent = "Hold the hotkey in any app, or use this button.";
    document.body.classList.add("shell");
  }

  const s = settings.getSettings();
  $("set-warm").checked = s.micWarm;
  $("set-hotkey-on").checked = s.desktopHotkey;
  $("set-hotkey").value = s.hotkeyCode;
  if (settings.getApiKey()) {
    $("settings-key").value = settings.getApiKey();
    $("key-badge").hidden = false;
    $("key-badge").textContent = "saved";
  } else {
    $("setup-card").hidden = false;
  }

  history.requestPersistence();

  // iOS install hint: Safari only, not already installed, not dismissed
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (isIos && !standalone && !localStorage.getItem("tiro.a2hsDismissed") && !bridge.isShell) {
    $("a2hs").hidden = false;
  }
  $("a2hs-dismiss").addEventListener("click", () => {
    localStorage.setItem("tiro.a2hsDismissed", "1");
    $("a2hs").hidden = true;
  });

  window.addEventListener("online", () => notice("Back online", "ok", 1600));
  window.addEventListener("offline", () => notice("You are offline. History still works", "warn"));

  if ("serviceWorker" in navigator && !bridge.isShell) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot();
