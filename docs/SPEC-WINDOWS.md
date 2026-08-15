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
- A small always-on-top status pill near the cursor while recording, matching the macOS one.
- Log to `%APPDATA%\Tiro\tiro.log`.

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
- Pasting into an elevated window gives a clear message rather than failing silently.
- The hook does not make typing feel laggy in any other application.
- Two launches result in one running app.
- History and usage match the PWA's, because it is the same code.

## Out of scope for this phase

- Installer, signing, winget manifest. Phase 5.
- Any UI written in XAML beyond the tray, the pill and the WebView host. All product UI is the
  web core.
- Windows 10 support. Check WebView2 runtime presence if this comes up later; it is guaranteed
  only on Windows 11.
