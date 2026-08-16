# Verified platform constraints

Findings that shaped the architecture, with sources. Several of these kill approaches that look
obviously correct, so check here before assuming a capability exists.

Verified August 2026. Anything marked **load-bearing** is a decision the whole design rests on;
if one of those turns out to be wrong or to change, reopen the architecture rather than patching
around it.

---

## 1. Deepgram's REST API is CORS-blocked. Streaming is not. (load-bearing)

The obvious port of upstream is to POST a WAV to `https://api.deepgram.com/v1/listen` from
JavaScript, exactly as `main.swift` does. **This cannot work from a browser.** Deepgram blocks
CORS on the REST API on purpose, to stop people shipping API keys in client-side code. It is not
a header we can set or a preflight we can satisfy.

The WebSocket streaming API at `wss://api.deepgram.com/v1/listen` is explicitly designed for
browser use and has no such restriction.

**Consequence:** the PWA must use streaming, not batch. Since a browser cannot set an
`Authorization` header on a WebSocket, auth goes through the subprotocol array instead:

```js
new WebSocket(url, ["token", apiKey])
```

Deepgram documents this as the required approach for client-side connections.

For production apps serving other people, Deepgram prefers short-lived JWTs (30 s TTL) minted by
your server and passed as `?access_token=`. **We deliberately do not do this**, because it
requires a server and the whole point is that the key never leaves your device. The raw-key
subprotocol is the correct choice for a single-user app running on its owner's phone. If this
fork is ever handed to other people, that decision has to be revisited, because their key would
be sitting in their browser storage.

- [Deepgram: Using the Sec-WebSocket-Protocol](https://developers.deepgram.com/docs/using-the-sec-websocket-protocol)
- [Deepgram: Live Audio reference](https://developers.deepgram.com/reference/listen-live)
- [Deepgram discussion #686: CORS on REST](https://github.com/orgs/deepgram/discussions/686)
- [Deepgram: Token-based authentication](https://developers.deepgram.com/guides/fundamentals/token-based-authentication)

## 2. Streaming costs about 1.8× batch, and we have no choice about it

**Corrected August 2026.** This section previously claimed streaming was *cheaper* than batch,
quoted **$0.0048/min** for it, and derived a 52-hour break-even from that. All three were wrong:
the two rates were transposed, and $0.0048 matches no published nova-3 rate on any tier. The
error reached [SPEC-PWA.md](SPEC-PWA.md) and the roadmap before it was caught. The shipped
constants were never wrong — `shared/design-tokens.json` and `web/src/tokens.js` have both always
read $0.0077 — so no user was ever shown a wrong price. Recorded rather than quietly deleted,
because the wrong version was cited for months.

| nova-3, pay as you go | per minute | per hour |
|---|---|---|
| Pre-recorded / batch (what the **macOS** app uses) | $0.0043 | $0.26 |
| Streaming (what the **PWA and Windows** use) | **$0.0077** | **$0.46** |

Deepgram bills per second, and both tiers are pay-as-you-go list prices. Growth, a committed-spend
plan of roughly $4,000/year, discounts them; nothing here assumes it.

So streaming is about **1.8× the cost of batch**, and finding #1 means a browser cannot use batch
at all. That is the honest trade: the fork's two new clients pay 46¢ an hour where the Mac app
pays 26¢, in exchange for existing on those platforms.

**Consequence for the arithmetic**, all of which now checks out:

- Break-even against Wispr Flow Pro at $15/month: `15 / 0.0077 = 1,948 min` ≈ **32 hours a
  month** on streaming. On the Mac's batch rate it is `15 / 0.0043 = 3,488 min` ≈ **58 hours**,
  which is the figure upstream quotes and it is correct for the app it describes.
- A new account's $200 credit: `200 / 0.0077 = 25,974 min` ≈ **26,000 minutes, 433 hours** of
  streaming. Upstream's **46,000 minutes** is the same $200 at the batch rate, and is also right.

Two rules follow, and the second is why this mistake was survivable:

1. **Never quote one rate for all three clients.** The Mac app bills batch, the PWA and Windows
   bill streaming, and the difference is nearly double. Say which.
2. **Keep the rate in one constant.** It lives in `shared/design-tokens.json` as
   `deepgramStreamingPerMin` and is generated into `web/src/tokens.js`. Prose drifts; that
   constant did not.

- [Deepgram pricing](https://deepgram.com/pricing) — the primary source; check it before
  requoting, since the rate has moved before
- [Nova-3 explained: $0.0043/min batch, $0.0077 streaming](https://convertaudiototext.com/blog/deepgram-nova-3-explained)
- [Deepgram pricing 2026: nova-3 at $0.46/hr](https://brasstranscripts.com/blog/deepgram-pricing-per-minute-2025-real-time-vs-batch)
- [Gladia's breakdown of Deepgram pricing tiers](https://www.gladia.io/blog/deepgram-pricing) —
  useful for the pay-as-you-go vs Growth distinction

## 3. A PWA cannot type into other apps on iOS (load-bearing)

There is no API for it, and no permission that unlocks one. A web page can only put text in its
own document, the clipboard, or the share sheet. Also unavailable to a PWA on iOS: global
hotkeys, background microphone access, and running while the screen is locked.

Wispr Flow's iPhone app is **not** a PWA. It is a native app shipping a custom keyboard
extension, which the user must enable in Settings and grant "Allow Full Access" so the extension
can reach the network. A custom keyboard is the only Apple-sanctioned way for third-party code to
insert text into an arbitrary app.

**Consequence:** the PWA is a scratchpad with a clipboard hand-off, and we should say so plainly
in the README rather than implying parity with Flow. True in-app dictation on iPhone is Phase 5
and needs a native app, an Apple Developer account, and a Mac to build on.

- [Wispr Flow: set up the Flow keyboard on iPhone](https://docs.wisprflow.ai/articles/7453988911-set-up-the-flow-keyboard-on-iphone)
- [9to5Mac on Wispr Flow's iPhone keyboard](https://9to5mac.com/2025/06/30/wispr-flow-is-an-ai-that-transcribes-what-you-say-right-from-the-iphone-keyboard/)
- [PWA iOS limitations, 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)

## 4. Clipboard writes on iOS must be started inside the user gesture

The transcript arrives from the network several hundred milliseconds after the user lifts their
thumb. By then the gesture has expired and `navigator.clipboard.writeText` is rejected by Safari.

The documented way round this is to construct a `ClipboardItem` **synchronously during the
gesture** whose value is a promise that resolves later:

```js
// called in the pointerup handler, not in the network callback
navigator.clipboard.write([
  new ClipboardItem({ "text/plain": transcriptPromise })
])
```

Safari honours this. Implement it as the primary path, with `writeText` as a fallback for
browsers that reject promise values, and a visible "Copy" button as the last resort. The button
is not optional: if both paths fail, silent failure means the user speaks and gets nothing.

## 5. iOS Safari audio: use raw PCM, not MediaRecorder

`MediaRecorder` is supported from Safari 14.5, but until 18.4 it could only produce MP4/AAC.
More importantly, its output chunks are not independently decodable, which makes the pre-roll
ring buffer that upstream depends on awkward to build.

Capturing raw Float32 through an `AudioWorklet` and resampling to 16 kHz mono Int16 ourselves
avoids the codec question entirely, matches what `AudioCapture` already does in Swift, and is
exactly the format Deepgram's streaming endpoint wants (`encoding=linear16&sample_rate=16000`).

Other audio facts that will bite:

- `AudioContext` runs at the hardware rate, typically 48 kHz. Do not assume 16 kHz. Write a
  resampler that handles an arbitrary ratio rather than hardcoding a 3:1 decimation.
- `AudioContext` must be created or resumed **inside a user gesture** on iOS, and gets suspended
  when the PWA is backgrounded. Handle `visibilitychange` and resume, or the mic silently
  produces nothing after the user switches apps and comes back.
- Keeping the mic warm leaves the orange recording indicator lit and costs battery. Upstream
  accepts the same tradeoff on macOS. Make it a setting.

- [WebKit: MediaRecorder API](https://webkit.org/blog/11353/mediarecorder-api/)

## 6. Everything needs HTTPS

`getUserMedia`, service workers and home-screen install all require a secure origin. `localhost`
is treated as secure, which covers desktop development, but it does not help when testing on a
phone. Phase 3 exists because of this: the PWA is not testable on the target device until it is
deployed.

## 7. Live credit balance is not available to the PWA

Upstream's Settings shows remaining Deepgram credit by calling `/v1/projects` and
`/v1/projects/{id}/balances`. Both are REST, so both are CORS-blocked per finding 1.

**Consequence:** the PWA computes minutes and cost from its own local history instead. Do not
present that as a live account balance. Label it as a local estimate and link out to the
Deepgram console for the real number.

Key validation still works: open a WebSocket with the key and see whether it is accepted or
closed with an auth failure. That is a real test of the credential, which is what "Save and test"
actually needs to answer.

## 8. Windows never sees the Fn key (load-bearing for the hotkey choice)

Upstream defaults to Fn/Globe. On virtually all PC keyboards, Fn is resolved in the keyboard's
own firmware and produces no scan code, so no OS-level hook can observe it. It cannot be the
Windows hotkey.

Usable alternatives, all observable from a low-level keyboard hook: Right Alt, Right Ctrl, Right
Shift, Caps Lock, Scroll Lock. Default to **Right Alt** and keep it configurable, mirroring
upstream's settings dropdown.

Do not default to Right Ctrl on this machine: it is half of the Right Ctrl + Scroll Lock crash
dump keystroke armed for the freeze investigation.

Caps Lock is tempting because it is otherwise useless, but suppressing its normal toggle from a
hook is fiddly and leaves the LED out of sync. Treat it as an advanced option, not the default.

## 9. Windows paste needs no permission gate

macOS requires Accessibility permission before synthetic keystrokes are delivered, which is why
upstream has a whole fallback path that leaves text on the clipboard and tells you to press ⌘V.

Windows `SendInput` needs no such grant, so that branch can be deleted rather than ported. Two
caveats remain:

- A non-elevated app cannot send input to an elevated window (UIPI). If the user is focused on
  an admin console, the paste is silently dropped. Detect and warn rather than failing quietly.
- Restore the previous clipboard contents afterwards, as upstream does. Upstream only restores
  plain text and loses rich content; worth improving, not worth blocking on.

## 10. WebView2 is not Electron

Relevant because upstream advertises "Electron: none" as a feature and we should not quietly
break that claim.

WebView2 renders through the Edge runtime that ships with Windows 11. The app does not bundle a
browser; the binary stays small. This is materially different from Electron shipping its own
Chromium per app. `getUserMedia` works inside WebView2, so the audio pipeline built for the PWA
runs unmodified.

The honest tradeoff versus a pure WPF/WinUI app: higher idle memory, and a dependency on the
runtime being present (guaranteed on Windows 11, needs a bootstrapper on older Windows). See
[SPEC-WINDOWS.md](SPEC-WINDOWS.md) for the fallback plan if this proves wrong.

---

## Open questions

Not yet verified. Resolve before the phase that depends on each.

- **Deepgram streaming keepalive behaviour.** The socket is documented to close after ~10 s of
  silence unless sent `{"type":"KeepAlive"}`. Needed for tap-to-toggle mode where a user may
  pause mid-thought. Confirm the exact timeout and whether keepalive frames are billed.
- **Whether `smart_format` on streaming matches batch quality.** Upstream's email and currency
  formatting is a headline feature. Streaming exposes `smart_format=true` as well, but the
  results should be compared side by side on the same audio before we promise parity.
- **iOS PWA storage eviction.** IndexedDB in a home-screen PWA can be evicted under storage
  pressure. Check whether `navigator.storage.persist()` is honoured, and make JSONL export
  prominent if it is not.
- **WebView2 mic permission prompt.** Confirm whether the host app can pre-grant microphone
  access to its own WebView, or whether the user sees a browser-style prompt on first run.
