# Architecture

How the three clients relate, what they share, and the decisions behind it.

Read [RESEARCH.md](RESEARCH.md) first. Most of what follows is a consequence of a constraint
documented there.

## Shape

```
                    ┌──────────────────────────────┐
                    │  Deepgram streaming WebSocket │
                    │  wss://api.deepgram.com/v1/   │
                    └───────────────▲──────────────┘
                                    │ linear16 16k mono
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
     ┌────────┴────────┐   ┌────────┴────────┐   ┌────────┴────────┐
     │  macOS (Swift)  │   │   PWA (web)     │   │ Windows (C# +   │
     │   upstream,     │   │  iPhone, and    │   │ WebView2 hosting│
     │   unchanged     │   │  any browser    │   │ the same web    │
     │                 │   │                 │   │ core)           │
     │ AVAudioEngine   │   │ AudioWorklet    │   │ AudioWorklet    │
     │ CGEvent ⌘V      │   │ clipboard only  │   │ SendInput ^V    │
     │ global monitor  │   │ in-page button  │   │ WH_KEYBOARD_LL  │
     └─────────────────┘   └─────────────────┘   └─────────────────┘
```

The PWA and the Windows app are **the same web core**. Windows adds a native shell for the two
things a browser cannot do: observe a global hotkey, and paste into another application. That is
the whole reason Windows is Phase 4 and not Phase 1. Build the core once on the platform that
forces the most discipline, then wrap it.

macOS stays upstream's code. We do not touch it, so we can keep pulling their fixes.

## Repo layout

```
tiro/
├─ Sources/tiro/            upstream macOS app. Do not refactor.
├─ Package.swift
├─ make-app.sh
├─ shared/
│  └─ design-tokens.json    Forum palette, single source for web + Windows
├─ web/                     the PWA. Phases 1 to 3.
│  ├─ index.html
│  ├─ manifest.webmanifest
│  ├─ sw.js
│  ├─ icons/                generated, not hand-drawn
│  ├─ styles/
│  │  ├─ tokens.css         generated from shared/design-tokens.json
│  │  └─ app.css
│  ├─ worklets/
│  │  └─ pcm-processor.js   runs on the audio thread, keep it dumb
│  └─ src/
│     ├─ app.js             state machine + wiring
│     ├─ audio.js           mic, pre-roll ring buffer, resampling
│     ├─ deepgram.js        streaming client
│     ├─ history.js         IndexedDB store + JSONL export
│     ├─ usage.js           minutes, cost, savings maths
│     └─ settings.js        key storage, preferences
├─ windows/                 Phase 4.
│  ├─ Tiro.Windows/         WinUI 3 host: tray, hook, SendInput, WebView2
│  └─ Tiro.Windows.Tests/
├─ scripts/
│  ├─ gen-tokens.mjs        design-tokens.json -> tokens.css
│  └─ gen-icons.mjs         Tironian path -> SVG + PNG set
└─ docs/
```

## The four ideas worth preserving from upstream

Upstream is only ~2,300 lines but four of its decisions are the difference between a demo and
something you use daily. Port the ideas, not the Swift.

### 1. The mic is always warm, with a pre-roll buffer

`AVAudioRecorder` took about half a second to spin up, which clipped the start of every
sentence. Upstream instead runs the audio engine continuously and keeps a rolling ~0.7 s buffer.
Pressing the hotkey **adopts that buffer**, so words spoken slightly before the press are still
captured. There is also a 0.5 s tail after release.

This is the single most important behaviour to get right. A dictation tool that eats your first
word is not usable, and the failure is subtle enough that it survives casual testing.

In a streaming world it works slightly differently and slightly better:

1. Mic warm, ring buffer filling, **no socket open**, nothing sent, nothing billed.
2. Hotkey pressed. Open the WebSocket. Keep buffering locally while it connects.
3. Socket opens. Flush the entire buffered region, pre-roll included, then stream live.
4. Release. Keep streaming for the 0.5 s tail, send `CloseStream`, wait for the final result.

Because audio is buffered locally until the socket is ready, connection latency cannot clip
speech either. The pre-roll buffer absorbs both problems with one mechanism.

### 2. A hold/tap state machine, not a toggle

Four states: `idle`, `holdRecording`, `toggleRecording`, `transcribing`.

Held longer than **0.35 s** then released means "insert now". Released faster than that means the
user tapped, so stay recording hands-free until they tap again. One control, two modes, no
setting to explain. Keep the threshold in a named constant shared across platforms.

### 3. History is a plain JSONL file

Upstream appends one JSON object per line to
`~/Library/Application Support/Tiro/history.jsonl`. No database, trivially greppable, and it
survives the app being deleted.

Keep the schema identical everywhere so a Mac history file, a PWA export and a Windows history
are the same artefact:

```json
{"ts":"2026-08-15T09:14:22Z","text":"the transcript","sec":4.3}
```

- `ts` — ISO 8601 UTC
- `text` — the transcript as inserted, after smart formatting
- `sec` — audio duration in seconds, one decimal place. This is what usage and cost are computed
  from, so it must be the billed duration, not wall-clock time including think-pauses.

The PWA stores this in IndexedDB because the filesystem is not available, but exports and
imports the same JSONL. Windows writes the file directly, at `%APPDATA%\Tiro\history.jsonl`.

### 4. Cost is visible in the product

Upstream shows minutes, spend this month, and the comparison against subscription pricing. It is
the argument for the whole project, so it belongs in the UI rather than the README.

Keep the rate in exactly one constant. Deepgram's published price has already changed once since
upstream shipped (see [RESEARCH.md](RESEARCH.md) finding 2), and a stale hardcoded number turns
an honest feature into a wrong one.

The PWA cannot show a live account balance, because the balances endpoint is REST and therefore
CORS-blocked. Show the local estimate, label it as local, and link to the Deepgram console.

## Key decisions

### Streaming transport on every platform, not just the web

The PWA is forced onto streaming by CORS. We could keep macOS and Windows on the batch endpoint,
but running one transport everywhere means one Deepgram client to reason about, one set of
formatting behaviour, and one price. Streaming is also cheaper and returns the final transcript
almost as soon as the key is released, since most of the work happened while the user was still
talking.

The cost is a persistent socket and reconnection handling, which batch does not need. Worth it.

macOS is the exception and stays on batch, because we are not modifying upstream's app.

### The key lives on the device, and never on a server

This is the user's explicit choice and it constrains everything else. It is what forces
subprotocol auth rather than minted JWTs, and it is why there is no proxy in the diagram.

The honest limitation: on the PWA the key sits in browser storage on the phone. That is fine for
your own key on your own device. It is **not** fine if this app is ever handed to other people
or run on a shared device, and if that ever happens this decision has to be reopened rather than
worked around.

### Windows hosts the web core rather than reimplementing it

The alternative is a pure WPF or WinUI app with WASAPI audio and a native HTTP client. That
would be leaner and would let the mic pipeline use the OS directly.

Reusing the web core wins anyway, because the expensive parts of this product are the pre-roll
timing, the state machine, the history UI and the usage maths, and none of those are
platform-specific. Reimplementing them in C# means maintaining two of everything and watching
them drift.

WebView2 is not Electron and does not break upstream's claim: it uses the Edge runtime already
present on Windows 11 rather than bundling a browser.

Fallback if this is wrong, for example if audio latency through WebView2 is unacceptable: keep
the WebView for UI only and move capture into C# with NAudio/WASAPI, feeding PCM to the web layer
over the host bridge. That is a contained change, which is part of why this approach is safe to
try first.

### The PWA is a scratchpad, and the README should say so

It cannot type into other apps on iOS and no amount of engineering changes that. Better to
describe it accurately than to invite the comparison it will lose. The clipboard hand-off is one
extra tap, and the value on offer is the price.

## State machine

Shared by all clients. Worth implementing as an explicit machine rather than a set of booleans,
because the error transitions are where dictation apps get annoying.

```
        ┌──────────────────── transcript inserted / failed ──────────────┐
        │                                                               │
        ▼                                                               │
     ┌──────┐  hotkey down   ┌───────────────┐  released > 0.35s   ┌─────┴──────┐
     │ idle │───────────────▶│ holdRecording │────────────────────▶│transcribing│
     └──────┘                └───────┬───────┘                     └─────▲──────┘
        ▲                            │                                   │
        │                   released < 0.35s                             │
        │                            ▼                                   │
        │                   ┌─────────────────┐    hotkey tapped again   │
        │                   │ toggleRecording │──────────────────────────┘
        │                   └─────────────────┘
        │                            │
        └──── mic failure / no key / socket refused ─────────────────────┘
```

Failure paths that must be handled explicitly, because each one has bitten upstream or is
predictable from the platform:

- No API key. Do not start recording; open settings.
- Mic unavailable or permission denied.
- Audio device changed mid-session. Upstream rebuilds its tap on
  `AVAudioEngineConfigurationChange` after a crash caused by exactly this. The web equivalent is
  the track ending or the context being interrupted; handle it or the app dies when headphones
  come out.
- Socket refused, usually a bad or exhausted key. Distinguish auth failure from network failure,
  because the fixes are different.
- Empty transcript, meaning silence or a muted mic. Say "heard nothing" rather than appearing to
  succeed.
- Clipboard write refused. Reveal a manual copy control rather than losing the transcript.

## What to build first

Order within Phase 1, because dependencies are real here:

1. `pcm-processor.js` and `audio.js`. Verify by recording five seconds and playing back the
   reconstructed WAV. If the audio is wrong, everything downstream is unfixable.
2. `deepgram.js` against a pre-recorded file replayed as if it were live. Verify the transcript
   is correct before any UI exists.
3. The state machine and the button. Verify hold and tap both work with a stubbed transcriber.
4. Wire them together. Verify the pre-roll actually works by starting to speak before pressing.
5. Clipboard, with all three fallbacks.

Do not build the UI first. The audio pipeline is where the risk is.
