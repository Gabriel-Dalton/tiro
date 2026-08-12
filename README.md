<div align="center">

<img src="docs/icon.png" width="112" alt="Tiro icon">

# Tiro

**Hold a key. Speak. Your words land in whatever box your cursor is in.**

Native macOS dictation powered by [Deepgram](https://deepgram.com) — the accuracy of a
$15/month dictation subscription, at about **$0.0043 per minute**, in an app you own.

![macOS 13+](https://img.shields.io/badge/macOS-13%2B-black) ![Swift](https://img.shields.io/badge/Swift-5.9-F05138) ![License: MIT](https://img.shields.io/badge/License-MIT-green) ![No Electron](https://img.shields.io/badge/Electron-none-blue)

<img src="docs/history.png" width="640" alt="Tiro history window">

</div>

---

## Why

Voice dictation on the Mac is a solved problem with an unsolved price. The good tools are
subscriptions: Wispr Flow Pro is $15/mo, Aqua Voice $8, superwhisper $8.49. But the speech
engine underneath this whole category costs fractions of a cent per minute if you call it
directly.

Tiro is that direct call, wrapped in the UX you actually want:

| | monthly cost at 1 h of dictation | at 10 h |
|---|---|---|
| **Tiro** (Deepgram nova-3, pay-as-you-go) | **~$0.26** | **~$2.58** |
| Wispr Flow Pro | $15.00 | $15.00 |
| superwhisper Pro | $8.49 | $8.49 |
| Aqua Voice Pro | $8.00 | $8.00 |

A new Deepgram account includes **$200 of free credit** — roughly **46,000 minutes** of
dictation before you pay anything at all. Tiro's Settings page shows your live usage, real
cost, and what you're saving. *(Prices as of Aug 2026.)*

## What it does

- **Hold Fn to talk** — release, and the transcript pastes at your cursor. Any app, any text box.
- **Tap Fn to go hands-free** — speak as long as you like, tap again to stop and insert.
- **Nothing gets clipped** — the mic stays warm with a rolling pre-roll buffer, so words spoken
  the instant you press (or just before) are captured, plus a half-second tail after release.
- **Smart formatting** — punctuation, capitalization, numbers ("$1,234.56"), emails
  ("toby at example dot com" → `toby@example.com`) come out right. Just speak naturally.
- **History** — every transcript saved locally, searchable, grouped by day, one-click copy.
- **Usage & savings** — live Deepgram credit balance, cost this month, and the comparison chart.
- **Configurable hotkey** — Fn/Globe, Right ⌥, Right ⌘, or Right ⌃.
- **Native** — one small Swift app. No Electron, no login, no telemetry, no subscription.

<div align="center">
<img src="docs/settings.png" width="420" alt="Tiro settings"> <img src="docs/setup.png" width="420" alt="Tiro first-run setup">
</div>

## Install

Requires macOS 13+ and the Xcode command-line tools (`xcode-select --install`).

```bash
git clone https://github.com/mypip-io/tiro.git
cd tiro
./make-app.sh
open Tiro.app
```

That's it — `make-app.sh` builds the Swift package and assembles a signed `Tiro.app`
(uses your Apple Development certificate if you have one, ad-hoc otherwise). Move it to
`/Applications` if you want it permanent, and add it to Login Items to start on boot.

### First run — three things, then you can talk

Tiro walks you through these in a setup window:

1. **Deepgram API key** — sign up free at [console.deepgram.com](https://console.deepgram.com)
   (no card needed, $200 credit included), create an API key, paste it into Tiro's Settings.
   "Save & test" validates it against the API and shows your credit balance.
2. **Microphone** — allow the standard macOS prompt.
3. **Accessibility** — System Settings → Privacy & Security → Accessibility → enable Tiro,
   then relaunch. This is what lets Tiro see the hotkey from any app and paste for you.
   (Until granted, transcripts land on your clipboard instead and Tiro tells you to ⌘V.)

One macOS quirk: set **System Settings → Keyboard → "Press 🌐 key to" → Do Nothing**, or
macOS opens the emoji picker every time you dictate. Tiro's Settings page has a button that
takes you straight there.

## How it works

About 2,000 lines of Swift, no dependencies:

- A global event monitor watches your chosen hotkey (modifier keys don't require the
  key-logging entitlement — Tiro never sees your keystrokes).
- `AVAudioEngine` runs continuously with a ~0.7 s rolling pre-roll buffer; pressing the
  hotkey adopts that buffer, so speech onset is never lost. Audio is 16 kHz mono WAV.
- On release (+0.5 s tail), the take is POSTed to Deepgram's
  [`nova-3`](https://developers.deepgram.com/docs/models-languages-overview) prerecorded
  endpoint with `smart_format=true`. Billed by the second.
- The transcript is placed on the pasteboard, a synthetic ⌘V is sent to the frontmost app,
  and your previous clipboard text is restored half a second later.
- History is a plain JSONL file at `~/Library/Application Support/Tiro/history.jsonl`.
  Your API key lives in `~/.tiro` (chmod 600) or `$DEEPGRAM_API_KEY`.

**Privacy:** audio leaves your machine only while you're dictating, and only to Deepgram.
Nothing else is sent anywhere. There is no analytics, no account, no server of ours.

## CLI

The same binary is a small test harness:

```bash
swift run -c release tiro --selftest file.m4a   # transcribe a file, print the result
swift run -c release tiro --record 5            # record 5s through the real mic pipeline
swift run -c release tiro --paste "hello"       # test the insertion path
```

## The name

Marcus Tullius **Tiro** was Cicero's secretary. To keep up with dictation he invented
Tironian notes — the first shorthand system, built to capture speech at the speed it was
spoken. His symbol for "and" (⁊) is still used in Irish and Scots Gaelic two thousand
years later, and it's the mark in Tiro's icon.

## License

[MIT](LICENSE). Fees you pay Deepgram are between you and Deepgram; watch your usage in
Settings.

---

## From the same desk

Tiro is a side project from building **[MyPip](https://mypip.io)**. You build. MyPip finds
who's ready to buy, every morning.

If Tiro saved you a subscription, come say hi:

- **[mypip.io](https://mypip.io)** — who your next customers are, and the way in
- **[Toby on LinkedIn](https://www.linkedin.com/in/tobystapleton95)** — Tiro's author
- **[Elfin Growth on Substack](https://elfingrowth.substack.com)** — essays on finding your first customers

