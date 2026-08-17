# Platform audit — August 2026

> **Partly overtaken by main.** This was written against `d07d9d0`. Merging main brought in
> fifteen commits that land on the same files, and four findings are already resolved there:
> **WIN-06** (DPI-aware region, `DeleteObject`, and the pill now follows the foreground
> window), **PWA-11** (the cache name is stamped by `scripts/gen-version.mjs`), the
> cross-cutting **no-tests** finding (`scripts/smoke-web.mjs` is a real Playwright suite),
> and half of **MAC-01** (`deepgramStreamingPerMin` moved to 0.0077 in the shared tokens,
> though `DEEPGRAM_PER_MIN` in `main.swift` is still 0.0043 and now disagrees with it).
> Those are marked inline. The rest were re-checked against the merged tree and stand, but
> this document has not had a full second pass and should get one.
>
> **Since then**, the interface rebuild in #20 has resolved **PWA-08** in full, and added
> **PWA-13**, which is new and cosmetic. The desktop-pill branch resolves **WIN-05** and adds
> **PWA-14**, which is new, pre-dates this audit, and was missed by it. **PWA-09** was re-checked against that rebuild and
> still stands: `app.js:348` still queues the fallback badge off the transcript promise
> rather than off the clipboard write, so the happy path still flashes "tap copy" first.

A read of every source file in the three clients: the macOS Swift app (`Sources/`), the
Windows WebView2 shell (`windows/`), and the PWA (`web/`), plus the shared build scripts
and CI. 26 findings from that pass, none of them cosmetic-only. PWA-13 was added afterwards
and is the one exception.

Findings carry a stable ID so they can be referenced in review. Every one names the file
and line it comes from. Where a finding depends on device behaviour I could not test from
here, it says so rather than asserting.

| | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| **PWA** (`web/`) | 2 | 2 | 4 | 5 | 13 |
| **Windows** (`windows/`) | 1 | 2 | 3 | 2 | 8 |
| **macOS** (`Sources/`) | — | 1 | 2 | 3 | 6 |
| **Total** | **3** | **5** | **9** | **10** | **27** |

The macOS app is in the best shape of the three, which matches expectations — it is
upstream's, and it has had real use. Its one serious finding is a stale pricing constant
that the fork's own README already contradicts.

The PWA carries the most risk, and the two critical items there both land on the exact
path that matters most: a first-time iPhone user installing to the home screen.

---

## PWA — `web/`

### PWA-01 · Critical · Installing to the Home Screen may start from empty storage

**`web/index.html:14`, `web/manifest.webmanifest`, `web/src/history.js`**

iOS has historically given a home-screen web app its own storage container, separate from
the Safari tab it was installed from. If that still holds, the flow we are shipping is:
the user opens the site in Safari, pastes their Deepgram key, dictates a few times, taps
**Add to Home Screen** — and the installed app opens with no key and no history, because
`localStorage` and IndexedDB are in a different jar.

Nothing in the code or the docs addresses this either way. `docs/RESEARCH.md:197` covers
storage *eviction* under pressure, which is a different problem, and `docs/SPEC-PWA.md:180`
covers showing the install hint. The install hint we show (`app.js:572-577`) actively
pushes people down this path.

This is the one finding I could not verify from here, and it is the one that most directly
threatens "use it on the iPhone with the history there". Test it on a real device before
anything else in this list — it is ten minutes of work and it determines whether the
storage design needs to change at all.

If it reproduces, the fix is not to move storage — it is to make the transition explicit:
detect first run in standalone mode with an empty store, and offer to import. The JSONL
export/import already exists (`history.js:77-106`) and is the right mechanism; it just is
not wired to this moment.

### PWA-02 · Critical · The first tap can leave the app stuck recording, and orphan a billed socket

> **Fixed — and fixed independently on main at the same time.** Both arrived at the same
> mechanism and the same names: a `starting` flag claiming the async gap, and `pressEnd`
> recording a release that lands inside it. Main's version is the one that survived the
> merge, including its call on where a deferred release should land: hands-free mode
> rather than ending the take, on the grounds that there is no audio yet and the user
> gesture is gone, so stopping would transcribe silence and be refused the clipboard.
> That is the better argument. What this branch adds on top is the take-identity guard in
> the `stream.start()` failure path (`const take = stream` / `if (stream !== take) return`),
> which main does not have: connecting can outlast the take, and without it the failure
> path reaches into a take `stopAndInsert` has already taken over. Covered by
> `scripts/smoke-web.mjs` — "tap-before-mic-ready lands in hands-free mode" and "only one
> socket was ever opened across the whole fumbled sequence".

**`web/src/app.js:99-156`, `web/src/app.js:249-265`**

`pressStart()` is `async` and the `pointerdown` listener does not await it:

```js
talk.addEventListener("pointerdown", (e) => {
  activePointer = e.pointerId;
  pressStart();            // not awaited
});
```

`pressStart` awaits `engine.start()`, which on first run blocks on the iOS microphone
permission prompt. If the user lifts their finger before that resolves — which is
guaranteed on first run, because the prompt is modal — `pointerup` fires while `state` is
still `"idle"`. `pressEnd()` checks for `holdRecording` or `toggleRecording` and does
nothing. Then `pressStart`'s continuation runs and sets `setState("holdRecording")`.

The app is now recording with no finger down and no way to stop it from the button. It is
also billing: the `DeepgramStream` opened at `app.js:123` stays open and streaming until
Deepgram's own idle timeout, kept alive by the `KeepAlive` ping at `deepgram.js:180-184`.

Pressing again does not cleanly recover. `pressStart` proceeds (the guards only catch
`transcribing` and `toggleRecording`), overwrites `stream` with a second `DeepgramStream`,
and calls `engine.beginRecording()` again — the first socket is now unreferenced and
un-abortable.

The fix is a pending flag: mark the press in-flight synchronously in `pointerdown`, and
have `pressEnd` either cancel a still-starting take or defer until `pressStart` settles.

### PWA-03 · High · Every connection failure is reported as "Deepgram rejected your key"

> **Fixed.** Both close handlers now decide on the close code rather than on
> `navigator.onLine`, which is trusted in one direction only: false means offline, true
> means nothing. Only 1008 and 4001 are called a rejection, because they are the only codes
> where Deepgram has actually looked at the key. Everything else, 1006 above all, reports
> that the app could not reach Deepgram, which is true in every remaining case including an
> auth failure hiding behind an abnormal close. "Save & test" says "No answer from Deepgram.
> Check your connection, then the key", since a test that got no answer has learned nothing
> about the key and must not send someone to replace a working one. `scripts/smoke-web.mjs`
> drives the setup card against a socket that closes 1006 and one that closes 1008, and
> checks that only the second mentions rejection.

**`web/src/deepgram.js:83-97`, `web/src/deepgram.js:216-219`**

When the socket closes before it ever opened, the code decides between two errors on the
basis of `navigator.onLine`:

```js
if (navigator.onLine) {
  reject(new DeepgramError("auth", "Deepgram rejected the key."));
} else {
  reject(new DeepgramError("offline", "You are offline."));
}
```

A close-before-open also happens on DNS failure, TLS interception, a corporate proxy that
blocks `wss://`, a captive portal, and any Deepgram 5xx. All of those report a good key as
rejected. `navigator.onLine` is specifically unreliable here — it is `true` on a captive
portal, which is the single most common place someone will first try this on a phone.

`testKey()` has the same logic, so "Save & test" will also tell the user their working key
is bad, and the setup card will not dismiss.

The user-visible cost is that people re-paste a correct key, get told it is wrong again,
and conclude the app is broken. Distinguishing these properly from a browser is genuinely
hard — the WebSocket close code is the only signal available, and `1006` covers most of
them. A better default is to not claim "rejected" unless the close code says `1008`/`4001`,
and otherwise say "Could not reach Deepgram — check your connection", which is true in
every case including the auth one.

### PWA-04 · High · iOS zooms the page whenever a text field is tapped

> **Fixed.** Text inputs and the hotkey `select` are pinned to 16px, after the `font`
> shorthand that would otherwise reset it. The viewport meta is untouched, so pinch-zoom
> still works. Verified by reading computed styles on an iPhone 13 viewport: four controls
> sat at 15px before, all four are at 16px now.

**`web/styles/app.css:82-90`, `web/styles/app.css:17`**

Inputs are `font: inherit`, and `body` is `font-size: 15px`. Mobile Safari auto-zooms the
viewport on focus for any input under 16px. That fires on the API key field in the setup
card, which is the first thing a new user touches, and again on the history search field.

The page does not zoom back out on blur, so the user is left in a zoomed viewport with the
tab bar pushed off-screen. Setting inputs to 16px on small viewports fixes it. Raising the
`maximum-scale` in the viewport meta also suppresses it but breaks pinch-zoom, which is an
accessibility regression — don't do that one.

### PWA-05 · Medium · Failed history writes are silent

**`web/src/app.js:211`**

```js
history.addEntry({ ts, text, sec }).catch(() => {});
```

If IndexedDB is unavailable or full — Safari Private Browsing, quota exhaustion, post-
eviction — the transcript is dropped and nothing says so. The user sees the transcript on
the result card, assumes it is saved, and finds an empty History tab later.

Given that eviction is a known, documented risk on the target platform, a swallowed write
error is the wrong default. Surface it through the existing `notice()` toast.

### PWA-06 · Medium · One transient IndexedDB failure disables history for the whole session

**`web/src/history.js:9-27`**

`dbPromise` is assigned once and cached. If the first `indexedDB.open` rejects, the
rejected promise is cached and every later call to `addEntry`, `allEntries` or `clearAll`
re-rejects immediately, with no retry, for the lifetime of the page. Clearing `dbPromise`
in the `onerror` handler makes the next call retry.

### PWA-07 · Medium · The app never tells you when iOS refuses persistent storage

**`web/src/app.js:570`, `web/src/history.js:41-46`**

`history.requestPersistence()` is called and its boolean result is discarded.
`docs/SPEC-PWA.md:151` is explicit that the answer may be no and that export should stay
prominent when it is — but the code has no path that reacts to a `false`.

At minimum, a `false` should raise the visibility of the export button, because on that
device history is genuinely at risk of being evicted without warning.

### PWA-08 · Medium · Nothing is announced to VoiceOver, and the talk button is pointer-only

> **Fixed** by the interface rebuild in #20. The status chip, the live transcript, the toast
> and the setup result all carry `role="status"` or `aria-live="polite"`, so a take now
> announces itself. The talk button takes Space and Enter, guarded against key repeat and
> against a take outliving the focus that started it: `keydown` returns early on `e.repeat`,
> and `blur` mid-hold ends the take rather than leaving it running. The current tab is marked
> with `aria-current="page"` rather than by colour alone. `scripts/smoke-web.mjs` holds all of
> it: it drives a full take from the keyboard, and fails if a control loses its accessible
> name.

**`web/index.html:54`, `web/index.html:188`, `web/src/app.js:249-266`**

There are no `aria-live` regions anywhere in the document. The toast (`#toast`), the live
interim transcript (`#live`), and the status text (`#head-status`) all update silently — a
VoiceOver user gets no feedback that recording started, that it failed, or what was heard.

Separately, `#talk` is a real `<button>` but only listens for `pointerdown`/`pointerup`.
Enter and Space on a focused button fire a `click`, which nothing handles, so the primary
control of the app cannot be operated by keyboard or by Switch Control.

`role="status"` on the toast and live region, and a `click` fallback that runs a fixed-
length take, close most of this.

### PWA-09 · Low · The "copied" badge flashes "tap copy" first on the happy path

**`web/src/app.js:217-242`**

`writeClipboardTiered` sets `wrote = true` inside the `navigator.clipboard.write()`
resolution, but the final `transcriptPromise.then(() => { if (!wrote) setBadge(false); })`
is queued off the transcript promise, which necessarily settles *before* the clipboard
write it feeds. So on a completely successful copy the badge reads "tap copy" for a frame
or two, then corrects to "copied".

Chaining the fallback badge off the clipboard promise instead of the transcript promise
fixes the ordering.

### PWA-10 · Low · Import runs one transaction per line and cannot report a partial failure

**`web/src/history.js:88-106`**

`importJsonl` awaits `addEntry` per line, so a 5,000-line export from the Mac is 5,000
separate IndexedDB transactions. It also returns only a count of successes — if a write
throws midway the whole function rejects, the UI reports nothing (`app.js:405-412` does not
catch), and the store is left half-imported with no indication of where it stopped.

One `readwrite` transaction for the whole batch is both faster and atomic.

### PWA-11 · Low · The service worker cache version is a hand-maintained constant

> **Already fixed on main.** The cache name is now `tiro-<version>`, stamped by
> `scripts/gen-version.mjs` from the root `VERSION` file, so `activate` drops the previous
> shell on every release.

**`web/sw.js:5`**

`VERSION = "tiro-v1"` is what `activate` uses to delete stale caches, and nothing in
`scripts/build-site.mjs` bumps it. Stale-while-revalidate means this mostly self-heals, but
old caches are never reclaimed across real releases. Deriving it from a build hash would
make the cleanup actually run.

### PWA-12 · Low · `seenSetup` is dead

**`web/src/settings.js:16`**

`DEFAULTS.seenSetup` is never read or written anywhere. The setup card is driven off the
presence of an API key instead (`app.js:562-568`). Remove it or wire it up.

### PWA-13 · Low · A dark-mode phone launches the app on a light screen

**`web/manifest.webmanifest:9-10`**

Added after this audit, when #20 made the app follow the system theme. `background_color` is
`#FCFAF4` and `theme_color` is `#F6F1E7`, both from the light palette, and a manifest cannot
branch on `prefers-color-scheme`. The document's per-scheme `<meta name="theme-color">` tags
take over once the page has loaded, so the only window this affects is the one before the
shell paints: on a phone in dark mode the launch screen and the task switcher card come up
light, then the app resolves dark.

Cosmetic, and there is no manifest-level fix. `apple-touch-startup-image` does accept a media
query, so the flash can be removed on iOS, but it needs one exact-size asset per device and
`scripts/gen-icons.mjs` would have to grow the whole matrix. Not worth it until someone
reports it. Recorded here so the next person does not re-derive why the colours are one-sided.

### PWA-14 · High · The tail streams nothing, so the last word is clipped anyway

> **Fixed on `claude/wispr-flow-desktop-widget-7x52cw`.** `stopAndInsert` now re-points
> `engine.onChunk` at the take it just captured, and `smoke-web.mjs` asserts the byte count
> grows during the tail.

**`web/src/app.js:304` (the handler in `pressStart`), `web/src/app.js:357-368` (`stopAndInsert`)**

`pressStart` installs `engine.onChunk = (c) => stream && stream.send(c)`, closing over the
module-level `stream`. `stopAndInsert` sets `stream = null` on its second line, then sleeps
for `TAIL_SEC` with the comment "keep streaming through the tail so the last word is not
clipped".

For that entire half second the handler evaluates `null && …` and sends nothing. The audio is
still captured, still counted into `recordedSamples`, and still billed through the duration
`endRecording()` returns — it simply never reaches Deepgram. Measured on the fake socket: zero
bytes sent between the release and `CloseStream`, 508 ms apart.

So the tail delayed the close without using the delay, and the exact failure it was written to
prevent — losing whatever you said last — happened on every take. Nothing caught it because
the transcript still arrives and still looks like a sentence.

---

## Windows — `windows/`

### WIN-01 · Critical · Right Alt is AltGr, and we swallow it unconditionally

**`windows/Tiro.Windows/KeyboardHook.cs:61-88`, `windows/Tiro.Windows/SettingsStore.cs:12`**

The default hotkey is `AltRight` → `VK_RMENU`, and the hook returns `(IntPtr)1` for every
matching key event:

```csharp
// swallow the key so the focused app never sees it
return (IntPtr)1;
```

On German, French, Spanish, Portuguese, Polish, Czech, Turkish and the Nordic layouts,
Right Alt *is* AltGr — it is how you type `@`, `€`, `{`, `}`, `[`, `]`, `\` and `~`.
Installing Tiro with defaults makes those characters untypable in every application on the
machine, for as long as Tiro is running.

This is worse than a bad default, because the symptom (can't type `@` in my email client)
is very hard to connect back to the cause (a dictation tray app). The comment on line 83
justifies swallowing to stop Right Alt activating menus, which is real — but that
trade-off was priced without AltGr in it.

Options, roughly in order of preference: detect an AltGr-bearing layout at startup via
`GetKeyboardLayout` and pick a different default there; or stop swallowing and accept menu
activation; or move the default to `ScrollLock`, which is already offered and has no
competing use. The choice is a product call, not a code one — but shipping the current
default to a European user is not viable.

### WIN-02 · High · The DPAPI-protected key is cached in plaintext next to it

**`web/src/app.js:546-550`, `windows/Tiro.Windows/KeyStore.cs:1-49`**

`KeyStore` encrypts the Deepgram key with DPAPI at `%APPDATA%\Tiro\key.bin`, and its doc
comment calls this "better than upstream's chmod-600 file and the PWA's browser storage".
The settings UI tells the user "Held by Windows (DPAPI, this user only)".

Then boot does this:

```js
const hostKey = await bridge.fetchKey();
if (hostKey) localStorage.setItem("tiro.apiKey", hostKey);
```

That writes the decrypted key into the WebView2 profile's LevelDB store at
`%APPDATA%\Tiro\WebView2\...\Local Storage\`, in plaintext, permanently. The DPAPI blob is
still there and still encrypted; it just no longer describes where the key actually lives.
Any process running as the user, or anyone with the profile folder, reads it directly.

Either drop the cache and have `settings.getApiKey()` go through the bridge on the shell
path, or stop claiming DPAPI protection in the UI. The first is the honest fix.

### WIN-03 · High · The hook watchdog cannot detect the failure it was written for

**`windows/Tiro.Windows/KeyboardHook.cs:44-46`**

```csharp
_watchdog.Tick += (_, _) => { if (_hook == IntPtr.Zero) Install(); };
```

This only reinstalls if `Install()` previously returned null — a launch-time failure. The
failure mode the class comment calls out at line 8 — "a slow hook lags every app's typing
and Windows silently unhooks it" — leaves `_hook` holding a stale non-zero handle, so the
watchdog never fires and the hotkey is dead until restart, with no log line and no UI
change.

Detecting this properly means tracking whether the callback has been invoked recently, or
just reinstalling unconditionally on a longer interval.

Related, same file: `_isDown` (line 35) is never reset outside the callback. If a key-up is
missed — session lock, fast user switch, the hook being reinstalled mid-press — the class
believes the key is still held and ignores the next press.

### WIN-04 · Medium · WebView2 auto-grants every permission kind, not just the microphone

**`windows/Tiro.Windows/MainForm.cs:117-124`**

```csharp
core.PermissionRequested += (_, e) =>
{
    if (e.Uri.StartsWith($"https://{VirtualHost}", ...))
    {
        e.State = CoreWebView2PermissionState.Allow;
```

There is no check on `e.PermissionKind`, so camera, geolocation, clipboard-read and
notifications are auto-allowed alongside the microphone. Today only our own page loads
there, so nothing exploits it — but the comment says the intent was specifically the mic,
and narrowing it to `CoreWebView2PermissionKind.Microphone` costs one line.

### WIN-05 · Medium · No recovery if the WebView2 process dies

> **Fixed on `claude/wispr-flow-desktop-widget-7x52cw`.** Both `ProcessFailed` and a failed
> `NavigationCompleted` now drop `_webReady` and report the `blocked` state. It was promoted
> from "live-looking app that does nothing" by the global Escape hook added on that branch:
> the hook is armed by the last state the page reported, so a crash mid-take left Escape
> swallowed system-wide, with nothing able to un-arm it but a message from the dead page.
> The outbox those messages now queue into is still unbounded, which is WIN-08.

**`windows/Tiro.Windows/MainForm.cs:97-129`**

Neither `CoreWebView2.ProcessFailed` nor `NavigationCompleted` is handled. If the render
process crashes or navigation fails, the window goes blank, the bridge stops responding,
and the tray icon keeps showing whatever state it was last told — a live-looking app that
does nothing. The runtime-missing path (lines 57-95) is handled carefully; this one is the
same class of problem and is not.

### WIN-06 · Medium · The recording pill is clipped on scaled displays and always lands on the primary monitor

> **Already fixed on main.** `RecordingPill` now rebuilds its region on `DpiChanged`, frees
> the `HRGN` with `DeleteObject`, and places against `Screen.FromHandle(...)` with
> `Screen.PrimaryScreen` only as a fallback. All three sub-issues are closed.

**`windows/Tiro.Windows/RecordingPill.cs:39`, `windows/Tiro.Windows/RecordingPill.cs:81-85`**

The rounded region is computed in the constructor from the unscaled `Width`/`Height`:

```csharp
Region = System.Drawing.Region.FromHrgn(CreateRoundRectRgn(0, 0, Width, Height, 22, 22));
```

The manifest declares `PerMonitorV2` DPI awareness (`app.manifest`), so WinForms scales the
form afterwards. At 150% the form is 360×66 but the region is still 240×44, and the bottom
and right of the pill are clipped away. The `HRGN` is also never `DeleteObject`'d, so each
pill leaks a GDI handle.

Separately, `Place()` uses `Screen.PrimaryScreen`, so on a multi-monitor setup the pill
appears on the primary display regardless of which screen the user is actually typing on.
`Screen.FromHandle(GetForegroundWindow())` is the right anchor.

### WIN-07 · Low · Malformed bridge messages throw inside the message handler

**`windows/Tiro.Windows/MainForm.cs:150-193`**

The `type` lookup uses `TryGetProperty`, but every payload read after it uses
`GetProperty`: `"text"`, `"state"`, `"code"`, `"value"`, `"line"`. A message with the right
type and a missing field throws `KeyNotFoundException` inside a WebView2 event handler.
Only our own code posts these today, so it is defensive rather than urgent — but the
handler is already careful about the JSON parse and then stops being careful.

### WIN-08 · Low · Unbounded outbox, undisposed icons and form

**`windows/Tiro.Windows/MainForm.cs:20`, `windows/Tiro.Windows/TrayContext.cs:31-41, 91-100`**

`_outbox` grows without limit if the web core never signals ready (which is exactly what
happens when the WebView2 runtime is missing). `_stateIcons` and `_mainForm` are never
disposed in `Quit()`, though process exit covers it in practice.

---

## macOS — `Sources/`

Upstream's app, and it shows: the audio path is careful, the crash cases have comments
explaining what they cost to learn, and the ObjC exception shim exists because someone hit
a real `installTap` crash on a Mac mini. The findings below are mostly sharp edges, with
one exception.

### MAC-01 · High · Every price, saving and credit estimate is roughly 1.8× optimistic

**`Sources/tiro/main.swift:16`, `Sources/tiro/windows.swift:17-19, 551`**

```swift
let DEEPGRAM_PER_MIN = 0.0043
```

The Mac app POSTs to the **prerecorded** endpoint (`main.swift:12`). The fork's own README
already says this rate is stale: *"Upstream's quoted $0.0043/min no longer matches
Deepgram's published pricing"* (`README.md:142`), and puts prerecorded at $0.0077/min.

That constant drives `Usage.monthCost`, `Usage.saved`, `Usage.savedPct`, the Settings
"Spent" and "Saved" figures, the History stats strip, the menu-bar line, and `creditText()`
— which divides remaining credit by it to tell the user how many minutes they have left.
Everything is understated by about 45%.

The three surfaces also now quote three different break-even points for the same product:

| Surface | Claim | Source |
|---|---|---|
| Mac settings footnote | ~58 h vs Wispr | `windows.swift:551` — $15 ÷ $0.0043 |
| README | ~52 h vs Wispr | `README.md:143` — $15 ÷ $0.0048 |
| PWA usage note | ~28 h vs cheapest | `usage.js:37` — $8 ÷ $0.0048 |

They are each internally consistent; they just measure different things against different
rates. Worth picking one framing across all three, since the savings argument is the whole
pitch and it currently reads as three different numbers.

The savings case survives the correction easily — that is not the issue. Telling someone
they have 46,000 minutes of credit when they have 26,000 is.

### MAC-02 · Medium · A network hang freezes the hotkey for the full URLSession timeout

**`Sources/tiro/main.swift:499-533`, `Sources/tiro/main.swift:433-443`**

`transcribe()` uses `URLSession.shared` with no `timeoutIntervalForRequest`, so the default
60 s applies. While the app is in `.transcribing`, `fnDown()` explicitly does nothing and
`fnUp()` guards on `.holdRecording`, so the hotkey is inert. On a stalled connection the
user gets a minute of a menu-bar icon that says "Transcribing…" and a hotkey that ignores
them, with no way to cancel.

A 20-25 s timeout and an escape path out of `.transcribing` would both help.

### MAC-03 · Medium · Long hands-free takes accumulate entirely in memory

**`Sources/tiro/main.swift:233-243, 254-262`**

In toggle mode, `active` is a `Data` that grows for the whole take at 32 KB/s and is then
wrapped into a single WAV and POSTed in one piece. A one-hour dictation is ~115 MB resident
and a 115 MB upload with no progress, no cancel, and a hard failure if it times out.

The PWA does not have this problem — it streams over a WebSocket. This is the strongest
argument for eventually moving the Mac app onto the streaming endpoint too, which would
also fix MAC-01's rate and MAC-02's dead-air window in one change.

### MAC-04 · Low · History is fully re-read and re-parsed on every menu open

**`Sources/tiro/main.swift:426-429`, `Sources/tiro/windows.swift:28-37`**

`menuWillOpen` calls `loadHistory` → read the whole JSONL, `JSONSerialization` every line,
build every `HistoryEntry` — synchronously on the main thread, just to render one
`"12.4 min · $0.05 this month"` line. `HistoryWindowController.reload()` does the same on
every keystroke in the search field.

Invisible at hundreds of entries. At tens of thousands — which a daily user reaches inside
a year — the menu will visibly stick.

### MAC-05 · Low · `level` is read across threads without synchronisation

**`Sources/tiro/main.swift:233-243`, `Sources/tiro/main.swift:346`**

`AudioCapture.level` is written inside `q.async` on the audio queue and read from the main
thread through `pill.levelProvider`. A torn `Float` is not a practical hazard, but it is a
data race, and it is the kind that Swift 6's concurrency checking will refuse to build.

### MAC-06 · Low · The API key file is briefly world-readable

**`Sources/tiro/main.swift:51-55`**

```swift
try? key.write(to: url, atomically: true, encoding: .utf8)
try? FileManager.default.setAttributes([.posixPermissions: 0o600], ...)
```

The file is created at the default umask (0644 on stock macOS) and chmod'd immediately
after. The window is tiny and the attacker would need local access, but writing to a
pre-created 0600 file removes it entirely.

---

## Cross-cutting

> **Overtaken by main.** `scripts/smoke-web.mjs` is a Playwright suite covering the install
> sheet, the level halo, a full take, and the tap-before-mic-ready race. The paragraph below
> stood at `d07d9d0`; what remains true is that the Swift and C# sides still have no tests,
> and that `smoke-web.mjs` is not yet wired into CI.

**There were no automated tests anywhere in the repository.** CI (`.github/workflows/build.yml`)
builds both apps and asserts the macOS binary is universal — which is a genuinely good
check, and caught a real v1.0.0 regression — but nothing executes a line of application
logic. The pieces that would benefit most are pure and easy to test today:
`usage.js:monthStats`, `history.js:importJsonl`, the `Resampler` in `audio.js`, and
`computeUsage` in `windows.swift`.

`web/src/audio.js:29` also carries a small piece of dead code worth noting while in there:
the `i === -1 ? this.prev : input[i]` branch can never be taken, because `this.pos` is
always left non-negative by line 36. The cross-chunk interpolation it was written for does
not happen. It is inaudible at the 3:1 ratio a 48 kHz context actually uses, which is why
nobody has noticed.

---

## Suggested order

1. ~~**PWA-02**~~ — done.
2. ~~**PWA-04**~~ — done.
3. **Test PWA-01 on a real iPhone.** Everything about the PWA storage design depends on the
   answer, and the answer takes ten minutes to get.
4. **WIN-01** — decide the AltGr policy before the Windows build gets any real distribution.
   Shipping it and changing it later is worse than deciding now.
5. **PWA-03** — the "Deepgram rejected your key" misdiagnosis, which a new phone user on a
   captive portal hits in their first sixty seconds.
6. **MAC-01, WIN-02** — both are cases where the product tells the user something that is
   not true. Cheap to fix, and they undermine trust in the parts that are accurate.

Everything below that is real but can queue.

## On verification

The two fixes above were checked by driving the real page in Chromium — a stalled
`getUserMedia` for PWA-02, computed styles on an iPhone 13 viewport for PWA-04 — with the
previous commit used as a baseline to confirm each check actually catches the bug it
claims to. Those harnesses live outside the repo, because the repo has no test
infrastructure to put them in (see Cross-cutting). Wiring them into CI is worth doing and
is not done here.
