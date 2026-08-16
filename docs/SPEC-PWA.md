# Build spec: the PWA

Phases 1 to 3. Target device is an iPhone in Safari, installed to the home screen. Desktop
browsers must work too, since the Windows app reuses this code, but the iPhone is what the
design decisions serve.

Read [RESEARCH.md](RESEARCH.md) before starting. Several natural approaches are dead ends there.

## What it is

Open Tiro, hold the button, speak, release. The transcript is on your clipboard by the time you
switch apps. Paste it wherever you were going.

It is **not** a keyboard and cannot type into other apps. Do not build UI that implies otherwise.

## Stack

Vanilla JavaScript, ES modules, no framework and no build step. Upstream's whole pitch is a small
dependency-free app and the PWA should be able to make the same claim. A build step also makes
the "just open `index.html` over HTTPS" story worse for no gain at this size.

Exception: allow small dev-only scripts under `scripts/` (token and icon generation). Those run
at authoring time and ship nothing.

---

## Phase 1: core

### 1.1 Audio capture

`web/worklets/pcm-processor.js` and `web/src/audio.js`.

Requirements:

- `getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`.
- `AudioWorkletNode` feeding an `AudioContext`. Provide a `ScriptProcessorNode` fallback only if
  testing shows a target browser needs it; do not write it speculatively.
- Resample from the context rate (assume nothing, typically 48 kHz) to **16 kHz mono Int16**.
  Write a general ratio resampler with linear interpolation. Do not hardcode 3:1 decimation.
- Keep the worklet dumb: it should convert and post frames, nothing else. Ring buffer management
  and state live on the main thread.
- Rolling pre-roll ring buffer of **0.7 s** (11,200 samples at 16 kHz) while idle. Constant, not
  a magic number inline.
- `beginRecording()` adopts the current ring contents as the head of the take, then continues
  appending live. `endRecording()` returns the take and resets.
- Expose an RMS level, 0 to 1, for the waveform indicator.
- Handle the audio context being suspended on `visibilitychange` and resumed on return. On iOS
  the context must be created or resumed inside a user gesture.
- Handle the input track ending, which is what happens when headphones are unplugged. Rebuild
  rather than dying. Upstream had a crash here on macOS, so treat it as a known failure mode
  rather than an edge case.

**Acceptance:** a debug control records 5 s, reconstructs a WAV from the captured Int16, and
plays it back cleanly at correct pitch and speed. Wrong pitch means the resampler is wrong and
nothing downstream will work.

### 1.2 Deepgram streaming client

`web/src/deepgram.js`.

```
wss://api.deepgram.com/v1/listen
  ?model=nova-3
  &smart_format=true
  &punctuate=true
  &interim_results=true
  &encoding=linear16
  &sample_rate=16000
  &channels=1
```

Auth is the subprotocol array, because browsers cannot set headers on a WebSocket:

```js
new WebSocket(url, ["token", apiKey])
```

Requirements:

- Connect on record start, not on app start. Nothing is sent or billed while idle.
- Buffer audio locally until the socket is open, then flush everything including pre-roll. This
  is what stops connection latency clipping speech, and it is the reason connect-on-demand is
  acceptable.
- Emit interim results for live on-screen feedback, and accumulate finals for the real
  transcript. Do not build the final transcript out of interim results.
- Send `{"type":"KeepAlive"}` on a timer during toggle mode so a thinking pause does not drop the
  socket. Confirm the real timeout, listed as an open question in RESEARCH.md.
- On stop: send `{"type":"CloseStream"}`, wait for outstanding finals, then resolve. Do not close
  the socket immediately or you lose the tail of the sentence.
- Distinguish auth failure from network failure in the error surfaced to the UI. "Your key was
  rejected" and "you are offline" need different responses from the user.
- Time out rather than hanging forever if no final arrives.

**Acceptance:** replaying a known audio file through the client produces the expected transcript,
with punctuation and capitalisation, before any UI exists.

### 1.3 Interaction

`web/src/app.js`.

One large press-and-hold control. Pointer events, not touch or mouse events, so one code path
covers finger, mouse and pen.

- Hold longer than **0.35 s** then release: stop and insert.
- Release faster than 0.35 s: enter hands-free toggle mode, stay recording, tap again to stop.
  Same constant as upstream's `TAP_THRESHOLD`.
- The button needs `touch-action: manipulation`, `user-select: none` and
  `-webkit-touch-callout: none`, or iOS fires double-tap zoom and the text-selection callout
  during dictation.
- Show live interim transcript and a level meter while recording. The user needs to see that it
  is hearing them.
- Desktop only: an optional hold-to-talk key while the tab is focused. Default off. This is the
  same mechanism the Windows shell will drive, so keep it separable.

### 1.4 Clipboard hand-off

The critical path, and the thing most likely to fail silently. Three tiers, in order:

1. In the `pointerup` handler, synchronously:
   `navigator.clipboard.write([new ClipboardItem({ "text/plain": transcriptPromise })])`.
   This is what keeps the write inside the user gesture across the network round trip.
2. If that rejects, `navigator.clipboard.writeText(text)` once the transcript lands.
3. If that rejects too, reveal the transcript in a selectable field with a visible Copy button
   and select its contents.

Tier 3 is not optional. Also offer `navigator.share()` as a secondary action.

**Acceptance on a real iPhone, over HTTPS, installed to the home screen:** hold, speak a
sentence, release, switch to Messages, paste, and get correctly punctuated text. This is the
Phase 1 exit criterion and nothing else substitutes for it.

### 1.5 Key storage

- Password-style field, stored on the device only.
- "Save and test" validates by opening a WebSocket and observing whether it is accepted. The REST
  validation upstream uses is CORS-blocked.
- First-run setup explaining where to get a key, that new accounts include free credit, and that
  the key stays on this device.

---

## Phase 2: product

### 2.1 History

IndexedDB, schema exactly as in [ARCHITECTURE.md](ARCHITECTURE.md).

- Grouped by day, newest first, searchable.
- One-tap copy per entry.
- Export to JSONL matching the macOS file format, and import the same.
- Call `navigator.storage.persist()`. iOS may evict PWA storage under pressure, so make export
  easy to find rather than assuming durability.

### 2.2 Usage and savings

- Minutes and spend this month, from local history.
- Streaming rate in **one** constant, currently $0.0077/min — `deepgramStreamingPerMin` in
  `shared/design-tokens.json`. Comparison against Wispr Flow Pro at $15/month. Break-even is
  around 32 hours a month. (An earlier draft of this line said $0.0048 and 52 hours, from a
  transposed rate in [RESEARCH.md](RESEARCH.md) #2; both were wrong.)
- Daily bars for the last 31 days, and the comparison bars, matching upstream's Settings view.
- Label it a local estimate and link to the Deepgram console for the real balance. Do not present
  a computed figure as a live account balance.

### 2.3 Settings

Key management, desktop hotkey choice, mic warm-up toggle, clear history, export and import.

The mic warm-up toggle matters: keeping the mic open is what makes pre-roll work, and it also
keeps the recording indicator lit and costs battery. Let the user choose, and explain the
tradeoff in one line rather than burying it.

### 2.4 Shell and install

- `manifest.webmanifest`: standalone display, portrait, Forum palette theme and background
  colours, 192/512 and maskable icons.
- **The manifest colours are the light theme, and cannot be anything else.** A manifest has no
  way to branch on `prefers-color-scheme`, so `theme_color` and `background_color` name one
  pair. Once the document has loaded, the per-scheme `<meta name="theme-color" media="...">`
  tags in the head take over and the browser chrome follows the system, so the manifest pair
  only governs what shows before the app paints: the launch screen and the task switcher. A
  phone in dark mode therefore gets a light launch screen for as long as the shell takes to
  come up. The only real fix is `apple-touch-startup-image`, which does accept a media query
  but needs an exact-size asset per device, so it waits until there is a reason to generate
  that matrix. Tracked as PWA-13.
- `apple-touch-icon` in the head. iOS ignores manifest icons for the home screen.
- `viewport-fit=cover` plus `env(safe-area-inset-*)` padding, or the button sits under the home
  indicator.
- Service worker caching the app shell. History must open and be readable with no network.
  Never cache the Deepgram socket, and never cache `sw.js` itself.
- An "Add to Home Screen" hint for iOS, which gives no install prompt of its own. Show it only in
  Safari on iOS when not already standalone.

### 2.5 Design

Port the "Forum" direction from `Sources/tiro/design.swift`: warm paper, dark ink, one clay
accent at `#B23A2E`, serif display type. Palette lives in `shared/design-tokens.json` and
generates `tokens.css`.

**Type.** Three faces, three jobs, and no overlap:

| Face | Carries |
|---|---|
| serif (`--font-display`) | the wordmark, view and card titles, and **anything the user dictated** — the live transcript, the result, history entries |
| sans (`--font-sans`) | the entire interface: buttons, labels, hints, tab labels, small caps section headings |
| mono (`--font-mono`) | figures you read off or compare — the timer, timestamps, prices, the version string |

The original spec put small caps labels in the mono, and the result read like a terminal:
every tab, chip and section heading was 9–10 px monospaced uppercase. Small caps labels stay,
in the sans, at 11.5 px. The mono is now data-only, and `scripts/smoke-web.mjs` asserts it.

**Colour is semantic.** `design-tokens.json` carries a `semantic` block — `--bg`, `--surface`,
`--text-muted`, `--accent`, `--halo`, … — that maps the palette to jobs, in a light set and a
dark one. The stylesheet names only those, so **the app follows the system theme** and dark
mode is one generated `@media (prefers-color-scheme: dark)` block rather than a second
stylesheet. Never reach past the semantic layer to a raw palette token in `app.css`.

**Accessibility floor**, all enforced by the smoke suite:

- every text colour clears **4.5:1** against the surface it lands on, in both themes;
- every control is a **44 px** target and has a name that is text, never only an icon;
- the state of a thing is never carried by colour alone — the recording chip has a word, the
  current tab has `aria-current`, the daily chart has a written summary;
- everything you can do with a pointer you can do with a keyboard, including **hold-to-talk**
  (Space or Enter on the focused button);
- the install sheet is a real modal: focus goes in, Tab cannot leave, Escape closes, and focus
  returns to whatever opened it.

**Icons.** One set, drawn once as `<symbol>`s in `index.html` and referenced with `<use>`:
24-unit box, 1.8 round strokes. No text glyphs (`⌸ ◔ ✳`) — they render as a different face on
every platform and one of them was landing as a dot.

The Tironian et mark is defined as two strokes in a 48-unit box, already in `design.swift`:

```
bar:  M11 14 h26
curl: M30 14 c0 12 0 20 -11 23
```

Generate every icon size from that path. Do not check in hand-drawn assets.

House rules that apply here: no decorative coloured edge stripes, and colour carries one
documented meaning or is not used.

---

## Phase 3: deploy

Static hosting on Vercel from `web/`.

- `sw.js` must not be cached, or users get stuck on an old shell.
- Correct MIME type for `.webmanifest`.
- HTTPS is mandatory, not a nicety. Nothing works on the phone without it.
- Commits must be authored by the personal Git identity or Vercel blocks the deploy. Do not set
  a repo-local `user.email`.

---

## Definition of done

Phase 1 and 2 are complete when, on an iPhone with the app installed to the home screen:

- Speaking before pressing still captures the first word.
- A 30 second hands-free take transcribes without the socket dropping.
- The transcript is pasteable into another app without touching a Copy button.
- Unplugging headphones mid-session does not require restarting the app.
- Airplane mode gives a clear "you are offline" message, not a hang.
- A wrong API key gives "key rejected", not "you are offline".
- History opens and is searchable with no network.
- Cost this month matches a hand calculation from the history file.
