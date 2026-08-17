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
import { Installer } from "./install.js";
import { ShareSheet } from "./share.js";
import { sheetIsOpen } from "./sheet.js";
import { VERSION } from "./version.js";

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- state

// idle -> holdRecording -> (released > threshold) -> transcribing -> idle
//                       -> (released < threshold) -> toggleRecording -> (tap) -> transcribing
let state = "idle";
let pressedAt = 0;
let stream = null;      // DeepgramStream for the current take
// The same take once stopAndInsert has taken it off `stream` and is draining
// finals. It has to stay reachable: discarding while transcribing otherwise has
// nothing to close, and the socket stays open with its keepalive armed for as
// long as the page lives. That is the orphaned billed socket of PWA-02, reached
// by a different road.
let finishing = null;
let timerHandle = null;
let recordStartedAt = 0;

// Identifies the take in flight. Discarding one bumps it, which is how a
// discarded take's own async tail knows it is stale.
//
// A boolean would be wrong here, and the race is not theoretical: cancelling
// while transcribing returns to idle immediately, but the socket is still
// draining finals and can take another second to resolve. Nothing stops the
// user starting a fresh take inside that second, and a shared flag would be
// cleared by the new take just in time for the discarded one to paste.
let takeToken = 0;

const engine = new AudioEngine();
engine.onDeviceChange = () => notice("Mic changed, reconnected", "warn");

// ---------------------------------------------------------------- ui helpers

function setState(next) {
  state = next;
  const talk = $("talk"), label = $("talk-label"), head = $("head-status");
  talk.classList.toggle("recording", next === "holdRecording" || next === "toggleRecording");
  talk.classList.toggle("transcribing", next === "transcribing");
  head.classList.toggle("recording", next === "holdRecording" || next === "toggleRecording");
  const recording = next === "holdRecording" || next === "toggleRecording";
  const live = recording || next === "transcribing";
  // Blanked rather than hidden once the clock stops: removing it re-centres the
  // row and slides Discard sideways at the exact moment someone is reaching for
  // it. A frozen clock would read as still counting, so it keeps its box and
  // gives up its digits.
  $("timer").classList.toggle("is-blank", !recording);
  // Discard outlives the timer by one state: once the audio is sent there is no
  // clock left to run, but there is still a transcript you may not want pasted,
  // and that is the moment people realise it.
  $("take-meta").hidden = !live;
  // The timer takes the hint's slot while a take runs, so the page does not
  // reflow under a thumb that is mid-press.
  $("talk-hint").classList.toggle("is-faded", live);
  // Drive the halo from the state itself, not from one branch below: a take
  // that starts in toggle mode has to breathe too. The pill's feed starts with
  // it and stops itself once the bars have fallen.
  if (next === "holdRecording" || next === "toggleRecording") { startHalo(); startLevelFeed(); }
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
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

// ---------------------------------------------------------------- level halo
//
// The ring behind the button breathes with your voice. Three things make or
// break how it feels, and all three were wrong before:
//
//  1. The CSS carried `transition: opacity` while this loop rewrote opacity
//     every frame. Each write restarted a 200 ms transition that the next frame
//     replaced, so the ring never reached any value it was told to. It smeared
//     and lagged behind the voice. The transition is gone; smoothing happens
//     here, on the number, where it can be tuned.
//  2. Raw RMS through automatic gain control sits around 0.05–0.15 for ordinary
//     speech, so the old `level * 3.2` never got near 1 and the ring barely
//     moved. Normalising between a noise floor and a realistic ceiling, then
//     bending the curve, uses the whole range.
//  3. Nothing reset the transform when recording stopped, so the ring froze at
//     whatever size the last word left it.

const HALO_FLOOR = 0.012;   // below this is room tone, not speech
const HALO_CEIL = 0.22;     // a firm speaking voice through AGC
const HALO_ATTACK = 0.45;   // rise fast enough to feel like a response
const HALO_DECAY = 0.12;    // fall slowly enough not to strobe between syllables

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let haloValue = 0;          // smoothed 0..1, the number actually drawn
let haloRunning = false;

function isRecordingState() {
  return state === "holdRecording" || state === "toggleRecording";
}

/** RMS as the meter should draw it: 0 at room tone, 1 at a firm speaking voice,
 * with the curve bent to open up the quiet end where normal speech lives.
 * Shared, because the halo and the Windows pill must agree. */
function normaliseLevel(rms) {
  const norm = (rms - HALO_FLOOR) / (HALO_CEIL - HALO_FLOOR);
  return Math.pow(Math.max(0, Math.min(1, norm)), 0.6);
}

// ------------------------------------------------- level feed for the host
//
// The halo's own loop cannot carry this. It runs on requestAnimationFrame, and
// the Windows app's normal state is a tray icon with its window hidden: WebView2
// marks a hidden host window invisible, Chromium stops producing frames for an
// invisible page, and rAF stops being called. The take itself is unaffected,
// because the AudioWorklet runs on the audio thread, so everything would look
// fine and the pill's waveform would simply never move for anyone who had closed
// the window. Which is everyone.
//
// So the pill gets its own clock. setInterval survives an invisible page, though
// only because MainForm passes --disable-background-timer-throttling; without
// that flag Chromium clamps hidden-page timers to one second and the waveform
// would tick once a second instead of twenty times.
const LEVEL_HZ_MS = 50;
// Per-tick equivalents of the halo's per-frame rates at 60 Hz: three frames fit
// in 50 ms, so 1-(1-0.45)^3 and 1-(1-0.12)^3. Same feel, different clock.
const LEVEL_ATTACK = 0.83;
const LEVEL_DECAY = 0.32;
let levelTimer = null;
let levelValue = 0;

function startLevelFeed() {
  if (levelTimer || !bridge.isShell) return;
  levelValue = 0;
  levelTimer = setInterval(() => {
    const target = isRecordingState() ? normaliseLevel(engine.level) : 0;
    levelValue += (target - levelValue) * (target > levelValue ? LEVEL_ATTACK : LEVEL_DECAY);
    bridge.setLevel(levelValue);
    // Stop once it has settled, not the moment recording stops, so the bars fall
    // rather than snapping flat.
    if (!isRecordingState() && levelValue < 0.01) stopLevelFeed();
  }, LEVEL_HZ_MS);
}

function stopLevelFeed() {
  if (!levelTimer) return;
  clearInterval(levelTimer);
  levelTimer = null;
  levelValue = 0;
  bridge.setLevel(0);
}

function startHalo() {
  if (haloRunning) return; // one loop only, however many times we are called
  haloRunning = true;
  const halo = $("halo");

  const tick = () => {
    const recording = isRecordingState();
    // Target is the voice while recording, and zero once it stops, so the ring
    // eases back down instead of snapping off mid-pulse.
    const target = recording ? normaliseLevel(engine.level) : 0;
    const rate = target > haloValue ? HALO_ATTACK : HALO_DECAY;
    haloValue += (target - haloValue) * rate;

    if (!recording && haloValue < 0.01) {
      // settled: park it clean so the next take starts from a known state
      haloValue = 0;
      halo.style.opacity = "0";
      halo.style.transform = "scale(1)";
      haloRunning = false;
      return;
    }

    if (reducedMotion.matches) {
      // A steady ring still says "recording" without any motion at all.
      halo.style.opacity = recording ? "0.6" : String(haloValue * 0.6);
      halo.style.transform = "scale(1.1)";
    } else {
      halo.style.opacity = String((0.3 + haloValue * 0.55) * (recording ? 1 : haloValue));
      halo.style.transform = `scale(${1 + haloValue * 0.42})`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// The toast is a live region, so it stays in the DOM and is shown and hidden
// with an attribute rather than `hidden`. A region added to the page at the
// moment it gains text is one a screen reader is entitled to ignore.
let toastTimer = null;
/**
 * @param {object} [action]  {label, onClick} turns the toast into an offer: it
 *   gains a button and stops timing out, because something you are being asked
 *   to decide must not disappear while you are reading it.
 */
// A sticky offer survives the ordinary traffic that lands on top of it. Copying
// a transcript while deciding whether to update used to wipe the offer for the
// rest of the session: "Copied" reused this one element, cleared the buttons,
// and took the offer down on its own 1.4 second timer.
let standingOffer = null;

function notice(text, tone = "warn", ms = 3200, action = null) {
  if (action) standingOffer = { text, tone, action };
  $("toast-text").textContent = text;
  $("toast-dot").className = "dot " + (tone === "ok" ? "ok" : tone === "bad" ? "bad" : "");
  const button = $("toast-action");
  button.hidden = !action;
  button.onclick = action ? action.onClick : null;
  if (action) button.textContent = action.label;
  // A sticky offer needs a way out, or it is just a banner you cannot close.
  const dismiss = $("toast-dismiss");
  dismiss.hidden = !action;
  dismiss.onclick = action
    ? () => {
        standingOffer = null;
        $("toast").dataset.open = "false";
        $("toast-text").textContent = "";
        if (action.onDismiss) action.onDismiss();
      }
    : null;
  // An offer carries buttons on its right; a plain message does not, and the
  // padding differs because of it (see .toast in app.css).
  $("toast").classList.toggle("is-offer", !!action);
  $("toast").dataset.open = "true";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  if (action) return;
  toastTimer = setTimeout(() => {
    // Hand the toast back to the offer it interrupted, rather than closing on it.
    if (standingOffer) {
      const { text: t, tone: n, action: a } = standingOffer;
      notice(t, n, 0, a);
      return;
    }
    $("toast").dataset.open = "false";
    $("toast-text").textContent = "";
  }, ms);
}

// ---------------------------------------------------------------- recording

// Opening the mic is asynchronous, and on first run it waits on a permission
// prompt that can sit there for seconds. Everything between the press and
// setState("holdRecording") is therefore a window in which a release can arrive
// with nothing to release, and a second press can start a second take on top of
// the first. `starting` closes both.
let starting = false;
let releasedWhileStarting = false;

/** A press that produced no take, said once in each place that can show it.
 *
 * Every refusal below used to be a `notice()` and nothing else, which is the
 * right answer in a browser and no answer at all in the shell, where the window
 * holding that toast is hidden by design. Routing them through here keeps the
 * two ends from drifting: there is one call per refusal, and both surfaces are
 * fed from it. See bridge.problem for what the host does with it. */
function refuseTake(text, tone = "bad", open = false) {
  notice(text, tone, 5000);
  bridge.problem(text, open);
}

async function pressStart() {
  if (starting) return;                    // one take may be opening at a time
  if (state === "transcribing") return;
  if (state === "holdRecording") return;   // already running; a second stream would orphan the first
  if (state === "toggleRecording") return; // handled on release: stop-and-insert

  const key = settings.getApiKey();
  if (!key) {
    // The view change is still worth doing even when nobody is looking: it is
    // what the window opens onto when they take the pill up on it.
    showView("settings");
    $("settings-key").focus();
    refuseTake("Add your Deepgram key first", "warn", true);
    return;
  }
  if (!navigator.onLine) {
    refuseTake("You are offline");
    return;
  }

  starting = true;
  releasedWhileStarting = false;
  const token = ++takeToken; // any earlier take's tail is now stale
  try {
    await engine.start(); // no-op when already warm
  } catch {
    starting = false;
    refuseTake("No microphone. Check permissions");
    return;
  }

  // Discarded while the mic was still opening. On first run that window is the
  // whole permission prompt, which is exactly when someone realises they hit
  // the wrong key, so this is the likeliest cancel of all and the one that
  // would otherwise come back to life as a live take seconds later.
  if (token !== takeToken) {
    starting = false;
    releasedWhileStarting = false;
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
  // The card it was opened over is gone, so the sheet is now offering to send a
  // transcript that is no longer on screen. No-op unless it is actually up.
  shareSheet.close();

  // Adopt the pre-roll and stream. Chunks buffer locally until the socket is
  // open, so connect latency cannot clip the first word.
  engine.onChunk = (c) => stream && stream.send(c);
  engine.beginRecording();
  setState("holdRecording");
  starting = false;

  if (releasedWhileStarting) {
    releasedWhileStarting = false;
    // The press ended before the mic was open. That is the first run, where the
    // permission prompt sits in front of everything. There is no audio yet, and
    // the user gesture is long gone, so a stop here would transcribe silence and
    // be refused the clipboard anyway. Hands-free mode is the useful landing.
    setState("toggleRecording");
    notice("Recording. Tap the button when you're done", "warn", 4000);
  }

  const take = stream;
  take.start().catch((err) => {
    // The socket never opened; kill the take with a precise message. Connecting
    // can outlast the take itself, since the open timeout is longer than plenty
    // of presses, so only clean up if this is still the take on screen. If it is
    // not, stopAndInsert already owns it and is mid-transcribe.
    if (stream !== take) return;
    engine.endRecording();
    engine.onChunk = null;
    stream.abort();
    stream = null;
    // Before the message, or the state change hides the pill the message is
    // about to be drawn on.
    setState("idle");
    refuseTake(
      err.kind === "auth" ? "Deepgram rejected your key. Check Settings"
        : err.kind === "offline" ? "You are offline"
        : "Could not reach Deepgram",
      "bad",
      err.kind === "auth"
    );
  });
}

function pressEnd() {
  if (starting) { releasedWhileStarting = true; return; }
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
  finishing = s;
  setState("transcribing");
  const token = takeToken;

  // Re-point the engine at the take we just took off `stream`. The chunk handler
  // set up in pressStart closes over the module-level `stream`, which the line
  // above just set to null, so for the whole of TAIL_SEC it evaluated to
  // `null && …` and sent nothing. The tail existed but was empty: the last half
  // second of speech was captured, counted as billable, and then dropped on the
  // floor, which is precisely the clipped last word it was added to prevent.
  engine.onChunk = (c) => s.send(c);

  const transcriptPromise = (async () => {
    // keep streaming through the tail so the last word is not clipped
    await new Promise((r) => setTimeout(r, TAIL_SEC * 1000));
    // Discarded during the tail. Bail *before* touching the engine, not after
    // the transcript arrives: cancelTake has already detached it, and by now the
    // user may well have started a fresh take. Checking only at the end meant
    // this stale tail called endRecording() and nulled onChunk on the take that
    // replaced it, which killed the next take's audio silently.
    if (token !== takeToken) { s.abort(); throw new Error("discarded"); }
    const sec = Math.round(engine.endRecording() * 10) / 10;
    engine.onChunk = null;
    const text = await s.finish();
    if (finishing === s) finishing = null; // finish() closed it
    // Discarded while the finals were still draining. Drop the text on the
    // floor: no result card, no history, no clipboard, no paste. cancelTake has
    // already put the UI back to idle, so there is nothing to undo here.
    if (token !== takeToken) throw new Error("discarded");
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

/** Throw the take away. The counterpart to stopAndInsert, and the thing that was
 * missing entirely: before this, everything you said reached the clipboard or
 * the focused app whether you meant it to or not, and the only way out of a
 * misfire was to undo the paste afterwards.
 *
 * Two shapes, because the audio has already left the building in the second:
 *  - still recording: abort the socket, nothing was ever transcribed
 *  - transcribing: the take is mid-flight, so bump the token and let its own
 *    tail discover it is stale. Deepgram still bills for the seconds already
 *    streamed; discarding is about not pasting, not about a refund. */
function cancelTake() {
  // `starting` matters as much as the state does: between the press and the mic
  // opening the state is still "idle", and that gap is where a first-run
  // permission prompt lives.
  if (state === "idle" && !starting) return;
  takeToken++;

  // Detach the engine in both shapes, not just while recording. When the take is
  // already transcribing its own tail is asleep in TAIL_SEC and will bail on the
  // stale token before it reaches endRecording, so if this does not release the
  // mic nothing will: it stays flagged as recording and keeps billing samples to
  // a take nobody will ever read.
  // `stream` while recording, `finishing` while transcribing. Closing it here
  // rather than leaving it to the stale tail matters: the tail is asleep in
  // TAIL_SEC, so waiting for it keeps a live socket open for half a second after
  // the user has already been told the take is gone.
  const s = stream || finishing;
  stream = null;
  finishing = null;
  engine.endRecording();
  engine.onChunk = null;
  if (s) s.abort();

  $("live").hidden = true;
  $("live-final").textContent = "";
  $("live-interim").textContent = "";
  setState("idle");
  if (!settings.getSettings().micWarm) engine.stop();
  notice("Discarded", "warn", 2000);
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
  setCopied(false); // a new transcript is a different thing to copy
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  history.addEntry({ ts, text, sec }).catch(() => {});
  bridge.appendHistory(JSON.stringify({ ts, text, sec }));

  // The one moment worth asking someone to install: they have just watched
  // their own voice turn into text and the answer is not theoretical. Asking on
  // arrival, before the app has proved anything, is how install prompts teach
  // people to dismiss install prompts. No-op unless this is iOS Safari, where
  // installing is the difference between keeping your key and losing it.
  installer.offerAfterSuccess();
}

/** The one place that decides what the Copy button says.
 *
 * It replaced a chip in the corner of the card reading "copied" / "tap copy",
 * which was the only confirmation there was and was missed by everyone: it sat
 * away from the button, in the size of a label rather than an answer. The
 * button says it about itself instead, where the tap already is.
 *
 * It answers a press and nothing else. The automatic clipboard write below
 * still happens on every take, and reporting that here was tried: the card
 * arrived already reading "Copied", which is true, and reads as a state you did
 * not cause and cannot tell apart from one you did. So the automatic write says
 * nothing, and this word means "you pressed it, and it worked".
 *
 * It then stands until there is a different transcript to copy, rather than
 * timing out, because it is a statement about the clipboard. Pressing an
 * already copied button therefore changes no text at all, which would leave the
 * second press unanswered: restarting the animation is what answers it. */
function setCopied(done) {
  const button = $("result-copy");
  $("result-copy-label").textContent = done ? "Copied" : "Copy";
  button.querySelector("use").setAttribute("href", done ? "#i-check" : "#i-copy");
  button.classList.remove("is-done");
  if (!done) return;
  void button.offsetWidth; // reflow: without it the class comes back mid-frame and nothing replays
  button.classList.add("is-done");
}

// Clipboard tiers (SPEC-PWA 1.4). Tier 3, the visible Copy button on the
// result card, is always available regardless.
//
// This reports nothing, either way. Success is silent because the button is an
// answer to a press and this is not one (see setCopied). Failure is silent
// because what it leaves behind is the untouched Copy button, which is the
// instruction a failure needs. The old chip tried to say both and got the happy
// path wrong as well (AUDIT PWA-09): its "tap copy" was queued off the
// transcript promise, which necessarily settles before the clipboard write it
// feeds, so it flashed up on every successful copy.
function writeClipboardTiered(transcriptPromise) {
  try {
    // Tier 1: promise-valued ClipboardItem, created synchronously in the gesture.
    const item = new ClipboardItem({
      "text/plain": transcriptPromise.then((t) => new Blob([t], { type: "text/plain" })),
    });
    navigator.clipboard.write([item]).catch(() => tier2());
  } catch {
    tier2();
  }
  function tier2() {
    transcriptPromise.then(
      (t) => navigator.clipboard.writeText(t).catch(() => {}),
      () => {} // empty transcript: nothing to copy
    );
  }
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

// The button was pointer-only, which left anyone on a keyboard, or on a switch
// or a screen reader driving the focused control, with no way to dictate at
// all. Space and Enter hold it: down starts the take, up ends it, exactly like a
// finger. `preventDefault` stops the page scrolling and stops the browser
// synthesising a click that would fire a second press.
let spaceHeld = false;
talk.addEventListener("keydown", (e) => {
  if (e.key !== " " && e.key !== "Enter") return;
  e.preventDefault();
  if (e.repeat || spaceHeld) return;
  spaceHeld = true;
  pressStart();
});
talk.addEventListener("keyup", (e) => {
  if (e.key !== " " && e.key !== "Enter") return;
  e.preventDefault();
  if (!spaceHeld) return;
  spaceHeld = false;
  pressEnd();
});
// Focus lost mid-hold (tabbing away, an alert) must not leave a take running.
talk.addEventListener("blur", () => {
  if (!spaceHeld) return;
  spaceHeld = false;
  pressEnd();
});

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

// Escape discards the take, anywhere in the app, including from inside a text
// field: reaching for it mid-dictation means one thing.
//
// The sheets bind Escape too (install.js, share.js), and both handlers would
// fire on the one press if one were open during a take, so this stands down
// while any sheet is up. That ordering is the conventional one and the safer
// one: closing a sheet is undoable, and throwing a take away is not.
//
// In the Windows shell this only fires when the Tiro window itself has focus,
// which it usually does not. The host hooks Escape globally and sends
// {type:"cancel"} instead, landing on the same function.
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (state === "idle" && !starting) return;
  if (sheetIsOpen()) return;
  e.preventDefault();
  cancelTake();
});

$("discard").addEventListener("click", (e) => {
  e.preventDefault();
  cancelTake();
});

// Windows shell: global hotkey events arrive over the bridge.
bridge.onHotkey = (phase) => {
  if (phase === "down") pressStart();
  else pressEnd();
};
// The pill's X and check, clicked in whatever app the user is dictating into.
bridge.onCancel = () => cancelTake();
bridge.onStop = () => {
  if (isRecordingState()) stopAndInsert();
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
    setCopied(true);
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
  shareSheet.open($("result-text").textContent);
});

// ---------------------------------------------------------------- views

function showView(name) {
  for (const v of document.querySelectorAll(".view")) v.classList.remove("active");
  $(`view-${name}`).classList.add("active");
  for (const t of document.querySelectorAll(".tab")) {
    const on = t.dataset.view === name;
    t.classList.toggle("active", on);
    // aria-current is what tells a screen reader which of the four you are on;
    // the colour change alone says it to sighted users only.
    if (on) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  if (name === "history") renderHistory();
  if (name === "usage") renderUsage();
}
for (const t of document.querySelectorAll(".tab")) {
  t.addEventListener("click", () => showView(t.dataset.view));
}

// Escape closes the install sheet, so it closes a standing offer too. A thing
// on screen that will not go away on the key everyone reaches for is a thing
// people learn to work around.
//
// It stands down during a take, because Escape now also discards one. An offer
// raised before the take started is still on screen, so without this the one
// key press would both throw the recording away and mark the release dismissed,
// and dismissing is remembered: that version would never be offered again.
// Discarding is what the user meant; the offer can wait.
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (state !== "idle") return;
  // A sheet on top owns the key: dismissing the offer behind it as well would
  // spend a decision the user never made, and dismissals are remembered.
  if (sheetIsOpen()) return;
  if ($("toast").dataset.open !== "true" || $("toast-dismiss").hidden) return;
  $("toast-dismiss").click();
});

// The header keeps its hairline until something has actually scrolled under it.
const appHead = document.querySelector(".app-head");
addEventListener("scroll", () => {
  appHead.classList.toggle("is-scrolled", window.scrollY > 4);
}, { passive: true });

// ---------------------------------------------------------------- history view

/** An icon button whose label is text, not a picture: every one of these needs
 * a name a screen reader can read out, and a shape a thumb can hit. */
function iconButton(icon, label, onClick, extraClass = "") {
  const b = document.createElement("button");
  b.className = "icon-btn" + (extraClass ? " " + extraClass : "");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  b.innerHTML = `<svg aria-hidden="true" focusable="false"><use href="#${icon}"/></svg>`;
  b.addEventListener("click", onClick);
  return b;
}

function setIcon(button, icon) {
  button.querySelector("use").setAttribute("href", `#${icon}`);
}

async function renderHistory() {
  const q = $("history-search").value.trim().toLowerCase();
  const rows = await history.allEntries();
  const filtered = q ? rows.filter((r) => r.text.toLowerCase().includes(q)) : rows;
  const list = $("history-list");
  list.textContent = "";
  $("history-clear-search").hidden = !q;
  $("history-empty").hidden = filtered.length > 0;
  $("history-empty-text").textContent = q
    ? `No transcript matches “${$("history-search").value.trim()}”.`
    : "Nothing here yet. Everything you dictate lands in history, on this device only.";
  $("history-count").textContent = rows.length
    ? `${filtered.length} of ${rows.length} ${rows.length === 1 ? "take" : "takes"}`
    : "";

  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  let lastDay = "";
  for (const r of filtered) {
    const d = new Date(r.ts);
    const day = dayFmt.format(d);
    if (day !== lastDay) {
      lastDay = day;
      const h = document.createElement("h3");
      h.className = "history-day caps";
      h.textContent = day;
      list.appendChild(h);
    }
    const entry = document.createElement("article");
    entry.className = "history-entry";
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = r.text;
    const meta = document.createElement("div");
    meta.className = "meta";
    const time = document.createElement("time");
    time.dateTime = r.ts;
    time.textContent = `${timeFmt.format(d)} · ${(r.sec || 0).toFixed(1)}s`;

    const actions = document.createElement("div");
    actions.className = "actions";
    const copy = iconButton("i-copy", "Copy this transcript", async () => {
      try {
        await navigator.clipboard.writeText(r.text);
        setIcon(copy, "i-check");
        copy.classList.add("is-done");
        notice("Copied", "ok", 1400);
        setTimeout(() => { setIcon(copy, "i-copy"); copy.classList.remove("is-done"); }, 1400);
      } catch {
        notice("Copy failed", "bad");
      }
    });
    const del = iconButton("i-trash", "Delete this transcript", async () => {
      await history.deleteEntry(r.id);
      notice("Deleted", "ok", 1600);
      renderHistory();
    }, "danger");
    actions.append(copy, del);

    meta.append(time, actions);
    entry.append(text, meta);
    list.appendChild(entry);
  }
}
$("history-search").addEventListener("input", renderHistory);
$("history-clear-search").addEventListener("click", () => {
  $("history-search").value = "";
  $("history-search").focus();
  renderHistory();
});

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

const ordinal = (n) =>
  n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";

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
  // A row of bars is a picture. Say in words what it shows, or it is nothing at
  // all to anyone not looking at it.
  bars.setAttribute(
    "aria-label",
    peak > 0
      ? `Minutes dictated per day this month. Busiest day: the ${peakIdx + 1}${ordinal(peakIdx + 1)}, ${fmtMinutes(peak)}.`
      : "Minutes dictated per day this month. Nothing dictated yet."
  );
  $("daily-last").textContent = `today, day ${s.today}`;

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

async function saveAndTestKey(inputEl, statusEl, button) {
  const key = inputEl.value.trim();
  if (!key) {
    statusEl("Enter a key first", "bad");
    inputEl.focus();
    return;
  }
  statusEl("Testing…", "warn");
  // A key test is a network round trip. Say so on the button that started it,
  // and refuse a second one rather than racing two sockets.
  const label = button && button.textContent;
  if (button) { button.disabled = true; button.textContent = "Testing…"; }
  const r = await testKey(key);
  if (button) { button.disabled = false; button.textContent = label; }
  if (r.ok) {
    await settings.setApiKey(key);
    statusEl("Valid", "ok");
    $("setup-card").hidden = true;
    document.body.classList.remove("needs-setup");
    notice("Key saved. Hold the button and speak", "ok");
  } else {
    // "Could not reach Deepgram" rather than anything about the key: the test
    // never got an answer, so it has learned nothing about the key, and saying
    // otherwise sends people to replace one that works. Only r.kind === "auth"
    // means Deepgram itself refused it.
    statusEl(
      r.kind === "auth" ? "Key rejected by Deepgram"
        : r.kind === "offline" ? "You are offline"
        : "No answer from Deepgram. Check your connection, then the key",
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
  }, $("settings-key-save"))
);
$("setup-save").addEventListener("click", () =>
  saveAndTestKey($("setup-key"), (text, tone) => {
    $("setup-status").textContent = text;
    $("setup-status").style.color =
      tone === "bad" ? "var(--bad-fg)" : tone === "ok" ? "var(--ok-fg)" : "var(--text-muted)";
  }, $("setup-save"))
);

// Typing a 40-character key into a dot field with no way to check it is how
// people end up with "key rejected" and no idea which character went wrong.
$("settings-key-reveal").addEventListener("click", () => {
  const input = $("settings-key");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  const btn = $("settings-key-reveal");
  btn.setAttribute("aria-pressed", String(show));
  btn.setAttribute("aria-label", show ? "Hide key" : "Show key");
  btn.title = show ? "Hide key" : "Show key";
  btn.querySelector("use").setAttribute("href", show ? "#i-eye-off" : "#i-eye");
});

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
  renderHistory(); // the History view is one tap away and must not show ghosts
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

// ---------------------------------------------------------------- install

const installer = new Installer(
  {
    button: $("install-btn"),
    card: $("install-card"),
    cardButton: $("install-card-btn"),
    sheet: $("install-sheet"),
    panel: $("install-panel"),
    title: $("install-title"),
    lede: $("install-lede"),
    visual: $("install-visual"),
    steps: $("install-steps"),
    doButton: $("install-do"),
    copyButton: $("install-copy"),
    closeButton: $("install-close"),
  },
  notice
);

// ---------------------------------------------------------------- share

const shareSheet = new ShareSheet(
  {
    sheet: $("share-sheet"),
    panel: $("share-panel"),
    preview: $("share-preview"),
    targets: $("share-targets"),
    closeButton: $("share-close"),
  },
  notice
);

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
    // first run: the card is the task, so the record view stops trying to
    // centre the button in a screen that no longer has room for it
    document.body.classList.add("needs-setup");
  }

  history.requestPersistence();

  installer.start({ isShell: bridge.isShell });
  shareSheet.start();

  window.addEventListener("online", () => notice("Back online", "ok", 1600));
  window.addEventListener("offline", () => notice("You are offline. History still works", "warn"));

  if ("serviceWorker" in navigator && !bridge.isShell) {
    navigator.serviceWorker.register("sw.js").then(watchForUpdate).catch(() => {});
  }
}

// ---------------------------------------------------------------- updates
//
// An installed web app has no App Store to tell you it is out of date, and the
// service worker updates it silently, so before this the only way to know you
// were a version behind was to notice something looked different. Now the new
// version downloads in the background exactly as it did, waits instead of
// taking over, and says so.
//
// Nothing here talks to anything but Tiro's own origin: the browser re-fetches
// the same files it is already serving. No version endpoint, no check-in, no
// request that says a copy of Tiro exists on this device.

const UPDATE_CHECK_MS = 60 * 60 * 1000; // hourly at most, and only while in use
let lastUpdateCheck = Date.now();
let reloading = false;

// ---- when an update is worth interrupting someone over -------------------
//
// The version number already says what changed, because the release rules make
// it say so: the middle number moves when something is added or the interface
// changes, the last one when a fix is the whole story. So:
//
//   1.2.0 -> 1.3.0   something new. Worth one interruption.
//   1.2.0 -> 1.2.1   a fix. Not worth stopping someone mid-sentence for; it
//                    lands the next time they open the app anyway.
//   1.2.0 -> 1.2.3   two or more fixes deep. That is no longer "a typo", it is
//                    a pile of things you are missing, so say it once.
//
// Whatever we do decide to show is shown **once per version**: dismissing 1.3.0
// means never being asked about 1.3.0 again, only about whatever comes after.
// An update prompt that reappears is how people learn to dismiss them unread.

const DISMISSED_KEY = "tiro.update.dismissed";
const PATCH_PILE_UP = 2;

const parseVersion = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || "").trim());
  return m ? m.slice(1, 4).map(Number) : null;
};

/** "feature" | "fixes" | "quiet" | null — null when it is not an update at all. */
export function updateWorth(current, next) {
  const a = parseVersion(current);
  const b = parseVersion(next);
  if (!a || !b) return null;
  if (b[0] > a[0]) return "feature";
  if (b[0] < a[0]) return null;
  if (b[1] > a[1]) return "feature";
  if (b[1] < a[1]) return null;
  if (b[2] <= a[2]) return null;
  return b[2] - a[2] >= PATCH_PILE_UP ? "fixes" : "quiet";
};

const alreadyDismissed = (version) => {
  try { return localStorage.getItem(DISMISSED_KEY) === version; } catch { return false; }
};
const rememberDismissed = (version) => {
  try { localStorage.setItem(DISMISSED_KEY, version); } catch {}
};

function watchForUpdate(reg) {
  if (!reg) return;

  // Already downloaded, from a previous visit that did not take the offer.
  if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

  // Already downloading when we got here: `updatefound` fired before this
  // listener existed, so watch the worker itself or the update goes unmentioned
  // until the next launch.
  if (reg.installing && navigator.serviceWorker.controller) {
    const early = reg.installing;
    early.addEventListener("statechange", () => {
      if (early.state === "installed") offerUpdate(early);
    });
  }

  reg.addEventListener("updatefound", () => {
    const incoming = reg.installing;
    if (!incoming) return;
    incoming.addEventListener("statechange", () => {
      // `controller` is null on the very first visit, when "installed" means
      // "Tiro is now available offline" rather than "there is a new version".
      if (incoming.state === "installed" && navigator.serviceWorker.controller) {
        offerUpdate(incoming);
      }
    });
  });

  // The browser checks for a new worker on navigation, which an installed app
  // does rarely — it is opened and left. Ask again when it comes back to the
  // foreground, no more than hourly.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    // A worker that is already waiting will not fire `updatefound` again, so a
    // first attempt that failed — the version probe needs the network, and the
    // most likely moment to be offline is the moment an update lands — would
    // never be retried. Ask again for the worker that is sitting there.
    if (reg.waiting && !updateOffered) offerUpdate(reg.waiting);
    if (Date.now() - lastUpdateCheck < UPDATE_CHECK_MS) return;
    lastUpdateCheck = Date.now();
    reg.update().catch(() => {});
  });

  // Same reason: coming back online is the other moment a failed probe becomes
  // answerable, and it is a cheaper signal than waiting an hour.
  addEventListener("online", () => {
    if (reg.waiting && !updateOffered) offerUpdate(reg.waiting);
  });

  // The new worker took over: everything on screen is now the old version's.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloading) return; // only ever reload for an update the user asked for
    location.reload();
  });
}

/** The version the site is serving now, or null if it cannot be read or has not
 * moved. `?fresh` is what gets past our own service worker: without it this
 * request is answered out of a cache — possibly the one belonging to the very
 * version we are running — and every update would look like no update at all. */
async function incomingVersion() {
  try {
    const res = await fetch(`src/version.js?fresh=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const found = (await res.text()).match(/VERSION\s*=\s*"([\d.]+)"/);
    return found && found[1] !== VERSION ? found[1] : null;
  } catch {
    return null;
  }
}

let updateOffered = false;
let updateChecking = false;
async function offerUpdate(worker) {
  if (updateOffered || updateChecking) return;
  updateChecking = true;

  // Every deploy of the site produces a new worker, whether or not the version
  // moved: a typo fixed in a comment counts. So the only thing worth saying
  // anything about is a version that actually changed, and if that cannot be
  // read, nothing is said — the update still installs on the next launch, and a
  // banner nobody can act on is worse than silence.
  const version = await incomingVersion();
  updateChecking = false;
  if (!version) return;

  // A fix-only release still installs — it just does it the next time the app
  // is opened, silently, the way it always did. The only thing being decided
  // here is whether to say anything now.
  const worth = updateWorth(VERSION, version);
  if (worth !== "feature" && worth !== "fixes") return;
  if (alreadyDismissed(version)) return;

  // Latched only now, on the path that actually shows something. Setting it
  // earlier means a quiet patch release swallows the feature release that
  // follows it, in a session left open for days.
  updateOffered = true;

  const ask = () =>
    notice(`Tiro ${version} is ready`, "ok", 0, {
      label: "Update",
      onClick: () => {
        standingOffer = null;
        reloading = true;
        worker.postMessage("SKIP_WAITING");
        // If the worker never answers, the reload still gets us the new shell.
        setTimeout(() => location.reload(), 1500);
      },
      onDismiss: () => rememberDismissed(version),
    });

  // Never interrupt a take. The transcript is not on the clipboard yet, and a
  // reload button under a thumb that is mid-press is the worst possible offer.
  if (state === "idle") ask();
  else offerWhenIdle(ask);
}

// The Windows app cannot update itself in place: it is a portable EXE someone
// unzipped. So the host reads GitHub's latest release, and the same banner
// appears here with the number it found, rather than that news living only in a
// tray menu nobody opens until they already suspect something.
bridge.onUpdate = ({ version, url }) => {
  if (!version || updateOffered) return;
  // Same rule as the web: a fix-only release is in the tray menu and the tray
  // tooltip, and that is where it stays. The host applies the same test before
  // sending this at all; this is the second half of one policy, not a new one.
  const worth = updateWorth(VERSION, version);
  if (worth === "quiet" || worth === null) return;
  if (alreadyDismissed(version)) return;
  updateOffered = true;   // set here, where something is actually shown
  const ask = () =>
    notice(`Tiro ${version} is available`, "ok", 0, {
      label: "Download",
      onClick: () => {
        standingOffer = null;
        bridge.openExternal(url || "https://github.com/Gabriel-Dalton/tiro/releases/latest");
        $("toast").dataset.open = "false";
        rememberDismissed(version); // taken: do not offer this one again
      },
      onDismiss: () => rememberDismissed(version),
    });
  if (state === "idle") ask();
  else offerWhenIdle(ask);
};

/** Wait for the take to finish before interrupting, but not indefinitely: if
 * the app never returns to idle, something else is wrong and a timer polling
 * for the life of the page helps nobody. Ten minutes of takes is far past any
 * real dictation. */
function offerWhenIdle(ask, attemptsLeft = 500) {
  if (state === "idle") ask();
  else if (attemptsLeft > 0) setTimeout(() => offerWhenIdle(ask, attemptsLeft - 1), 1200);
}

boot();
