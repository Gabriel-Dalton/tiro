# Changelog

What changed in each release, in plain terms, including the things that were broken.

Every release publishes the same three apps from one version number, so **1.2.0 on the Mac,
on Windows and in the browser are the same release** even when a change only touched one of
them. Where an entry affects one platform, it says so.

The heading of each version links to its GitHub release, which is where the downloads live.
This file is the source those release notes are written from — `scripts/release-notes.mjs`
reads the section below and the release job refuses to publish a version this file does not
describe, so a release can never ship without notes.

Versions follow [semantic versioning](https://semver.org): the middle number moves when
something is added or the interface changes, the last when the fix is the whole story.

---

## [Unreleased]

Nothing yet.

## [1.2.0] — unreleased

The Windows release. A recording widget you can see and drive without leaving the app you
are typing in, a hotkey that says why when it cannot do anything, and a pin that survives an
update. Plus knowing when to update at all.

### Added

- **The Windows recording widget.** A pill above the taskbar for as long as a take is
  running, on whichever monitor your cursor is on: a pulsing dot, your voice as a live
  waveform, a clock, and the two controls the hotkey has no way to express — **X to throw
  the take away** and **a check to finish it now**. **Escape discards** from anywhere while
  a take is in flight, and is left alone the rest of the time so it does not break every
  dialog and menu on the machine. Clicking the pill does not steal focus, so the transcript
  still pastes into the window you were dictating into. *(Windows.)*
- **Pin Tiro to the taskbar, and keep it pinned.** Tiro writes a Start Menu shortcut on
  first run, so **Start → type Tiro → Pin to taskbar** works even though nothing installed
  the app; **Pin to the taskbar…** in the tray menu repeats the steps and writes the
  shortcut again if you removed it. Removing it is respected rather than undone on the next
  launch. The pin now survives updates: Tiro declares a fixed identity instead of letting
  Windows derive one from wherever the EXE happens to sit, which is what used to leave a
  dead pinned button after the next download, and what used to split the pin and the running
  window into two separate taskbar icons. On the Mac, Tiro is already in the Dock while it
  runs — right-click → Options → **Keep in Dock**. *(Windows, macOS.)*
- **Tiro tells you when there is a new version**, rather than leaving you to notice. The web
  app names the version waiting and offers **Update**; the Windows app reads GitHub's latest
  release once a week and offers it in the app and in the tray menu. It does not fire for
  every release — the rule, and exactly what the check does and does not send, are under
  [Update notifications](#update-notifications) below. *(Web, Windows.)*
- **This changelog**, backfilled to 1.0.0, and release notes generated from it — so the notes
  on the download page and the record in the repository cannot say different things.

### Fixed

- **A hotkey press that could not record said nothing at all.** On Windows, holding the
  hotkey with no Deepgram key saved, or offline, or with no microphone available, produced
  no widget, no message and no sound: the explanation was written into the Tiro window,
  which is hidden exactly when the global hotkey is the thing you are using. There was no
  way to tell it apart from the hotkey not working, and the honest reading was that the app
  was broken. Every one of those reasons now appears on the widget, where the recording
  would have been. **A missing or rejected key is clickable** and opens Tiro on the settings
  it needs. *(Windows.)*
- **The web app no longer swaps a new version in underneath you.** The service worker
  activated as soon as it finished downloading, which could replace the running app in the
  middle of a take, with a socket open and a clipboard write pending — and said nothing
  either way. It now waits until you take the offer. *(Web.)*

### Update notifications

New in this release, and the reason it is worth reading rather than skimming:

- **You are not told about every release.** A prompt that fires every time teaches people to
  dismiss prompts, so the version number decides: a release that **adds** something gets one
  banner naming it, a single **fix** gets none and simply applies next time you open the app,
  and **two or more fixes behind** is treated as worth saying once. Whatever you are shown,
  you are shown once per version — turning down 1.3.0 means being asked about 1.4.0, not
  about 1.3.0 again — and nothing ever interrupts a take.
- **Web and installed PWA.** The app already re-fetched itself in the background; it just
  never said so, and swapped the new version in under a page that was mid-take. Now the new
  version waits, a toast names it and offers **Update**, and nothing changes until you take
  it. No new network requests: it only ever re-fetches Tiro's own files, from the same
  address the app is already served from.
- **Windows.** Once a week, at most, Tiro asks GitHub whether there is a newer release. Its
  tray menu always says what it found; the banner inside the app appears when the release is
  worth it by the rule above, and offers to open the release page. **It sends no
  identifiers**: no account, no device ID, no usage, nothing about what you dictate — the
  request is the same anonymous one your browser would make opening the releases page, and
  GitHub sees an IP address and nothing else. It can be turned off in the tray menu, and
  turning it off is remembered. If you installed via `winget`, `winget upgrade` continues to
  work and this changes nothing about that.
- **macOS** is unchanged and checks nothing: that app is upstream's, and this fork's rule is
  not to modify it. The Mac app's version is in its About box, and the
  [releases page](https://github.com/Gabriel-Dalton/tiro/releases/latest) is the place to
  compare it.

## [1.1.0] — 2026-08-16

The interface release. If you have used Tiro before, this is the one you will notice.

### Added

- **The app follows your system theme.** A full dark palette, built from the same Forum
  colours, with the clay accent lifted until it stays legible against a warm near-black
  page. There is no switch to find: it follows the appearance you already set. *(Web,
  Windows.)*
- **Dictate from the keyboard.** Hold **Space** or **Enter** on the focused button, exactly
  like holding it with a finger. The button was pointer-only before, so anyone working from
  a keyboard, a switch, or a screen reader could reach it and do nothing with it. *(Web,
  Windows.)*
- **Delete a single transcript** from History, next to the copy button, instead of clearing
  everything or nothing. *(Web, Windows.)*
- **Reveal your API key** while typing it, so a mistyped character is something you can see
  rather than deduce from "key rejected". *(Web, Windows.)*
- **The Deepgram key walkthrough is on the website**, with drawings of the console screens it
  describes, rather than only in a document on GitHub. *(Website.)*

### Changed

- **The interface is no longer set in a monospaced face.** Labels, tabs, buttons and section
  headings were 9–10px monospaced uppercase, which made a dictation app read like a
  terminal. Three faces now have three jobs: the serif carries titles and anything *you*
  dictated, the sans carries the interface, and the mono is kept for figures you actually
  read off — the timer, timestamps, prices, the version. Body text went from 15px to 16px.
  *(Web, Windows.)*
- **The tab bar has real icons.** Three of the four were text characters (`⌸ ◔ ✳`) that
  every platform draws in a different typeface; on iOS one of them arrived as a small dot.
  They are now one drawn set, and the current tab is marked by a pill behind its icon rather
  than by colour alone. On a laptop or desktop the bar becomes a floating pill instead of a
  strip glued to the bottom edge. *(Web, Windows.)*
- **Alignment.** One spacing rhythm and one column definition shared by the header, the
  content and the tab bar, so the edges line up. The record button is centred in the space
  it has instead of clinging to the top of a mostly empty screen, and it stands aside on
  first run, when setting up your key is the actual task. *(Web, Windows.)*
- **History** gives the transcript the full width of the card, shows how many takes you
  have, and distinguishes "nothing matches that search" from "nothing here yet". *(Web,
  Windows.)*
- **Save & test** says that it is testing, and will not start a second check over the top of
  the first. *(Web, Windows.)*
- The Settings key field is labelled **Deepgram API key** rather than `dg_…`: a masked field
  wants a name, not a format you cannot check against what you typed. *(Web, Windows.)*

### Fixed

- **Text that was too faint to read.** Several greys sat between 3.0:1 and 3.4:1 against the
  paper, where 4.5:1 is the accessibility floor for body text — the tab labels, timestamps
  and the version string among them, and the amber "warning" badge failed too. Every text
  colour in the app is now measured against the surface it actually lands on, in both
  themes, and the build fails if one drops below the floor. *(Web, Windows.)*
- **The timer no longer lands on top of the hint** underneath the record button, and the
  page no longer reflows under your thumb the moment recording starts. *(Web, Windows.)*
- **Screen readers now get told what the app is doing**: the recording state, which tab you
  are on, what the usage chart shows, and what every icon button does. Icon-only buttons had
  no names at all. *(Web, Windows.)*
- **The install sheet behaves like a dialog.** Focus goes into it, Tab cannot walk out of the
  back of it into the page behind, Escape closes it, and focus returns to the button that
  opened it. *(Web.)*
- **Clearing history now redraws the History view**, instead of leaving the entries you just
  deleted on screen until you switched tabs and back. *(Web, Windows.)*

## [1.0.1] — 2026-08-16

A first week of fixes, most of them found by using the thing on a phone.

### Added

- **Install the web app properly on an iPhone.** Safari has no install API, so the button
  now opens a walkthrough that draws Safari's own toolbar with the Share button circled, and
  asks only after your first successful take rather than on arrival. Other iOS browsers,
  which Apple leaves that menu row out of, get a Copy link button and are told to open
  Safari. This matters more than it sounds: an installed app keeps your API key, while a
  Safari tab's storage can be cleared after seven days away. *(Web.)*
- **A step-by-step guide to getting a Deepgram key**, with pictures, for anyone who has never
  seen a developer console. Linked from the setup card.
  ([docs/API-KEY.md](docs/API-KEY.md))
- **Signed Windows releases** via SignPath Foundation, plus a winget manifest generated and
  attached to every release. ([docs/SIGNING.md](docs/SIGNING.md),
  [docs/PACKAGING.md](docs/PACKAGING.md)) *(Windows.)*
- **Every build reports its version**, in the app and on the download page, from one file.

### Fixed

- **The first press could get stuck.** Releasing the button before the microphone had
  finished opening — which is exactly what happens on the very first run, behind the
  permission prompt — left the app saying "Listening…" forever, and pressing again opened a
  second connection on top of the first. *(Web, Windows.)*
- **iOS zoomed the page** when you tapped the API key field, pushing the tab bar off-screen,
  and did not zoom back out. *(Web.)*
- **The level ring lagged behind your voice** and froze mid-pulse when a take ended.
  *(Web, Windows.)*
- **The price was wrong, in Tiro's favour.** The quoted $0.0043/min is Deepgram's
  pre-recorded rate; streaming, which is the only transport a browser can use, is
  $0.0077/min. Both numbers are now quoted per platform, and the savings maths was redone
  against the real one. ([docs/RESEARCH.md](docs/RESEARCH.md) #2)
- **The download page advertised a version it did not link to.**

## [1.0.0] — 2026-08-15

The first release of this fork: upstream's macOS app, plus the two platforms it never
covered.

- **macOS** — [upstream's app](https://github.com/mypip-io/tiro) by Toby Stapleton,
  unchanged, built as a universal binary for Apple Silicon and Intel.
- **Windows** — full parity with the Mac: a global hotkey, dictation into any app, the key
  held by Windows itself (DPAPI), a tray icon and a recording pill. A WebView2 shell around
  the same web core, in a single self-contained EXE.
- **Web / iPhone / Android / Linux / ChromeOS** — a dictation scratchpad you can install to
  a home screen. Hold, speak, and the transcript is on your clipboard before you switch
  apps. It cannot type into other iPhone apps, and
  [says so](https://github.com/Gabriel-Dalton/tiro#about-this-fork) rather than pretending
  otherwise.
- **History and usage** on every platform, stored on your device, exported and imported as
  the same JSONL file so it moves between them.
- **No account, no server, no telemetry.** Your Deepgram key talks straight to Deepgram.

[Unreleased]: https://github.com/Gabriel-Dalton/tiro/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Gabriel-Dalton/tiro/releases/tag/v1.2.0
[1.1.0]: https://github.com/Gabriel-Dalton/tiro/releases/tag/v1.1.0
[1.0.1]: https://github.com/Gabriel-Dalton/tiro/releases/tag/v1.0.1
[1.0.0]: https://github.com/Gabriel-Dalton/tiro/releases/tag/v1.0.0
