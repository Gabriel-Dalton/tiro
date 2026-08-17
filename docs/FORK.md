# What this fork adds

For Toby, and for anyone deciding whether any of this is worth taking upstream.

Tiro on macOS is yours and this fork does not touch it. `git diff upstream/main -- Sources/` is
empty, and that is deliberate rather than incidental: the Swift app is carried verbatim so that
anything here can be taken or left without unpicking it from your work.

What the fork adds is the two platforms the macOS app does not reach: **the phone, as a PWA**, and
**Windows, as a WebView2 shell**. Both run the same web core, so they are one product with one
codebase rather than two ports.

---

## The honest limit first

**A PWA cannot type into other apps on iOS.** No global hotkey, no background microphone, no API
for inserting text into another app's field. That is an Apple platform rule, not a gap in the
build, and the paid competitors get around it by shipping a native custom keyboard, which is a
separate product.

So the PWA is scoped as what it can actually be: a fast dictation scratchpad. Hold, speak, and the
transcript is on the clipboard before you switch apps. You paste it yourself. Windows has no such
limit and gets full parity with the Mac.

Saying this out loud in the README, in the app, and here is a deliberate choice. The alternative is
someone discovering it during a demo.

---

## One web core, two clients

`web/` is the whole product interface: the hold-and-tap state machine, the audio pipeline, history,
usage, settings. `web/src/bridge.js` is the only file that knows whether it is running in Safari on
a phone or inside WebView2 on a PC. The Windows side is a shell around it — the global hotkey,
`SendInput`, DPAPI, the tray, the pill — and nothing else.

The reason to mention the architecture at all is that it decides how much of this you could take:
`web/` alone is a self-contained thing that runs on any static host, and it does not need the
Windows half to exist.

These are the same files in both places. Left, `web/` at an iPhone viewport; right, the identical
build at the width the WebView2 window opens at on Windows. The layout widens; nothing forks.

<div align="center">
<img src="https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/web/phone-take.png" width="250" alt="Tiro on a phone: a finished take, the transcript on a card with Copy and Share beneath it">
<img src="https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/web/desktop-take.png" width="460" alt="The same finished take at desktop width, the layout widening rather than changing">
</div>

The macOS app, which this fork carries unchanged:

![The app's history view](https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/history.png)

---

## Windows

Downloaded as **one EXE**, run from wherever it lands.

On first run it offers to install itself into `%LOCALAPPDATA%\Programs\Tiro`, with a Start menu
entry, an Apps and Features entry, and no administrator rights at any point. Decline and it stays
portable; the tray menu can still install it later. Removing it keeps your history, settings and
API key unless you tick the box that says otherwise.

![The install prompt on first run](https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/windows/install-prompt.png)

The app itself is the same web core the phone runs, inside a WebView2 window:

![The Windows app window](https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/windows/app-window.png)

Uninstalling asks once, and asks the question that actually matters rather than burying it:

![The uninstall prompt, with the data checkbox](https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/windows/uninstall-prompt.png)

Two things in here were harder than they look, and both are worth knowing if you ever ship a
Windows build of anything:

- **`PublishSingleFile` does not bundle `Content` items.** The web core and the icons had to become
  embedded resources, and `WebView2Loader.dll` — which the WebView2 package contributes as a
  Content item — silently stayed loose. So the "single file" download was two files, and the EXE on
  its own threw `DllNotFoundException` at the first call into WebView2: a window that never opens.
  It is embedded and loaded by full path now.
- **`InitPropVariantFromString` is not an export of `propsys.dll`.** It is an inline helper in
  `propvarutil.h`. Setting a shortcut's Application User Model ID through it throws every time, and
  because the throw was caught and logged, two releases shipped advertising a taskbar pin with
  nothing in the Start menu to pin.

Both were found by running the app on a real machine after it had been written, reviewed and
approved, and both are now assertions in `Tiro.exe --self-test` that a build agent cannot satisfy
by accident. That is the part worth borrowing: the self-test runs the shipped EXE from a folder
containing nothing else.

### The pill

While you dictate into another app, a small pill shows the waveform, the clock, and buttons to stop
or throw the take away. While the transcript is being fetched, the same strip keeps moving with a
swell crossing it rather than the pill spelling out "Transcribing…", because that is a word to read
at the one moment you have already looked back at what you were dictating into.

*(No picture of the pill yet, and it is the one image here that cannot be automated: the keyboard
hook ignores injected input so that the app's own paste cannot re-trigger it, and the waveform is
somebody's voice rather than something a script can supply. It is in the table at the bottom.)*

---

## The phone

Installed to the Home Screen, the PWA keeps its storage. That is not cosmetic on iOS: Safari can
clear a site's `localStorage` after seven days of not visiting, and that storage holds the Deepgram
key. So installing is the difference between the app remembering you and asking for a key again
next week, and the install flow got more attention than anything else in the web core because of
it.

iOS has no install API at all, so the button opens a walkthrough that **draws Safari's own toolbar**
with the Share button circled — "tap Share" is something you can hold next to your screen and match
rather than a name you have to already know. It asks after the first successful take rather than on
arrival, and other iOS browsers get a Copy link button instead, because Chrome and Firefox on iOS
are Safari's engine without that row in the share sheet.

<div align="center">
<img src="https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/install-iphone-safari.png" width="300" alt="The install walkthrough in Safari on iPhone, drawing Safari's toolbar with the Share button circled">
<img src="https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/install-iphone-other-browser.png" width="300" alt="The install sheet in Chrome on iPhone, offering a Copy link button and directing the reader to Safari">
</div>

### The rest of it, at phone width

First run asks for a key and says what dictation costs before asking for anything; a take shows the
clock and a halo tracking the microphone; history stays on the device and exports as the same JSONL
the Mac and Windows write; Usage is arithmetic over that history, set against the subscriptions this
replaces.

<div align="center">
<img src="https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/web/phone-setup.png" width="185" alt="First run: a card explaining the Deepgram key, what it costs, and a field to paste one into">
<img src="https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/web/phone-recording.png" width="185" alt="Mid-take: the button red and reading Listening, with a running clock and a Discard button">
<img src="https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/web/phone-history.png" width="185" alt="History grouped by day, each take with its time, its length, and copy and delete buttons">
<img src="https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/web/phone-usage.png" width="185" alt="Usage: minutes this month, estimated cost, a per-day chart, and a comparison against paid subscriptions">
<img src="https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/web/phone-settings.png" width="185" alt="Settings: the API key stored on the device, Canadian spelling, and the warm microphone option">
</div>

Dark mode is the same interface through the semantic tokens rather than a second stylesheet, which
is the part worth checking with your own eyes:

<div align="center">
<img src="https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/web/phone-history-dark.png" width="235" alt="The history view in dark mode, the same layout on a near-black surface">
<img src="https://raw.githubusercontent.com/Gabriel-Dalton/tiro/2a2fd5891158a1454394cb6512d05891560efd44/docs/web/phone-idle.png" width="235" alt="The dictate view at rest in light mode, one button reading Hold to talk">
</div>

---

## Smaller things that might be of more use than the platforms

- **Releases are cut from impact notes.** Every pull request that changes something a user would
  notice adds one file to `.changes/` saying what they would notice and how big it is. Merging to
  `main` generates the version, the changelog section, the tag and three downloads in one run. The
  bump decides who gets interrupted: both apps compare versions and interrupt only for a minor or
  major. `.changes/README.md` has the reasoning, including the honest warning that the review of the
  pull request *is* the release review.
- **A Playwright suite that drives the real web core** with a stubbed Deepgram socket and a
  synthetic microphone, so it needs no key, no network and no hardware. It covers the things that
  only break in a browser: the install sheet per platform, a full take, the race where someone taps
  faster than the microphone can open, the service worker offering an update instead of swapping
  itself in, and the accessibility floor measured off the rendered page rather than asserted about
  the source.
- **A standing audit** of all three clients with stable IDs per finding, in `docs/AUDIT.md`,
  including the ones still open.
- **A non-technical guide to getting a Deepgram key**, at `docs/API-KEY.md` and on the site, because
  that step is the hardest thing in the product and the place people give up.
- **Canadian English on by default when the device says Canada**, as a local ruleset over the
  finished transcript rather than a language parameter, with the ambiguous words deliberately left
  alone and named in Settings.

---

## What is not finished

Stated plainly, because you would find all of it in an afternoon:

- **The PWA has not been run on real iOS hardware.** Two Critical findings in `docs/AUDIT.md`
  (PWA-01, PWA-02) both land on the first-run install path, and PWA-01's fix depends on what iOS
  actually does with Home Screen storage.
- **Windows releases are unsigned.** `SIGNPATH_API_TOKEN` is not configured, so SmartScreen
  interrupts the first launch. `docs/SIGNING.md` covers what signing would take.
- **The audit is stale.** It was written against an older commit and its own staleness banner is now
  out of date.
- **There is no in-app updater yet.** The tray notices a new release and opens the GitHub releases
  page, which ordinary people do not use, so in practice nobody updates.
- **`docs/AUDIT.md` MAC-01 is about your app**, and it is the one finding here that touches
  `Sources/`: the pricing constants are roughly 1.8x optimistic, and `DEEPGRAM_PER_MIN` in
  `main.swift` now disagrees with the shared design tokens the other two clients read. It is
  unfixed here precisely because fixing it would mean editing `Sources/`, and this fork's whole
  claim is that it does not.

---

## Where the pictures come from

Nothing here is a mock-up, and the distinction worth keeping is which of two ways a shot was taken.

**Every image above is linked by a full URL pinned to a commit, not by a relative path, and that is
deliberate.** This document is meant to be read from another repository — an upstream pull request,
where relative paths would resolve against *that* repository and every picture would be a broken
icon. Pinning to a commit rather than to a branch also means the images survive being deleted from
the working tree later: the blobs stay reachable through history, so the links keep resolving after
the PNGs are gone, which is how a repository can show its work without carrying binaries forever.

Two things follow. **Do not convert these back to relative paths** as a tidy-up; that breaks the
document everywhere except this repository, and breaks it here too once the files are removed. And
**do not rewrite the history these commits sit in.** A force-push that orphans them takes every
picture in this file with it, silently, and nothing will fail until somebody opens the page.

**The web core photographs itself.** `docs/web/*.png` are written by `node scripts/shoot-web.mjs`,
which runs the shipped `web/` in a real Chromium against the same stubbed Deepgram socket and
synthetic microphone the smoke suite uses, drives a take through the app's own state machine, and
screenshots what comes out. No key, no network, no hardware: the transcript on the card is the one
that take produced and the halo is wherever the audio put it. Regenerate them in the pull request
that changes the interface, so this document cannot advertise a version of the app that no longer
exists.

Two caveats on those, because they are the sort a reader should not have to find. Chromium at an
iPhone viewport draws the layout and the type faithfully and **is not iOS**: it cannot draw Safari's
chrome, the Home Screen, or the real share sheet, so the shots needing those are still in the table
below. And the history list is seeded with written sample sentences rather than anybody's dictation,
because four takes run for the camera would all be stamped the same minute and a history screenshot
is about a list over time. The rendering, the grouping and the arithmetic on Usage are the app's own.

**The Windows shell has to be photographed by hand.** Done: `windows/install-prompt.png`,
`windows/uninstall-prompt.png`, `windows/app-window.png`, all three captures of the running app on
Windows 11.

They are taken with `PrintWindow`, which hands the window a device context and lets it draw itself.
The first attempt read the screen instead, using UI Automation rectangles for the crop, and produced
pictures of the wrong monitor: on a scaled multi-monitor desktop those two live in different
coordinate spaces. `PrintWindow` has no coordinates in it at all, so none of that matters, and it
captures a window that is behind another one.

**The pill cannot be captured without a person**, and that is by design rather than a gap:
`KeyboardHook.cs` ignores injected input, so that the Ctrl+V the app sends to paste a transcript
cannot re-trigger the hotkey. A synthesised Right Alt does nothing at all. The button inside the
window is no way round it either, because WebView2 does not expose its accessibility tree to a plain
client. So the waveform has to be somebody's actual voice, which is the right answer anyway: a
silent take photographs as a flat line.

### Still to take

Each of these needs a person at the machine, and the two pill shots need one at the keyboard.

| File | What it should show |
|---|---|
| `windows/pill-recording.png` | The pill mid-take, over another application, waveform moving |
| `windows/pill-transcribing.png` | The same pill with the sweep crossing it |
| `windows/tray-menu.png` | The tray menu open, showing the install and pin items |
| `windows/start-menu.png` | Start search finding Tiro, and the pin-to-taskbar option |
| `windows/apps-and-features.png` | The Apps and Features entry, with version and publisher |
| `phone-home-screen.png` | Tiro installed on an iPhone Home Screen, beside other apps |
| `phone-safari-real.png` | The install walkthrough on a real iPhone, Safari's own toolbar below it |
