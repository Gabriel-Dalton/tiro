#!/usr/bin/env node
// Turn the pending impact notes into a release, in the working tree:
//
//   node scripts/cut-release.mjs [--dry-run]
//
//   1. VERSION            <- the notes' highest bump applied to the current version
//   2. the stamped files  <- gen-version.mjs, so all five places agree
//   3. CHANGELOG.md       <- a dated section built from the notes, and its link refs
//   4. .changes/          <- the notes it just consumed are deleted
//
// It commits nothing and pushes nothing; the workflow does that, so the same script
// can be run locally to see exactly what a merge would produce. `--dry-run` prints
// the section and touches no files.
//
// Exits 1 when there is nothing to release, so the workflow can tell "no release"
// from "release failed" by the exit code rather than by parsing output.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readNotes, highestBump, nextVersion, platformTag, root } from "./changes.mjs";

const dryRun = process.argv.includes("--dry-run");

const notes = readNotes();
const bump = highestBump(notes);
if (!notes.length || bump === "none") {
  console.error("Nothing to release: no impact notes pending, or none of them move the version.");
  process.exit(1);
}

const current = readFileSync(join(root, "VERSION"), "utf8").trim();
const version = nextVersion(current, bump);
// UTC, so a release cut at 23:00 in one timezone and 01:00 in another does not get
// dated a day apart from the tag GitHub stamps.
const date = new Date().toISOString().slice(0, 10);

// --- the changelog section -------------------------------------------------
//
// Notes keep the order they were written in within each heading, which is the order
// they were merged. Nothing sorts them by importance: that would need a second
// judgement call per note, and the bump is the only one worth asking for.

const HEADINGS = [
  ["added", "Added"],
  ["changed", "Changed"],
  ["fixed", "Fixed"],
];

const entry = (n) => {
  const body = n.body.split("\n").map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`)).join("\n");
  return body + platformTag(n.platforms);
};

let section = `## [${version}] — ${date}\n`;
for (const [kind, heading] of HEADINGS) {
  const mine = notes.filter((n) => n.kind === kind);
  if (!mine.length) continue;
  section += `\n### ${heading}\n\n` + mine.map(entry).join("\n") + "\n";
}

if (dryRun) {
  console.log(`${current} -> ${version} (${bump}), from ${notes.length} note(s)\n`);
  console.log(section);
  process.exit(0);
}

// --- write it out ----------------------------------------------------------

writeFileSync(join(root, "VERSION"), version + "\n");

const changelogPath = join(root, "CHANGELOG.md");
let changelog = readFileSync(changelogPath, "utf8");

// After the Unreleased section, before the previous version. Anchored on the next
// version heading rather than on Unreleased's own body, so an Unreleased section
// someone has written into by hand is left alone rather than overwritten.
const firstVersion = changelog.search(/^## \[\d+\.\d+\.\d+\]/m);
if (firstVersion === -1) {
  console.error("CHANGELOG.md has no version sections, so there is nowhere to put this one.");
  process.exit(1);
}
changelog = changelog.slice(0, firstVersion) + section + "\n" + changelog.slice(firstVersion);

// The link references at the foot: a line for the new version, and Unreleased now
// compares against it. Without this the new heading is a dead link, which is the
// class of thing nobody notices until a reader clicks it.
changelog = changelog.replace(
  /^\[Unreleased\]:.*$/m,
  `[Unreleased]: https://github.com/mypip-io/tiro/compare/v${version}...HEAD\n` +
    `[${version}]: https://github.com/mypip-io/tiro/releases/tag/v${version}`
);

writeFileSync(changelogPath, changelog);

for (const note of notes) unlinkSync(join(root, note.file));

// Last, because it reads VERSION: the five stamped places now agree with the section.
execFileSync("node", [join(root, "scripts/gen-version.mjs")], { cwd: root, stdio: "inherit" });

console.log(`cut ${version} (${bump}) from ${notes.length} note(s), dated ${date}`);
