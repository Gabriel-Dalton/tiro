# Tiro fork roadmap

This fork extends [mypip-io/tiro](https://github.com/mypip-io/tiro) (MIT, by Toby Stapleton)
from a macOS-only app to three platforms that share one core: **iPhone/web first, then
Windows**, with the original macOS app left untouched so it can keep tracking upstream.

Upstream solved the hard part: hold a key, speak, and the words land in your cursor. What it
does not have is any story for the phone, and no Windows build. That is what this fork is for.

## The one constraint that shapes everything

**A PWA cannot type into other apps on iOS.** There is no global hotkey, no background mic,
and no way to insert text into another app's text field from a web page. That is a platform
rule, not a gap in our implementation. Wispr Flow gets around it by shipping a native app with
a custom keyboard extension running with "Allow Full Access", which is the only sanctioned
path (see [docs/RESEARCH.md](docs/RESEARCH.md)).

So the PWA is deliberately scoped as a **fast dictation scratchpad**: open, hold, speak,
transcript is on your clipboard before you lift your thumb. You paste it yourself. That is one
extra step versus Flow, and it costs about $0.005/min instead of $15/month.

Windows has no equivalent limit. Everything the Mac app does ports cleanly there.

## Phases

Phases are ordered by dependency, not by importance. Each has its own acceptance criteria in
the linked spec. Do not start a phase before the one it depends on is green.

| # | Phase | Depends on | Output |
|---|---|---|---|
| 0 | Foundations | — | Shared design tokens, icon set, history schema, repo skeleton |
| 1 | PWA core | 0 | Hold-to-talk works end to end on a phone over HTTPS |
| 2 | PWA product | 1 | History, usage, settings, offline shell, install flow |
| 3 | Deploy | 1 | Live HTTPS URL, installable on the home screen |
| 4 | Windows app | 1 | Tray app, global hotkey, auto-paste into any app |
| 5 | Parity and extras | 2, 4 | Shared history format, packaging, optional native iOS keyboard |

### Phase 0 — Foundations

Groundwork that both the PWA and the Windows app consume. Small, but doing it first stops the
two clients drifting into two different-looking products.

- Extract the "Forum" palette from `Sources/tiro/design.swift` into `shared/design-tokens.json`
  and generate `web/styles/tokens.css` from it. The Swift file stays the source of truth for
  the Mac app; the JSON is the source of truth for everything new.
- Generate the icon set from the Tironian et path already defined in `design.swift`
  (`tironianPaths`). One vector definition, all sizes derived from it.
- Write down the history record schema once (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)),
  matching upstream's JSONL so a Mac history file and a PWA export are the same format.

**Done when:** a single palette change propagates to the PWA CSS by running one script, and the
icon set regenerates from the path definition with no hand-drawn assets checked in.

### Phase 1 — PWA core

The smallest thing that is genuinely useful on the phone. Nothing cosmetic in this phase.

- Mic capture through an `AudioWorklet` producing 16 kHz mono Int16 PCM.
- Rolling pre-roll ring buffer so speech is never clipped, matching upstream's behaviour.
- Deepgram **streaming** WebSocket client with subprotocol auth.
- Hold-to-talk and tap-to-toggle on one button, using upstream's 0.35 s threshold.
- Transcript to clipboard using the promise-based `ClipboardItem` trick so the write survives
  the async round trip on Safari.
- API key entry, stored on the device only.

**Done when:** on a real iPhone, over HTTPS, you can hold the button, speak a sentence, release,
and paste the correctly punctuated result into Messages. Spec: [docs/SPEC-PWA.md](docs/SPEC-PWA.md).

### Phase 2 — PWA product

Everything that makes it an app rather than a demo.

- History in IndexedDB: searchable, grouped by day, one-tap copy, JSONL export.
- Usage and savings view. Note that live Deepgram credit balance is **not** available to a
  browser (the balances endpoint is REST, and REST is CORS-blocked), so this is computed from
  local history. Say so in the UI rather than showing a number that looks live and is not.
- Settings: key management, hotkey choice for desktop browsers, mic warm-up toggle, clear data.
- Service worker for an offline app shell. History must be readable with no network.
- iOS install affordances: `apple-touch-icon`, standalone display, safe-area insets, and an
  "Add to Home Screen" hint, since iOS gives no install prompt.

**Done when:** installed to the home screen it looks and behaves like a native app, opens
offline, and shows your real cost this month.

### Phase 3 — Deploy

The PWA is untestable on a phone until it is on HTTPS. `getUserMedia`, service workers, and
home-screen install all require a secure origin, and `localhost` does not help you on iOS.

- Static hosting on Vercel from `web/`.
- Confirm correct headers: no caching of `sw.js`, correct MIME for `.webmanifest`.
- Note: this account requires commits to be authored by the personal Git identity or Vercel
  marks the deploy blocked. Do not set a repo-local `user.email`.

**Done when:** a URL exists that installs to an iPhone home screen and dictates.

### Phase 4 — Windows app

Recommended approach is a **WebView2 shell around the same web core**, with a thin native layer
for the two things a browser cannot do. This reuses the PWA's UI, Deepgram client, history and
settings verbatim, and keeps the two products from diverging.

The native layer is only:

- A low-level keyboard hook for the global hotkey.
- `SendInput` to paste into the focused app.
- Tray icon, autostart, single-instance guard.

Note that **Fn is invisible to Windows**: it is handled in keyboard firmware and never reaches
the OS, so upstream's default hotkey cannot be ported. Default to Right Alt and make it
configurable. Avoid defaulting to Right Ctrl, which collides with the crash-dump keystroke on
this machine.

Windows needs no equivalent of the macOS Accessibility permission for `SendInput`, so the whole
permission-gate branch in upstream's paste path disappears. The one exception is pasting into an
elevated window, which needs the app to be elevated too.

Spec, including the pure-native fallback if WebView2 disappoints:
[docs/SPEC-WINDOWS.md](docs/SPEC-WINDOWS.md).

**Done when:** holding Right Alt anywhere in Windows dictates into the focused text box, and the
app survives a mic device change (unplugging headphones) without needing a restart.

### Phase 5 — Parity and extras

Not committed work. Revisit once phases 1 to 4 have been used in anger for a fortnight.

- Packaging: signed installer or winget manifest for the Windows app.
- History portability between devices. Deliberately unresolved, because every option so far
  requires a server, which breaks the project's "no server of ours" promise.
- **Native iOS keyboard extension.** The only path to true in-any-app dictation on iPhone.
  Requires a Swift app with a `UIInputViewController`, an Apple Developer account, a Mac with
  Xcode to build and sign, and App Store review. Deferred on purpose: build the PWA, live with
  the extra paste step, and only pay this cost if it actually proves annoying.

## Non-goals

Stating these so they do not creep in:

- **No Electron.** Upstream advertises its absence and it is a real feature. WebView2 uses the
  Edge runtime already present in Windows 11 and does not bundle a browser, so it does not
  break this.
- **No accounts, no telemetry, no analytics.** Same as upstream.
- **No server holding your API key.** The key stays on the device that uses it. This is what
  forces the streaming WebSocket transport, and that decision is load-bearing.
- **No local/on-device speech model.** Deepgram is the whole value proposition of the fork.
- **No rewrite of the macOS app.** It stays as upstream wrote it so this fork can pull fixes.

## Working agreements for whoever builds this

- Verify against [docs/RESEARCH.md](docs/RESEARCH.md) before assuming a platform capability.
  Several obvious-looking approaches are dead ends there, with sources.
- The Mac app under `Sources/` is upstream's. Do not refactor it. If it needs a change, make it
  minimal and note it, so merges from upstream stay clean.
- Ship each phase to a branch, get it reviewed, then merge. Do not stack phases in one branch.
