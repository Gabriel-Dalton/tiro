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
extra step versus Flow, and it costs $0.0077/min instead of $15/month.

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
| 6 | Candidates from competitive feedback | 2, 4 | Dictionary, replacements, Canadian pass, languages — **none started** |

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

Phases 0 to 4 are green. This phase was never a single deliverable, so it is tracked item by
item rather than as one "done when".

- **Packaging — done.** Authenticode signing via SignPath ([docs/SIGNING.md](docs/SIGNING.md)),
  and a winget manifest generated and attached to every release
  ([docs/PACKAGING.md](docs/PACKAGING.md)). No installer: winget takes the portable ZIP
  directly, and Tiro registers no services, no file associations, and writes its autostart key
  when you tick the box rather than at install time. An MSI would add a second artifact to sign
  and buy nothing. Listing in the winget catalogue still depends on Microsoft's review.
- **History portability — as far as it goes without a server.** JSONL export and import work in
  both directions and share upstream's format, so a Mac `history.jsonl`, a Windows export and a
  PWA export are the same file and move between devices by any means you like. Live sync stays
  unresolved on purpose: every option needs a server, which breaks the "no server of ours"
  promise, and that promise is worth more than the convenience.
- **Native iOS keyboard extension — still deferred, and now the only open item.** The only path
  to true in-any-app dictation on iPhone. Requires a Swift app with a `UIInputViewController`,
  an Apple Developer account, a Mac with Xcode to build and sign, and App Store review. None of
  that can be produced from this repo's CI, which is Linux, Windows and a hosted Mac runner
  without signing identities. Build the PWA, live with the extra paste step, and only pay this
  cost if it actually proves annoying.

- **Telling people there is a new version — done on the web and Windows, deferred on the Mac.**
  Three apps that nothing installs are three apps that nothing updates: before this, the only
  way to learn that a release had fixed the bug you were living with was to go and look. The
  answer is different on each platform, because what they can do differs:

  - **Web and installed PWA — done.** The service worker already re-fetched the app in the
    background; the fault was that it *activated* the moment it finished, swapping the shell
    under a page that might be mid-take, and never said a word. Now the new version installs
    and waits, a toast offers a **Reload**, and nothing changes until that is taken. The offer
    holds until you are idle, and does not time out. No new network surface whatsoever: the
    browser re-fetches Tiro's own files from the origin already serving it.
  - **Windows — done.** A weekly, anonymous read of the latest release tag from GitHub's API,
    surfaced in the tray menu and switchable off there. Specified in full in
    [docs/SPEC-WINDOWS.md](docs/SPEC-WINDOWS.md) §4.3, including exactly what it does and does
    not send, and why the version comparison is numeric.
  - **macOS — deliberately not done.** That app is upstream's, and the working agreement below
    says not to modify it; a self-updater is not a minimal change. Adding one would also mean
    either Sparkle (a dependency, and an update *feed* to host) or a hand-rolled check inside
    code this fork wants to keep mergeable. The Mac app names its version in its About box, the
    releases page names the latest, and this is a fork whose Mac users are developers. If that
    stops being true, the cheapest honest option is a menu item that opens the releases page —
    no feed, no self-update, no daemon.

  **This is not telemetry, and the distinction is worth stating** since "no telemetry" is a
  non-goal below. Telemetry is the app telling someone about you. An update check is the app
  asking a public URL a question and being told the answer; nothing identifies the person
  asking, there is no server of ours to receive anything, and it can be switched off. If the
  choice were ever between an update check that identified users and no update check, this
  project takes no update check.

Two smaller things landed alongside, both closing gaps in earlier phases rather than adding
scope:

- The mic now follows a device being **plugged in**, not only unplugged. Phase 4's criterion
  covered the headset leaving; the headset arriving left you recording from the laptop mic.
- CI regenerates the design tokens and icon set and fails on drift. Phase 0's "done when" was
  true when written and had nothing keeping it true — and the Windows EXE ships the *committed*
  `web/` verbatim, so drift would have reached desktop users while the site regenerated on
  deploy and looked fine.

### Phase 6 — Candidates from competitive feedback

**Nothing here is committed.** These come from surveying what Wispr Flow users praise, complain
about and ask for, written up with sources and confidence grades in
[docs/COMPETITIVE.md](docs/COMPETITIVE.md). Read that before building any of them; several
obvious-looking versions of these ideas are worse than the version specified here, and one of
them rests on a premise that turned out to be half wrong.

The ordering is (value to someone leaving Wispr Flow) ÷ (cost given the architecture we have).
Items 6.1 to 6.4 are each roughly a day; they are first because they are cheap, not because they
matter most. Anything landing here must hold the existing non-goals: no accounts, no telemetry,
no server, no LLM pass over your words.

#### 6.1 — Custom dictionary, via Deepgram keyterms

The most praised thing about Wispr Flow that Tiro cannot do at all. You teach it names, jargon,
acronyms and product names, and it stops mangling them.

Deepgram's nova-3 supports `keyterm` prompting on the streaming socket, up to 100 terms, though
Deepgram advises staying in the 20–50 range because force-fitting gets worse as the list grows —
so cap the UI well below the API limit and say why. Implementation is a settings list persisted
alongside the others, appended to the query string in `web/src/deepgram.js`, which is currently a
hardcoded constant and needs to become a builder. Terms belong in the JSONL export so they move
between devices the same way history does.

Leave the macOS app alone here. It is upstream's, `keyterm` works on the prerecorded endpoint
too, and the working agreement about not refactoring `Sources/` outranks parity.

**Done when:** a term you add is recognised on the next take, and a fresh install that imports
your export gets your dictionary with it.

#### 6.2 — Text replacements, applied locally

Their snippets feature, and the mechanism 6.3 is built on. A list of find/replace rules applied
to the final transcript before it reaches the clipboard: whole-word matched, case-preserving,
run in the client. No API, no cost, no latency, works offline, and every rule is visible and
editable rather than living in a model.

**Done when:** a rule you write changes the pasted text on the next take, on all three clients,
with the untransformed transcript still what gets stored in history.

#### 6.3 — Canadian English pass

The unique-selling-point idea, in the form that survives contact with the research.

Read [docs/COMPETITIVE.md §4](docs/COMPETITIVE.md) first, because the framing matters: **Wispr
Flow already ships English – Canadian on Mac and Windows**, so "we do Canadian and they don't" is
not a claim we can make. What holds up is narrower and better:

- **It is off by default.** Dictating "colour" into Wispr Flow in Canada returns the American
  spelling — confirmed first-hand. Their onboarding auto-selects English – British for the UK,
  Australia, New Zealand, Ireland and South Africa, and Canada is not on that list, so Canadians
  are silently defaulted to American and have to already know the setting exists. A feature that
  never switches itself on is, for almost everyone, a feature that is not there. **This is the
  opening, and it is a default rather than a capability.**
- Canadian orthography is neither American nor British — British `-our` and `-re` (colour,
  centre, defence, cheque, kilometre) with American `-ize` (organize, recognize), while keeping
  `tire` and `aluminum`. A dialect flag set to `en-GB` gets about half of it wrong, in the
  direction most visible to a Canadian reader.
- It is as much format as spelling: postal codes (`K1A 0B1`), provinces and territories, GST/HST/
  QST, SIN, and French place names inside English sentences (Montréal, Trois-Rivières).
- Wispr Flow reportedly does *not* offer Canadian on iOS or Android at all, and mobile is exactly
  where Tiro's PWA lives.

So build it as a **shipped ruleset on top of 6.2**, not as a language parameter: deterministic,
local, zero-cost, offline-safe, identical on all three clients, and reviewable as a diff. That is
also the thing a cloud LLM competitor is structurally worst at promising, because they cannot
tell you in advance what their model will do to your sentence.

Do not ask Deepgram for `en-CA` and assume it does this. Regional English variants existed on
older models; whether nova-3 accepts `en-CA`, and what orthography it emits if it does, is
**unverified** — spike it before writing any code that depends on it.

Keep any privacy framing honest. A smaller disclosure surface than an app that uploads periodic
screenshots is a true and useful thing to say to someone with PIPEDA or Quebec Law 25 on their
mind. It is not a compliance claim, and Deepgram is still a US processor.

Then **default it on when the device says Canada** — `navigator.language` of `en-CA`, or a
Canadian timezone — and show which pass is active rather than burying it. Getting the default
right is most of the value here; a Canadian who has to go looking for the setting is in exactly
the position Wispr Flow already leaves them in. Keep it a toggle, because plenty of Canadians
write to American house styles for work.

**Done when:** a browser set to `en-CA` produces Canadian spelling and a correctly formatted
postal code on a first take with no visit to Settings, and the whole ruleset is visible and
switchable once you get there.

#### 6.4 — Language selection, including bilingual

Multilingual support without switching modes is what makes Wispr Flow users loyal, and Tiro
cannot even be configured for it: `web/src/deepgram.js` sends no `language` parameter, so we are
silently English-only.

Add a language setting, and include nova-3 multilingual, which does English↔French
code-switching within a single stream. That is the honest answer to the bilingual Canadian case
in 6.3 — Montréal, Ottawa, Moncton — and Wispr Flow's variants are mutually exclusive, so
switching costs their users a settings trip.

**Done when:** a take that switches language mid-sentence transcribes both halves, and the choice
persists across restarts on all three clients.

#### 6.5 — Fix the last take without re-dictating

Their deepest trust complaint is that the AI rewrites what you said. Tiro already answers it
structurally — we run no LLM over your transcript, so what Deepgram heard is what you get — and
that position is worth keeping rather than trading away for polish.

The gap it leaves is that a bad take can only be fixed by saying the whole thing again. An
edit-and-re-paste affordance on the most recent transcript closes that from the honest direction:
you fix it, not a model.

**Done when:** you can amend the last take and paste the amended text without dictating again.

#### 6.6 — Transcribe an existing recording

Something Wispr Flow cannot do at all, and the Mac CLI already does (`--selftest file.m4a`).

The web core looks blocked here, because Deepgram's REST API is CORS-blocked
([docs/RESEARCH.md](docs/RESEARCH.md) #1) — but it is not. Decode the file with WebAudio,
resample to the same 16 kHz mono Int16 the microphone path already produces, and push it through
the existing socket. No new transport, no new auth, no new cost model.

**Done when:** dropping an audio file on the app produces a transcript in history, over the same
one socket a live take uses.

#### Explicitly not in this phase

- **An LLM polish pass** — tone adaptation, command mode, rewriting. It is the direct source of
  Wispr Flow's worst complaint, it needs a second paid API, and it contradicts the non-goals
  below.
- **Offline transcription.** The most-requested thing Wispr Flow lacks, and still a non-goal
  here: Deepgram is the fork's whole value proposition. The right response is to fail gracefully
  without a network, not to ship a local model.

#### Things to say rather than build — done

Several of the strongest differentiators needed no engineering at all: no account, no screen
capture, no LLM rewriting your words, MIT source, a free tier measured in hundreds of hours
rather than thirteen minutes a week, and Linux and iPad both already covered by the PWA. All were
true and none were said anywhere. They are now a side-by-side table on the landing page, in the
`value` section under the cost comparison.

Two rules govern that table, and anything added to it later has to hold them:

- **Every competitor cell is something the competitor publishes about itself.** No third-party
  benchmarks, no accuracy or latency figures, no RAM numbers — those all trace back to vendors
  selling a rival, and one falsifiable row discredits the whole chart. `docs/COMPETITIVE.md §6`
  lists the specific claims to stay away from and why.
- **The rows we lose stay in.** Dictating straight into another iPhone app, and working offline.
  A chart that wins every row is read as an advertisement.

**Which Phase 6 items earn a new row.** 6.3 adds "Canadian spelling — on by default in Canada",
against their setting that exists but does not select itself. 6.6 adds transcribing a recording
you already have, which they cannot do at all. 6.1 and 6.2 do not add rows — they *remove* two we
would currently lose, which is why the chart has no dictionary row today.

## Non-goals

Stating these so they do not creep in:

- **No Electron.** Upstream advertises its absence and it is a real feature. WebView2 uses the
  Edge runtime already present in Windows 11 and does not bundle a browser, so it does not
  break this.
- **No accounts, no telemetry, no analytics.** Same as upstream. The Windows update check is
  the one outbound request that is not dictation, and it stays inside this line because it
  carries no identifier, reports to nobody, and can be turned off — see Phase 5.
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
