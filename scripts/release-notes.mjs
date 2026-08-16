#!/usr/bin/env node
// CHANGELOG.md -> the body of a GitHub release.
//
//   node scripts/release-notes.mjs --tag v1.1.0 [--out notes.md] [--releasing]
//
// The release job runs this and hands the result to the release as its body, so
// the notes people read on the download page and the notes in the repository
// cannot say different things. Two halves:
//
//   1. What changed in this version, lifted verbatim from CHANGELOG.md.
//   2. The evergreen half — which file to download, and the first-run friction
//      on each platform — which is the same every time and lives here.
//
// It exits non-zero when CHANGELOG.md has no section for the version being
// released. That is deliberate: a release with no notes is the failure this
// whole file exists to prevent, and it should stop the release rather than
// publish a blank one.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

const tag = argOf("--tag");
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error(`--tag is required and must look like v1.2.0 (got ${tag ?? "nothing"})`);
  process.exit(1);
}
const version = tag.slice(1);

/** The body of one `## [x.y.z]` section, up to the next version heading. */
export function sectionFor(changelog, wanted) {
  const lines = changelog.split("\n");
  const isVersionHeading = (line) => /^## \[/.test(line);
  const start = lines.findIndex(
    (line) => isVersionHeading(line) && line.includes(`[${wanted}]`)
  );
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isVersionHeading(lines[i])) { end = i; break; }
    // the link-reference block at the foot of the file ends the last section
    if (/^\[[^\]]+\]:\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const body = sectionFor(changelog, version);

// A section written ahead of the release says "unreleased" in its heading,
// which is correct right up until the moment it is not. Nothing else would
// catch it: the heading is supplied by the release page and never appears in
// these notes, so the wrong date would sit in the repository at the tagged
// commit with nobody the wiser.
// Only when a release is actually being cut. Every push runs this script too,
// to prove the section exists at all, and a section marked unreleased is exactly
// what a version in preparation is supposed to look like.
const heading = changelog.split("\n").find((l) => l.startsWith(`## [${version}]`)) || "";
if (args.includes("--releasing") && /unreleased/i.test(heading)) {
  console.error(
    `CHANGELOG.md still calls ${version} unreleased:\n  ${heading}\n\n` +
      `Give it the release date before tagging.`
  );
  process.exit(1);
}

if (!body) {
  console.error(
    `CHANGELOG.md has no "## [${version}]" section, so ${tag} has nothing to say for itself.\n` +
      `Add one before releasing: it is what the release notes are made of.`
  );
  process.exit(1);
}

// Headings drop one level: the changelog's "### Added" sits under a version
// heading that the release page supplies as its title.
const shifted = body.replace(/^### /gm, "## ");

const evergreen = `
---

## Downloads

| Download | For |
|---|---|
| \`Tiro-Windows-x64.zip\` | Windows 10 and 11 on any Intel or AMD PC. Unzip and run \`Tiro.exe\`. It lives in the tray; hold **Right Alt** in any app to dictate. |
| \`Tiro-Windows-arm64.zip\` | Windows 11 on ARM: Snapdragon and Surface. The x64 build also runs there under emulation; this one is native. |
| \`Tiro-macOS.zip\` | macOS 13+, **universal**, so the same file runs on Apple Silicon and Intel. Move \`Tiro.app\` to Applications and hold **Fn**. |

Linux, ChromeOS, Android and anything older: open \`/app/\` on the site. The web app needs no
download and installs to a home screen. Not sure which one? The
[download page](https://github.com/Gabriel-Dalton/tiro#getting-the-apps) picks it for you.

## Upgrading

Windows and macOS are portable apps: replace the old one with this one. **Your API key,
history and settings are stored by the operating system, not inside the app, so they survive
the swap.** On Windows, \`winget upgrade GabrielDalton.Tiro\` does it for you once the package
is listed. The web app updates itself and offers you **Update** when a new version is ready.

## First run

- **Windows 10** also needs Microsoft's free
  [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/), which Windows 11
  already includes. Tiro checks on first run and offers it rather than failing silently.
- If **SmartScreen** stops the app, unblock the ZIP *before* extracting it: right-click →
  Properties → tick **Unblock** → OK. Or from the dialog, **More info → Run anyway**.
- On **macOS**, the first launch needs System Settings → Privacy & Security → **Open Anyway**;
  on macOS 14 and earlier, right-click the app and choose **Open**.
- Tiro asks for a **Deepgram API key**, free at [console.deepgram.com](https://console.deepgram.com)
  and stored on your device only. New accounts include $200 of credit, around 430 hours.
  [Step by step, with pictures](https://github.com/Gabriel-Dalton/tiro/blob/main/docs/API-KEY.md).

Full history: [CHANGELOG.md](https://github.com/Gabriel-Dalton/tiro/blob/main/CHANGELOG.md).
`;

const notes = `${shifted}\n${evergreen}`;
const out = argOf("--out");
if (out) {
  writeFileSync(out, notes);
  console.log(`wrote ${out} from the CHANGELOG section for ${version}`);
} else {
  process.stdout.write(notes);
}
