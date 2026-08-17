# Build spec: the Windows app

Phase 4. Do not start until the PWA core is working, because this app hosts it.

Target is Windows 11. The user's machine has .NET 10 installed.

## What it is

The macOS app, on Windows. A tray app that sits idle, watches for a global hotkey, records while
you hold it, and pastes the transcript into whatever text box has focus. No window unless you
open one.

Unlike the PWA, this can genuinely type into other apps, so it is full parity with upstream.

## Approach

**A WinUI 3 host wrapping a WebView2 that runs the same web core as the PWA.**

The native layer does only what a browser cannot:

| Concern | Where it lives |
|---|---|
| Global hotkey | Native. `WH_KEYBOARD_LL` low-level keyboard hook. |
| Paste into focused app | Native. `SendInput` with Ctrl+V, then restore the clipboard. |
| Tray icon, menu, autostart | Native. |
| Single-instance guard | Native. Named mutex. |
| Mic capture, pre-roll, resampling | Web core, unchanged. `getUserMedia` works in WebView2. |
| Deepgram streaming client | Web core, unchanged. |
| History, usage, settings, all UI | Web core, unchanged. |

Native and web talk over the WebView2 host bridge: the hook posts hotkey down/up events in, the
web core posts a finished transcript out, and the native side pastes it.

Rationale and the fallback plan are in [ARCHITECTURE.md](ARCHITECTURE.md). Short version: the
expensive parts of this product are not platform-specific, and maintaining two implementations
of the pre-roll timing and the history UI is how they drift apart.

WebView2 is not Electron. It uses the Edge runtime already present on Windows 11 rather than
bundling a browser, so upstream's "no Electron" claim survives.

## Requirements

### 4.1 Global hotkey

Low-level keyboard hook, `WH_KEYBOARD_LL`.

**Fn cannot be used.** It is resolved in keyboard firmware and produces no scan code, so no hook
can see it. Upstream's default does not port. This is finding 8 in [RESEARCH.md](RESEARCH.md).

- Default to **Right Alt**. Configurable, mirroring upstream's dropdown.
- Offer Right Alt, Right Shift, Right Ctrl, Caps Lock, Scroll Lock.
- **Do not default to Right Ctrl** on this machine: it is half of the Right Ctrl + Scroll Lock
  crash dump keystroke armed for the freeze investigation.
- Caps Lock is an advanced option only. Suppressing its toggle from a hook is fiddly and leaves
  the keyboard LED out of sync with reality.
- The hook runs on the UI thread and must return fast. Do no work in the callback beyond posting
  a message. A slow hook makes the whole system's typing feel laggy, and Windows will eventually
  time out and silently unhook you.
- Handle the hook being dropped by the OS and reinstall it.
- Same 0.35 s hold/tap threshold as everywhere else.
- **Escape discards the take**, and the same hook watches for it. Arm that watch only while a
  take is actually running: a hook that swallows Escape all the time breaks every dialog and
  menu on the machine. While a take *is* running, swallowing it is right, because you pressed it
  to stop dictating and not to dismiss whatever is behind the pill.

### 4.2 Paste

`SendInput` sending Ctrl+V to the focused window.

- No permission gate exists on Windows, unlike macOS Accessibility. Delete that branch rather
  than porting it.
- Save and restore the previous clipboard contents, as upstream does, after roughly 0.5 s.
- A non-elevated app cannot send input to an elevated window. If the target is elevated the paste
  is silently dropped, so detect it and tell the user rather than appearing to succeed. This is
  the one case where the PWA's "it is on your clipboard, paste it yourself" fallback is the right
  behaviour.
- Restoring rich clipboard content is better than upstream's plain-text-only restore, but is not
  worth blocking the phase on.

### 4.3 Tray and lifecycle

- Tray icon reflecting state: idle, recording, transcribing, blocked. Same four states and the
  same Tironian mark as the macOS menu bar item.
- Menu: History, Settings, view log, quit.
- Autostart via the `Run` registry key, off by default and toggleable in settings.
- Single instance via a named mutex. Upstream hit a real crash from two copies fighting over the
  mic, so activate the existing window instead of starting a second process.
- A small always-on-top status pill near the cursor while recording, matching the macOS one:
  pulsing dot, live waveform, clock. The waveform is driven by a `level` message from the web
  core, already smoothed and normalised there, so this meter and the PWA's halo cannot disagree
  about what your voice looks like.
- The pill carries the two controls the hotkey cannot express: **X to discard** and **check to
  finish now**. It must answer `WM_MOUSEACTIVATE` with `MA_NOACTIVATE`, or clicking it
  deactivates the window being dictated into and the transcript pastes into the wrong place.
  Both buttons act by posting to the web core rather than locally: it owns the take, the socket
  and the history, and a second authority over any of those is how the two ends drift apart.
- Log to `%APPDATA%\Tiro\tiro.log`.
- **Update check.** Nothing installs this app, so nothing updates it. Once a week at most, and
  never during launch, ask GitHub for the latest release tag and compare it numerically with
  the running version. If it is newer, show it in the tray menu and offer the release page;
  otherwise say nothing. The check is the tightest thing in this spec, because it is the only
  outbound request the app makes that is not dictation:
  - an anonymous `GET` of a public URL, identical to opening the releases page in a browser;
  - **no identifiers of any kind** — no account, install ID, device ID, usage or transcript
    data. The `User-Agent` names the app and version because GitHub's API rejects requests
    without one, and that is the whole of it;
  - nothing is reported to us, because there is nothing to report to: this app has no server,
    and the check reads a public endpoint rather than checking in;
  - off is a menu item away, and is remembered;
  - failure is silent. Offline is not worth an interruption.

  Compare versions as three numbers, never as strings: `1.10.0` is newer than `1.9.0`, and a
  string compare says the opposite, which would silently stop every user hearing about
  updates. Anything unparseable means "no update", so a tag named something unexpected cannot
  nag everyone every week. `Tiro.exe --self-test` asserts all of that, and CI runs it against
  the EXE that ships.

- **What is worth interrupting someone over.** Finding an update is not the same as being
  worth a notification. The version number already says what changed, because the release
  rules make it say so, so read it rather than inventing a signal:

  | Step | Verdict | What happens |
  |---|---|---|
  | `1.2.0` → `1.3.0` or `2.0.0` | something was added | tray menu, tooltip, balloon, **and a banner in the app** |
  | `1.2.0` → `1.2.1` | one fix | tray menu and tooltip only. Nobody gets pulled out of a sentence to hear that a typo was corrected |
  | `1.2.0` → `1.2.2` or further | fixes piling up | treated as worth saying once: this is no longer a typo, it is a stack of things you are missing |

  Two rules on top of that, and both matter more than the table: it is said **once per
  version** — dismissing 1.3.0 means never being asked about 1.3.0 again, only about what
  comes after it — and it is **never said mid-take**, because a Download button under a
  thumb that is holding the record button is the worst possible offer. "Check for updates"
  from the menu always answers, since then you asked.

  The web core applies the identical test (`updateWorth` in `web/src/app.js`, `Classify` in
  `UpdateCheck.cs`), so the app and the shell cannot disagree about what deserves a banner.

  All of which puts the weight on whoever bumps `VERSION` choosing the right digit, since
  that choice is what decides whether anyone is told. `CLAUDE.md`, "Which digit to bump",
  is the decision procedure, including the two rules that resolve the hard cases: a fix
  everyone must see ships as a minor bump rather than gaining a severity flag, and a release
  with nothing user-visible in it does not need a version at all.

### 4.4 Storage

- History at `%APPDATA%\Tiro\history.jsonl`, same schema as everywhere else.
- API key via **DPAPI** (`ProtectedData`, current-user scope), not plain text. This is better
  than upstream's `chmod 600` file and better than the PWA's browser storage, and it is cheap on
  Windows, so do it.
- Settings in `%APPDATA%\Tiro\settings.json`.

### 4.5 Audio

Nothing to build if WebView2 handles it. Verify early, in a spike before committing to the
approach:

- Does `getUserMedia` work inside WebView2 without a browser-style prompt, and can the host
  pre-grant it? Listed as an open question in RESEARCH.md.
- Is the capture latency through WebView2 low enough that pre-roll still feels instant?

If either answer is bad, fall back to capturing in C# with NAudio or WASAPI and feeding PCM to
the web layer over the bridge. The web core's audio module is deliberately separable so this is a
contained change, which is why it is safe to try WebView2 first.

## Definition of done

- Holding Right Alt in any application dictates into the focused text box.
- Speaking slightly before pressing still captures the first word.
- Tap-to-toggle hands-free works, including a pause mid-sentence.
- Unplugging a USB headset mid-session does not require restarting the app.
- Plugging one *in* mid-session also switches to it. The old track stays open and happy in that
  case, so nothing but the device list changing gives it away; the web core watches for that and
  reopens the mic against the current system default. Mid-take it waits for the take to end
  rather than throwing away the words being spoken.
- Pasting into an elevated window gives a clear message rather than failing silently.
- The hook does not make typing feel laggy in any other application.
- Two launches result in one running app.
- History and usage match the PWA's, because it is the same code.

## Out of scope for this phase

- Installer, winget manifest. Phase 5, and both are now settled: the manifest is checked in and
  built by CI ([PACKAGING.md](PACKAGING.md)), and there is no installer because winget takes the
  portable ZIP directly and Tiro has nothing for an installer to do. Authenticode signing landed
  ahead of that phase because SmartScreen blocks first launches without it — see
  [SIGNING.md](SIGNING.md).
- Any UI written in XAML beyond the tray, the pill and the WebView host. All product UI is the
  web core.
- Windows 10 support. Check WebView2 runtime presence if this comes up later; it is guaranteed
  only on Windows 11.
