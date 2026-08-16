#!/usr/bin/env node
// Nothing in this repository says it was written by an AI. CLAUDE.md states the
// rule; this is what makes it true, because a rule that only lives in a document
// is one every fresh session gets to rediscover after it has already published a
// footer somebody has to go back and edit out.
//
//   node scripts/check-attribution.mjs                 # working tree + commits vs main
//   node scripts/check-attribution.mjs <base>..<head>  # an explicit commit range
//
// Exits 1 listing what it found, so CI goes red before a merge rather than after
// a reviewer notices. Commit messages cannot be fixed after a merge without
// rewriting published history, which is exactly why this fires early.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const range = process.argv[2] || null;

// Trailers and footers are anchored to the start of a line, because that is the
// only place they ever really appear: a git trailer is line-initial by
// definition, and a footer sits on its own line under a rule. Matching them
// anywhere would fail this file, the commit that added it, and any future commit
// message that has to *name* what it is removing — a check that punishes you for
// explaining yourself is a check people delete.
//
// Links are matched anywhere, because a session URL has no innocent reading.
const MARKERS = [
  { name: "a Co-Authored-By trailer naming an assistant", re: /^\s*co-authored-by:\s*claude/im },
  { name: "a session trailer", re: /^\s*claude-session\s*:/im },
  { name: "a 'Generated with/by' footer", re: /^\s*(?:[_*>-]|🤖)?\s*generated (with|by) \[?claude/im },
  { name: "a session link", re: /claude\.ai\/code\/session/i },
  { name: "a claude.com/claude-code badge", re: /claude\.com\/claude-code/i },
];

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const problems = [];

// --- commit messages -------------------------------------------------------
//
// The range is whatever is being proposed: on a pull request that is the commits
// not yet on the base branch. Everything already merged is history, and history
// is not this check's business — it cannot be fixed without a force push.
let commits = [];
try {
  const spec = range || (() => {
    const base = git("merge-base", "origin/main", "HEAD").trim();
    return `${base}..HEAD`;
  })();
  commits = git("log", "--format=%H", spec).trim().split("\n").filter(Boolean);
  // On a push to main the merge base *is* HEAD, so the range is empty and this
  // would pass without reading anything. The commit that lands there is the one
  // GitHub writes at merge time, which never existed on the branch and is
  // therefore the only message no branch build ever checked.
  if (!commits.length && !range) {
    commits = git("log", "--format=%H", "-1", "HEAD").trim().split("\n").filter(Boolean);
  }
} catch {
  console.log("No commit range to check (no origin/main here); checking the tree only.");
}

for (const sha of commits) {
  const message = git("log", "-1", "--format=%B", sha);
  for (const { name, re } of MARKERS) {
    if (re.test(message)) {
      const subject = git("log", "-1", "--format=%s", sha).trim();
      problems.push(`commit ${sha.slice(0, 8)} (${subject}) carries ${name}`);
    }
  }
}

// --- the tree itself -------------------------------------------------------
//
// Docs, code comments, workflow files: anywhere a footer could be pasted. This
// script is skipped because it has to name the things it forbids.
const tracked = git("ls-files").trim().split("\n").filter(Boolean);
const SKIP = new Set(["scripts/check-attribution.mjs", "CLAUDE.md"]);
const BINARY = /\.(png|ico|icns|jpg|jpeg|gif|zip|pdf|woff2?)$/i;

for (const file of tracked) {
  if (SKIP.has(file) || BINARY.test(file) || !existsSync(join(root, file))) continue;
  let text;
  try { text = readFileSync(join(root, file), "utf8"); } catch { continue; }
  for (const { name, re } of MARKERS) {
    if (re.test(text)) {
      // `re` is anchored with /m for whole-file text; test line by line so the
      // number reported is the offending line rather than always the first.
      const single = new RegExp(re.source, re.flags.replace("m", ""));
      const line = text.split("\n").findIndex((l) => single.test(l)) + 1;
      problems.push(`${file}:${line} contains ${name}`);
    }
  }
}

if (problems.length) {
  console.error("This repository carries no AI attribution. Found:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nSee CLAUDE.md, 'Attribution: this repository carries none'." +
      "\nCommit messages: rewrite them before merging (git rebase -i / git commit --amend)." +
      "\nPull request bodies and comments are not visible here — check those by hand."
  );
  process.exit(1);
}

console.log(`No attribution found in ${commits.length} commit(s) and ${tracked.length} tracked file(s).`);
