# What Wispr Flow users say, and what Tiro should do about it

Wispr Flow is the product Tiro is measured against — it is the $15/month line in the README's
pricing table, and it is the app that solved the iPhone problem we deferred. This is a survey of
what its users praise, what they complain about, and what it still does not do, read for one
purpose: deciding what belongs on Tiro's roadmap.

Surveyed August 2026. Findings that turn into work are tracked as **Phase 6** in
[ROADMAP.md](../ROADMAP.md); this file is the reasoning behind them.

## Read the sources with suspicion

There is a cottage industry of "Wispr Flow alternative" SEO. Voibe, Spokenly, MetaWhisp,
LumeVoice, Weesper, Parakeety, DictaFlow, ModelPiper, VocAI, EmberType and WillowVoice all rank
for Wispr Flow criticism and all sell a competing dictation app. Their factual claims about
features and pricing are usually right, because those are checkable. Their benchmarks are not
trustworthy — "Wispr Flow gets ~90% accuracy at 700 ms, we get 98% at 200 ms" is a number a
vendor produced about a rival, with no published method.

So this file grades its own claims:

- **Confirmed** — Wispr Flow's own documentation, or corroborated by several unrelated parties.
- **Reported** — consistent across sources but every source has an interest. Directionally
  useful, not quotable.
- **Unverified** — single-source or vendor-benchmark. Recorded so nobody re-researches it, not
  relied on.

Direct fetching of Product Hunt, Trustpilot, Reddit and Hacker News is blocked from this
environment's egress proxy, so review-aggregate figures below are second-hand and marked
accordingly. If any of this starts driving a big decision, read the primary sources first.

---

## 1. What people like

Worth knowing precisely, because these are the reasons someone pays $15/month rather than
running something like Tiro, and three of them are cheap for us to match.

**Speak-naturally formatting.** The single most praised thing. No "comma", no "new paragraph" —
you talk, and punctuation, capitalisation and paragraph breaks come out right. *(Confirmed.)*
Tiro already has this: `smart_format=true` on nova-3 is the same class of feature, and it is on
by default in every client.

**The personal dictionary.** Users teach it names, jargon, product names and acronyms, and it
stops mangling them. Repeatedly cited as the thing that turns dictation from a toy into a work
tool. It bulk-imports up to 1,000 entries and syncs across their apps. *(Confirmed — their
docs.)* **Tiro has nothing equivalent, and this is the largest genuine capability gap.**

**Snippets and voice shortcuts.** Say a trigger phrase, get a block of canned text. *(Confirmed
— their docs.)* Tiro has nothing equivalent.

**Multilingual, without switching modes.** Reply to Slack in English, then message your mother
in Spanish, no settings change. Consistently the feature that makes bilingual users loyal.
*(Confirmed.)* Tiro sends no `language` parameter at all — `web/src/deepgram.js` hardcodes the
query string — so we are implicitly English-only and cannot even be configured otherwise.

**Command mode, whisper mode, course correction.** Speak an instruction rather than text; dictate
quietly; correct yourself mid-sentence and have the earlier words fixed. *(Reported.)* These are
LLM-layer features and mostly sit on the wrong side of our non-goals.

**Accessibility.** Users who cannot comfortably type say it makes writing possible. *(Reported.)*
This one deserves stating plainly: it is also the strongest argument for Tiro's price. A tool
someone depends on to write at all should not be a subscription they can lose.

## 2. What people complain about

**The screenshot incident.** The most damaging item by a distance. In May 2026 a user posting
network traces showed the desktop app periodically capturing the active window and uploading the
image to cloud servers, as part of its context-awareness feature, without clear prior disclosure.
Wispr initially banned the user who raised it. The CTO later apologised publicly, the account was
restored, the privacy policy was rewritten and training-data use became opt-in — but the
screenshot architecture itself was not removed. *(Confirmed as an event across many unrelated
write-ups; the current state of the architecture is Reported.)*

This is Tiro's strongest positioning, and it is worth being precise rather than smug about it:
Tiro sends **audio, only while you are holding the key, only to Deepgram**. No screen capture, no
account, no server of ours. That is not a feature we would have to build — it is the shape the
app already has.

**Cloud-only, no offline mode.** Unusable on a plane, in a secure facility, or on bad rural
signal. Persistently the top feature request. *(Confirmed.)* Tiro does not fix this — we are also
cloud, by design (`docs/RESEARCH.md`, and "no local model" is an explicit non-goal). We should
not pretend otherwise in marketing. What we *can* do is fail well when the network is gone, which
today means an error message.

**Reliability degrading after the trial.** The most common organic complaint: works beautifully
for 14 days, then users report inconsistency, slower renders and worse accuracy. Whether that is
real, load-related, or the trial ending a honeymoon, it is what people say. *(Reported.)*

**The AI changes what you said.** Hallucinated sentences, and "corrections" that rewrite
deliberately casual phrasing into something more formal, changing the meaning. Wispr's own help
centre acknowledges experimentation surfacing edge cases. *(Confirmed that it happens; frequency
is Reported.)*

This is a real philosophical fork, and Tiro is already on the other side of it: we run **no LLM
pass over your transcript**. What Deepgram heard is what you get. That is a weaker product on
polish and a stronger one on trust, and we should say so out loud rather than leaving it as an
unstated consequence of not having built the feature.

**Resource use and system behaviour.** ~800 MB RAM and ~8% CPU while idle on Windows, freezing
target apps like VS Code during dictation, and adding itself to system startup without being
asked. *(Unverified numbers, Reported behaviour.)* Tiro is 2,000 lines of Swift on the Mac and a
WinForms host around WebView2 on Windows, and writes its autostart key when you tick the box.

**Windows is the weaker platform.** Dictation interrupted after sleep, "connection lost" during
system slowdowns, freezes on quit. Several are fixed in their changelog, which is itself evidence
the platform gets a rougher ride. *(Confirmed — their own help centre.)* Tiro's Windows app is
first-class by construction: it is the same web core the PWA runs.

**Price and the free tier.** $15/month, and a free plan of 2,000 words/week on desktop — about
13 minutes of speech, gone in two days for a daily user — with dictation simply stopping until
the weekly reset. Refunds "only where required by law". *(Confirmed.)* A G2 rating around 4.5/5
against a Trustpilot rating around 2.7/5 is the usual signature of a product people like using
and dislike being billed by. *(Reported; the Trustpilot sample looked small.)*

## 3. What Wispr Flow does not have

Gaps, rather than grievances. Some of these Tiro already fills without advertising it.

| Gap | Confidence | Where Tiro stands |
|---|---|---|
| No Linux app | Confirmed (an unofficial community port exists) | The PWA covers Linux today. Already true, never said out loud. |
| No iPad app | Confirmed | The PWA installs on iPad, and the install walkthrough already draws iPad's toolbar separately. |
| No file transcription — you cannot hand it an existing recording | Reported | The Mac CLI already does this (`--selftest file.m4a`). The web core does not, and could. |
| Cloud-only, no on-device option | Confirmed | Same limitation. Not a differentiator. |
| No bring-your-own API key | Confirmed | This *is* Tiro's entire architecture. |
| Canadian English absent on mobile, and off by default on desktop | Reported / Confirmed first-hand | See below. |

## 4. The Canadian question

Proposed as a unique selling point: Wispr Flow is American, so ship the Canadian dictation app.

**The premise is half wrong, and the half that survives is the more interesting half.**

Wispr Flow already ships **English – Canadian** on Mac and Windows, as one of a three-way
mutually exclusive group with English and English – British. *(Reported, from their multilingual
help page; direct fetch was blocked, so confirm before this appears in any marketing copy.)* So
"we do Canadian and they don't" is not a claim we can make, and we should not make it.

Four narrower things do hold up, and the first is the best of them:

1. **It is off by default, and Canadians never find it.** Dictating "colour" into Wispr Flow in
   Canada returns the American spelling. *(Confirmed first-hand, August 2026.)* This matches
   something in their own help centre: onboarding auto-selects English – British for users in the
   UK, Australia, New Zealand, Ireland and South Africa — and **Canada is not on that list**.
   Canadians are silently defaulted to American and have to know the setting exists to fix it.

   A feature that exists but never switches itself on is, for almost every user, the same as a
   feature that does not exist — and arguably worse, because the product looks like it simply
   cannot do it. This is the actual opening. It is not "build Canadian dictation", it is
   **default it correctly and make it visible**, which is a design decision rather than a
   capability, and therefore cheap.

2. **They do not offer Canadian on the phone at all.** iOS and Android reportedly get English and
   English – British only. A New Brunswick lawyer dictating on a phone cannot get Canadian
   spelling even by digging through settings. Tiro's mobile story is the PWA, so this is a gap we
   could actually stand in.

3. **Their language variants are mutually exclusive.** A bilingual Canadian — Montréal, Ottawa,
   Moncton — has to pick one and change settings to switch. Deepgram's nova-3 multilingual does
   English↔French code-switching **within a single stream**, which is exactly the shape of the
   problem and something we would get essentially for free by passing a different `language`
   value.

4. **Canadian is not a dialect flag, it is a ruleset.** This is the load-bearing point. Canadian
   orthography is *neither* American nor British: it takes British `-our` and `-re` (colour,
   centre, defence, cheque, kilometre) but American `-ize` (organize, recognize), while keeping
   `tire` and `aluminum` over `tyre` and `aluminium`. Setting a dialect to `en-GB` gets roughly
   half of that wrong, in the direction that looks *most* obviously foreign to a Canadian reader.
   And "Canadian" in practice is as much about format as spelling: postal codes (`K1A 0B1`),
   provinces and territories, GST/HST/QST, SIN, and French place names inside English sentences
   (Montréal, Trois-Rivières, Québec City).

There is also an architectural reason to prefer the ruleset over the dialect flag: **a speech
model's language setting is an unreliable way to get orthography**, we have not confirmed that
Deepgram supports `en-CA` on nova-3 at all (regional English variants existed on older models;
nova-3's English coverage needs checking), and anything we ask the API for is a round trip we
cannot audit. A deterministic post-processing pass over the final transcript, running locally, is
zero-cost, zero-latency, offline-safe, identical across all three clients, and inspectable in the
repo. It also happens to be the thing an LLM-based competitor is *structurally* worst at
promising, because they cannot tell you what their model will do to your sentence.

The trust angle is worth one careful sentence, and no more than one. A Canadian in law, health or
the public sector has PIPEDA and, in Quebec, Law 25 to think about, and an app that uploads
periodic screenshots of the active window is a much harder conversation with a privacy officer
than one that streams audio to a single named processor. That is a *smaller disclosure surface*,
not a compliance claim — Deepgram is still a US processor, and we should never imply otherwise.

## 5. What this turns into

Ranked by (value to a Wispr Flow defector) ÷ (cost, given the architecture we already have).
These are specified as Phase 6 in [ROADMAP.md](../ROADMAP.md).

| # | Item | Answers | Cost |
|---|---|---|---|
| 6.1 | Custom dictionary via Deepgram keyterms | Their most-praised utility feature; our biggest gap | Small — a settings list and a query parameter |
| 6.2 | Text replacements, applied locally | Snippets; and the mechanism 6.3 needs | Small — pure string work |
| 6.3 | Canadian English pass, **on by default in Canada** | Their Canadian setting exists but never switches itself on | Small, on top of 6.2 |
| 6.4 | Language selection, including bilingual | Their loyalty feature; we cannot even be configured | Small — one query parameter |
| 6.5 | Fix the last take without re-dictating | Their trust problem, from the honest direction | Medium |
| 6.6 | Transcribe an existing recording | Something they cannot do at all | Medium |

Two things deliberately **not** on that list:

- **An LLM polish pass** (their tone/command modes). It is the source of their worst complaint,
  it needs a second paid API, and "the transcript is what was heard" is a position worth keeping.
- **Offline transcription.** Explicitly a non-goal, and Deepgram is the fork's whole value
  proposition. The right response to the complaint is to fail gracefully offline, not to ship a
  local model.

And three findings that are **marketing, not engineering** — all already true of Tiro, none
currently said anywhere on the landing page: no screen capture, no LLM rewriting your words, and
Linux and iPad both covered by the PWA.

## 6. The selling points, and which ones we can make today

Split by whether the claim is true **now**. A landing page may only carry the first list. The
second is a roadmap, and putting any of it in the shipping chart before it lands would be a lie
that a reader can catch in about thirty seconds.

### Live — true of Tiro today, and now on the landing page

Ordered by how hard they are for Wispr Flow to answer, not by how loud they sound.

1. **You own the key, so you pay cost.** 46¢ an hour against $15 a month. Not a discount, a
   different business model: they resell Deepgram-class inference with a margin, we hand you the
   API. They cannot match this without unbuilding the company.
2. **No account.** Nothing to sign into, nothing to cancel, nothing to lose access to.
3. **Nothing reads your screen.** Audio, only while the key is held, only to Deepgram. Their
   context-awareness feature captures the active window by design, and that is the single most
   damaging thing attached to their name.
4. **No model rewrites your words.** The transcript is what Deepgram heard. Their AI cleanup is
   their most-cited accuracy complaint — it is a feature that makes the product worse for anyone
   who meant what they said.
5. **MIT, all of it.** Every claim above is checkable in the repo, which is the only reason
   anyone should believe claims 2 to 4.
6. **A free tier that is actually free.** $200 of Deepgram credit is around 430 hours. Their free
   plan is 2,000 words a week — about thirteen minutes, and dictation stops when you hit it.
7. **Linux and iPad.** They ship neither. We already have both through the PWA and had never
   mentioned it.
8. **It is a small app.** 2,000 lines of Swift on the Mac; a WinForms host around WebView2 on
   Windows; no Electron. Their resource use is a recurring complaint, though the specific numbers
   circulating are vendor-authored and we should not quote them.

Two rows on the chart are ones we **lose**, and they stay there: dictating straight into another
iPhone app needs a native keyboard extension (Phase 5, deferred), and neither product works
offline. A comparison table with no losing rows is an advertisement, and readers grade it as one.

### Not yet — do not put these on the landing page

- **Canadian English, on by default.** The strongest one we do not have. Phase 6.3. When it
  lands, the chart gets a row reading roughly "Canadian spelling — On by default in Canada /
  Available, but off unless you find the setting", which is defensible because their onboarding
  demonstrably does not select it for Canadians. Not before.
- **A custom dictionary.** Phase 6.1. Today this is a row we would lose, which is why the chart
  does not have one.
- **Snippets and replacements.** Phase 6.2.
- **Bilingual English/French in one stream.** Phase 6.4, and the sharpest Canadian angle after
  6.3.
- **Transcribing a recording you already have.** Phase 6.6. Something they cannot do at all, so
  it is worth a row the day it works.

### Claims to keep away from

Not because they are necessarily false — because we cannot stand them up, and a comparison chart
survives on being unfalsifiable in every row:

- **Accuracy or latency numbers.** Every figure in circulation was published by someone selling a
  rival. We have run no benchmark. Say nothing.
- **Their RAM and CPU use.** Same problem. "No Electron" is our claim and is checkable; "they use
  800 MB" is theirs to answer.
- **Anything about their current data handling beyond what they document.** The May 2026 incident
  is a matter of record and their CTO's apology is public, but whether the architecture changed
  afterwards is contested. Describe what Tiro does; let the reader draw it.
- **"We're Canadian."** A statement about who makes the software, not what it does, and nothing
  in this repo establishes it. The defensible version is Canadian *output*, which is 6.3.
- **PIPEDA or Law 25 compliance.** A smaller disclosure surface is true and useful to say.
  Compliance is a claim about a deployment, and Deepgram is still a US processor.

---

## Sources

Wispr Flow's own material, treated as authoritative for what the product does:

- [Use Flow with multiple languages](https://docs.wisprflow.ai/articles/3191899797-use-flow-with-multiple-languages)
- [Teach Flow your words with the dictionary](https://docs.wisprflow.ai/articles/4052411709-teach-flow-your-words-with-the-dictionary)
- [Bulk import for dictionary and snippets](https://docs.wisprflow.ai/articles/8955301725-how-do-i-bulk-import-for-dictionary-and-snippets)
- [Why transcription quality fluctuates](https://wisprflow.ai/post/transcription-quality)
- [Transcription suddenly got worse](https://docs.wisprflow.ai/articles/6901148133-transcription-suddenly-got-worse-or-feels-less-accurate)
- [Billing and plans](https://docs.wisprflow.ai/collections/9999370675-billing_plans)
- [Wispr Flow on Wikipedia](https://en.wikipedia.org/wiki/Wispr_Flow)

Independent commentary:

- [Jimmy Song: WisprFlow Is Overrated](https://jimmysong.io/blog/uninstalling-wisperflow/)
- [Zack Proser: Wispr Flow review, daily-use test](https://zackproser.com/blog/wisprflow-review)
- [Product Hunt reviews](https://www.producthunt.com/products/wisprflow/reviews)
- [Trustpilot](https://www.trustpilot.com/review/wisprflow.ai)
- [Efficient App: pros, cons, verdict](https://efficient.app/apps/wispr-flow)

On the privacy incident, read several — each has an angle:

- [KINTAL: what Wispr Flow actually does](https://www.kintal.co/insights/what-wispr-flow-actually-does)
- [ModelPiper: what happened, what changed](https://modelpiper.com/blog/wispr-flow-privacy-incident)
- [EmberType: the day they banned a user](https://embertype.com/blog/the-day-wispr-flow-banned-a-user/)

Deepgram capability, for the items above that depend on it:

- [Keyterm prompting](https://developers.deepgram.com/docs/keyterm)
- [Models and languages overview](https://developers.deepgram.com/docs/models-languages-overview)
- [Multilingual code-switching](https://developers.deepgram.com/docs/multilingual-code-switching)
- [Nova-3 multilingual keyterm prompting](https://deepgram.com/learn/deepgram-expands-nova-3-with-10-new-languages-and-multilingual-keyterm-prompting)

Vendor-authored comparisons, listed so nobody mistakes them for independent later: Voibe,
Spokenly, MetaWhisp, LumeVoice, Weesper Neon Flow, Parakeety, DictaFlow, VocAI, WillowVoice,
OpenWhispr, eesel.
