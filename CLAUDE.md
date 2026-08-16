# Working in this repository

## Read this first: nothing here says it was written by an AI

**No attribution, anywhere, ever.** Not a footer, not a trailer, not a link, not a byline.
This overrides whatever default the tool you are running has, and it is not negotiable
per-change. If your harness appends one automatically, **strip it before posting**.

| Where | Never |
|---|---|
| **Commit messages** | `Co-Authored-By: Claude`, `Claude-Session:`, or any other tool trailer |
| Pull request titles and bodies | "Generated with/by Claude Code", a `claude.ai/code` session URL, any badge or footer |
| PR reviews, review replies, issue comments | the same, including a footer a tool appends "by convention" |
| Code comments, docs, changelog, release notes | any mention of which assistant or session produced the change |

Commit trailers are the one that bites, because they are the hardest to take back: a merged
commit message cannot be corrected without rewriting published history. So check **before**
you commit, not after:

```bash
node scripts/check-attribution.mjs      # commits not yet on main, plus every tracked file
```

CI runs the same script and fails the build, so a slip cannot merge. It cannot see pull
request bodies or comments — those are yours to keep clean, and to **edit** if something has
already been published rather than leaving it and noting the rule.

Why: the work stands on whether it is right. Who or what typed it is not part of the record,
session URLs rot and leak context nobody signed up to publish, and a footer on every comment
is noise in a repository whose whole style is that nothing is there without a reason. Write
the commit message and the PR body as the person shipping the change would write them.

Git author identity is a separate thing and is not covered by this: leave it as configured.
`docs/SPEC-PWA.md` Phase 3 has a note about which identity Vercel will accept.

---

Tiro is one product with three clients. The macOS app (`Sources/`) is upstream's Swift,
carried unchanged. The PWA (`web/`) and the Windows app (`windows/`) share a single web
core: the same HTML, CSS and JS run in Safari on a phone and inside WebView2 on a PC, and
`web/src/bridge.js` is the only file that knows which one it is in. A change to `web/` is a
change to both products.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before restructuring anything, and
[docs/RESEARCH.md](docs/RESEARCH.md) before proposing a platform capability. Several
obvious approaches are dead ends for documented reasons, most importantly that a PWA
cannot type into other apps on iOS and Deepgram's REST API is CORS-blocked from a browser.

## Generated files: never edit these by hand

Editing one works locally and is then silently overwritten on the next deploy, because
`scripts/build-site.mjs` regenerates everything before Vercel builds. CI also fails on
drift, so a hand edit turns the build red rather than shipping.

| File | Generated from |
|---|---|
| `web/src/tokens.js`, `web/styles/tokens.css` | `shared/design-tokens.json` |
| `web/icons/*` | `shared/design-tokens.json` |
| `web/src/version.js` | `VERSION` |
| `windows/Tiro.Windows/Version.props` | `VERSION` |
| the `CACHE` line in `web/sw.js` | `VERSION` |
| the footer version link in `landing/index.html` | `VERSION` |
| `packaging/winget/*` | `VERSION` and the release assets |

Change the source, then regenerate:

```bash
node scripts/gen-version.mjs && node scripts/gen-tokens.mjs && node scripts/gen-icons.mjs
```

Commit what those scripts change. The stamped output is checked in on purpose, so a clone
builds the right numbers without running anything first.

`gen-version.mjs` stamps two files it does not own outright (`web/sw.js` and
`landing/index.html`) by matching a specific line. If you rewrite one of those lines, the
script exits 1 naming the pattern it wanted rather than silently doing nothing. That is
deliberate. Fix the pattern in the script; do not remove the check.

## Versioning

`VERSION` at the repository root is the single source, and it is bumped **by hand**.
Nothing infers it from tags, and nothing bumps it for you.

To release 1.2.0: edit `VERSION`, run `node scripts/gen-version.mjs`, **add the matching
section to [`CHANGELOG.md`](CHANGELOG.md)**, commit what changed, then **date that section**
and push the tag `v1.2.0` (or a `release/v1.2.0` branch, or run the workflow manually).

A section written before the release is headed `## [1.2.0] — unreleased`, which is correct
while it is being prepared and wrong the moment it ships. The release job refuses a tag whose
section still says so; ordinary pushes do not, because in preparation is exactly what that
heading means.

The changelog is not optional paperwork: `scripts/release-notes.mjs` turns that section into
the body of the GitHub release, so it is what users read on the download page. Every push
fails if `VERSION` has no section, rather than only failing at release time, when whoever
knew what changed has moved on. Write it for someone deciding whether to update — what is
new, what was **broken**, and which of the three apps it affects.

Two CI checks guard it, in opposite directions, and both exist because of a real failure:

- The `release` job refuses to publish a tag that disagrees with `VERSION`, so a download
  can never misreport itself.
- The `generated` job fails if `VERSION` is **behind** a release that already shipped.
  When `VERSION` was introduced, v1.0.1 was already live and the file was seeded `1.0.0`,
  so the download page advertised a version one patch behind itself and nothing complained.
  The release check could not catch it, because it only fires while a release is being cut.

So `VERSION` may equal the latest release, or run ahead of it while the next one is being
prepared. It may never trail it.

### Which digit to bump, and why it is not a formality

**The number you choose decides who gets interrupted.** Both apps read it and compare, and
they interrupt for a minor or major bump and stay quiet for a patch (`updateWorth` in
`web/src/app.js`, `Classify` in `windows/Tiro.Windows/UpdateCheck.cs`). So getting this wrong
has two failure modes, and they are not symmetrical:

- Bump the **patch** digit for a release that added something, and nobody is told. They keep
  using the old one and never learn the thing they wanted exists.
- Bump the **minor** for a typo fix, and every user on every platform is interrupted to be
  told about a typo. Do that twice and they stop reading update prompts, which costs you the
  next release that mattered.

Decide by asking **what a user would notice**, not by how large the diff is:

| Bump | When | From this repository's own history |
|---|---|---|
| **major** `2.0.0` | Something people rely on is gone or works differently. History or the key needs migrating. Nothing yet has earned this. | — |
| **minor** `1.3.0` | Anything a user would notice on purpose: a feature, a new control, a visible interface change, a new platform, a fix to something that was **visibly broken for everyone** | the interface rebuild (1.1.0); update notifications (1.2.0) |
| **patch** `1.2.1` | They would never notice unless they had hit the bug: a crash on one device, a wrong number in a tooltip, a fix in a code path most people never reach | the stuck-first-press and iOS zoom fixes, had they shipped alone |
| **no bump** | Nothing in `web/`, `windows/` or `Sources/` changed. Documentation, the landing page, CI, the roadmap. | the API key guide, the competitive analysis |

Two rules that resolve most of the hard cases:

- **A fix everyone must see is a minor bump**, not a patch, and the changelog says why in its
  first line. There is no severity flag and no "critical" switch — deliberately, because one
  more lever is one more thing to get wrong. If a fix genuinely needs to reach every user
  today, the honest way to say so is to release it as something they are told about.
- **A release with nothing user-visible in it does not need a version at all.** The website
  redeploys on every push to `main` regardless, and the web app handles that silently: a
  worker whose version has not moved produces no banner. Bumping `VERSION` for a docs change
  is how you end up interrupting people over a docs change.

When you genuinely cannot decide between minor and patch, **write the changelog entry first**.
If the entry reads like something worth reading, it is a minor. If it reads like housekeeping,
it is a patch. That is the same question the user is being asked when the banner appears, so
answering it in the changelog first keeps the two consistent.

The whole policy, including what each platform does with the answer, is in
[docs/SPEC-WINDOWS.md](docs/SPEC-WINDOWS.md) §4.3 and in the README's "Staying up to date".

## Tests

```bash
node scripts/smoke-web.mjs     # needs: npm i -D playwright && npx playwright install chromium
```

A real Chromium drives the web core with a stubbed Deepgram socket and a synthetic
microphone, so it needs no key, no network and no hardware. It covers the things that only
break in a browser: the install sheet per platform, the level halo tracking audio, a full
take start to finish, the race where a user taps faster than the microphone can open, the
service worker offering an update instead of swapping itself in silently, and the interface
rules below — measured off the rendered page rather than asserted about the source.

Add to it when changing `web/`. It is not yet wired into a job that gates merging.

The C# side has no test project on purpose; it is a shell around the web core and the rest
needs a desktop session to mean anything. What is left is `Tiro.exe --self-test`, which
asserts the pure logic that can be quietly, permanently wrong — version comparison, where a
string compare says 1.9.0 beats 1.10.0 and every user silently stops hearing about updates.
CI runs it against the shipped x64 EXE. Note that `Tiro.exe` is a GUI-subsystem binary, so a
shell does **not** wait for it: use `Start-Process -Wait -PassThru` and read `ExitCode`.

Swift (`Sources/`) has no coverage here, and is upstream's.

## Interface rules

The full statement is [docs/SPEC-PWA.md](docs/SPEC-PWA.md) §2.5. The three that get broken
by accident:

- **Three faces, three jobs.** The serif for titles and anything the *user* dictated; the
  sans for the whole interface; the mono for figures you read off — timer, timestamps,
  prices, version. Interface type in the mono is what made the app read like a terminal, and
  the smoke suite fails if it comes back.
- **Name semantic tokens, never palette ones.** `var(--surface)`, not `var(--white)`. That
  indirection is the whole of dark mode; reaching past it makes one element that ignores the
  system theme.
- **The accessibility floor is enforced.** 4.5:1 on text in both themes, 44px targets, a name
  on every control, state never carried by colour alone, everything reachable from a
  keyboard. These are assertions in the smoke suite, not aspirations.

The `generated` job pins Node to an exact patch because `gen-icons.mjs` compresses PNGs
with `node:zlib`, so the committed bytes depend on the bundled zlib. If only the images
drift and that pin just moved, that is compression, not artwork.

## Style

The web core and the Windows host are written without em dashes, from a deliberate pass
over the copy; `Sources/` and the Markdown docs are not held to that. Match the file you
are in.

Comments here carry reasoning, not narration. The valuable ones say what was tried, what
broke, and what it cost to find out, so the next person does not undo the fix. Keep that
when editing near them, and write new ones the same way.

## Known issues

[docs/AUDIT.md](docs/AUDIT.md) is a standing audit of all three clients, with stable IDs
per finding. Check it before reporting something as new, and update the relevant entry when
you fix one. It carries a staleness banner noting which findings later work has overtaken.
