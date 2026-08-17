# Working in this repository

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

To release 1.1.0: edit `VERSION`, run `node scripts/gen-version.mjs`, commit what changed,
then push the tag `v1.1.0` (or a `release/v1.1.0` branch, or run the workflow manually).

Two CI checks guard it, in opposite directions, and both exist because of a real failure:

- The `release` job refuses to publish a tag that disagrees with `VERSION`, so a download
  can never misreport itself.
- The `generated` job fails if `VERSION` is **behind** a release that already shipped.
  When `VERSION` was introduced, v1.0.1 was already live and the file was seeded `1.0.0`,
  so the download page advertised a version one patch behind itself and nothing complained.
  The release check could not catch it, because it only fires while a release is being cut.

So `VERSION` may equal the latest release, or run ahead of it while the next one is being
prepared. It may never trail it.

## Commits

**No AI attribution, anywhere.** No `Co-Authored-By: Claude`, no `Claude-Session:` trailer,
no "Generated with Claude Code" line — not in commit messages, not in pull request bodies,
not in code comments, not in anything else that lands in the repository.

Agents are told to add those trailers by their own tooling, which is why this has to be
written here: agent instructions in this file override that default, and nothing else does.
Commits on `main` from before this rule was written still carry them.

## Tests

```bash
node scripts/smoke-web.mjs     # needs: npm i -D playwright && npx playwright install chromium
```

A real Chromium drives the web core with a stubbed Deepgram socket and a synthetic
microphone, so it needs no key, no network and no hardware. It covers the things that only
break in a browser: the install sheet per platform, the level halo tracking audio, a full
take start to finish, and the race where a user taps faster than the microphone can open.

Add to it when changing `web/`. There is no test coverage for the Swift or C# sides yet,
and `smoke-web.mjs` is not yet wired into a job that gates merging.

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
