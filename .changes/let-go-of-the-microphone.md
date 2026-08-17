---
bump: minor
platforms: web, windows
kind: fixed
---
**Tiro lets go of your microphone again.** It used to hold it open from the first time you
pressed the hotkey until you quit the app, which on Windows is worse than it sounds: while
anything is holding the microphone, Windows keeps Bluetooth headphones in call mode, so music,
videos and everything else drop to phone-call quality. Dictate one sentence, go back to what you
were watching, and it sounded broken. The microphone indicator stayed lit the whole time too,
next to an app whose window is hidden by design, which is not a reassuring combination.

The microphone is now released 45 seconds after you stop dictating, so two sentences in a row
still get the head start that keeps your first word, and anything longer than a pause gives the
device back. Turning **Keep the mic warm between takes** off in Settings releases it the moment a
take ends, as it always should have; that setting now says what it actually costs.

A take that could not reach Deepgram — a captive portal, a rejected key — used to keep the
microphone open even with that setting off. It does not any more.
