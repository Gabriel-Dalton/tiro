#!/usr/bin/env node
// What version the pending notes add up to. Prints nothing and exits 1 when they
// add up to no release at all, so a workflow can branch on it:
//
//   VERSION=$(node scripts/next-version.mjs) || echo "nothing to release"
//
// Kept separate from cut-release.mjs so the answer can be asked for without
// anything being written, which is what the release workflow does before deciding
// whether there is a release to build.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readNotes, highestBump, nextVersion, root } from "./changes.mjs";

const notes = readNotes();
const bump = highestBump(notes);

if (!notes.length || bump === "none") process.exit(1);

const current = readFileSync(join(root, "VERSION"), "utf8").trim();
process.stdout.write(nextVersion(current, bump) + "\n");
