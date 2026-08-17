#!/usr/bin/env node
// Two questions, both asked on every push:
//
//   1. Is every note in `.changes/` well formed?
//   2. Did this branch change something a user runs without saying what they would
//      notice?
//
//   node scripts/check-changes.mjs                 # against origin/main
//   node scripts/check-changes.mjs <base>..<head>  # an explicit range
//
// The second question is the one with teeth. Releases are cut automatically from
// these notes with no human checkpoint, so a change that arrives without one is not
// "missing paperwork" — it is a change that ships to everybody having never been
// classified by anyone. The build fails rather than guessing, because both guesses
// are bad: assume `patch` and features go out silently, assume `minor` and typo
// fixes interrupt every user on every platform.

import { execFileSync } from "node:child_process";
import { readNotes, highestBump, root } from "./changes.mjs";

const range = process.argv[2] || null;
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

// --- 1. are the notes well formed? -----------------------------------------

let notes;
try {
  notes = readNotes();
} catch (err) {
  console.error(`${err.message}\n`);
  process.exit(1);
}

// --- 2. did this branch change something without saying so? ----------------
//
// Anything a user runs. The landing page and the docs are deliberately not here:
// a website change deploys on merge and reaches everyone immediately, so there is
// no version for it to move and nobody to interrupt about it.
const PRODUCT = ["web/", "windows/", "Sources/"];

// Written by gen-version.mjs and gen-tokens.mjs rather than by a person. They change
// as a *consequence* of a release, so requiring a note for them would mean every
// release commit demanded a note about itself.
const GENERATED = [
  "web/src/version.js",
  "web/src/tokens.js",
  "web/styles/tokens.css",
  "windows/Tiro.Windows/Version.props",
];
const isGenerated = (f) => GENERATED.includes(f) || f.startsWith("web/icons/");

let base = null;
try {
  base = range ? range.split("..")[0] : git("merge-base", "origin/main", "HEAD").trim();
} catch {
  console.log("No origin/main here, so there is nothing to compare against; notes checked only.");
}

const head = range ? range.split("..")[1] || "HEAD" : "HEAD";

// Committed and uncommitted alike, on both sides of the question. CI only ever sees
// committed work, so this changes nothing there — but locally, a check that answers
// about a different set of files than the one in front of you is a check people learn
// to ignore, whichever way it is wrong: silent while you are editing, then red the
// moment you commit.
const workingTree = () =>
  git("status", "--porcelain")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    // a rename shows as "old -> new"; the new path is the one that exists
    .map((f) => (f.includes(" -> ") ? f.split(" -> ")[1] : f));

if (base) {
  const changed = [
    ...git("diff", "--name-only", `${base}..${head}`).trim().split("\n").filter(Boolean),
    ...workingTree(),
  ];

  // A release commit deletes the notes it consumed and rewrites the files they were
  // about. Asking it for a note would be asking it to explain the release to itself.
  const consumedNotes = git("diff", "--name-only", "--diff-filter=D", `${base}..${head}`, "--", ".changes/")
    .trim()
    .split("\n")
    .filter(Boolean);

  const touched = changed.filter((f) => PRODUCT.some((p) => f.startsWith(p)) && !isGenerated(f));
  const isNote = (f) => f.endsWith(".md") && !f.endsWith("README.md");

  const committed = git("diff", "--name-only", "--diff-filter=A", `${base}..${head}`, "--", ".changes/")
    .trim()
    .split("\n")
    .filter(isNote);

  const added = [...new Set([...committed, ...workingTree().filter(isNote)])];

  if (touched.length && !added.length && !consumedNotes.length) {
    console.error(
      "This branch changes something people run, and says nothing about what they would notice:\n"
    );
    for (const f of touched.slice(0, 12)) console.error(`  - ${f}`);
    if (touched.length > 12) console.error(`  ...and ${touched.length - 12} more`);
    console.error(
      "\nAdd a note in .changes/ saying what changed and how much of an interruption it is worth:\n" +
        "\n  .changes/what-you-did.md" +
        "\n  ---" +
        "\n  bump: minor          # minor: they would notice on purpose, or it was visibly broken" +
        "\n                       # patch: they would never notice unless they hit the bug" +
        "\n                       # none:  nothing a user could notice at all" +
        "\n  platforms: web, windows" +
        "\n  ---" +
        "\n  One or two sentences, written for someone deciding whether to update." +
        "\n\nReleases are cut from these with no further review, so this note is the last" +
        "\nthing read before every user is interrupted, or deliberately not. The full rule," +
        "\nincluding why a fix everyone must see is a minor rather than a patch, is in" +
        "\n.changes/README.md."
    );
    process.exit(1);
  }
}

// --- what the notes add up to ----------------------------------------------

if (!notes.length) {
  console.log("No impact notes pending, so merging this releases nothing.");
} else {
  const bump = highestBump(notes);
  console.log(`${notes.length} impact note(s) pending, adding up to a ${bump} release:`);
  for (const n of notes) console.log(`  ${n.bump.padEnd(5)} ${n.file}`);
  if (bump === "none") console.log("\nNothing user-visible, so no version will be cut.");
}
