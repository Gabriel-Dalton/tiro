// Reading and validating the impact notes in `.changes/`.
//
// Shared by check-changes.mjs (does this branch have one, and is it well formed),
// next-version.mjs (what version do they add up to) and cut-release.mjs (turn them
// into a changelog section). One parser, so the thing CI validates is exactly the
// thing the release is built from.
//
// The format is deliberately smaller than YAML: two known keys, no nesting, no
// quoting rules. A note is read by a person in a pull request diff seconds before it
// decides whether every user is interrupted, so it has to be legible at a glance,
// and a format with no corners has no corners to be wrong in.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CHANGES_DIR = join(root, ".changes");

/** Ordered weakest to strongest: index doubles as the comparison. */
export const BUMPS = ["none", "patch", "minor", "major"];
export const PLATFORMS = ["web", "windows", "macos", "site", "none"];

// Which changelog heading the entry lands under. Optional, and purely presentational:
// unlike `bump` it decides nothing about who is interrupted, which is why it is safe to
// have as a second knob. It exists because the obvious default is wrong in one common
// case — a fix everyone must see is a `minor`, and filing that under "Added" tells the
// reader it is a new feature when the whole point is that something was broken.
export const KINDS = ["added", "changed", "fixed"];
const DEFAULT_KIND = { major: "changed", minor: "added", patch: "fixed", none: "fixed" };

/** How a platform is written in a changelog entry. */
const PLATFORM_LABEL = { web: "Web", windows: "Windows", macos: "macOS", site: "Website" };

/**
 * Parse one note. Returns `{ bump, platforms, body }`, or throws with a message
 * naming the file and what was wrong with it — these are read by whoever is about
 * to have their build fail, so they say what to do rather than what happened.
 */
export function parseNote(file, text) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n").trim() + "\n");
  if (!match) {
    throw new Error(
      `${file} has no --- header. It should start:\n\n` +
        `---\nbump: minor\nplatforms: web, windows\n---\nWhat a user would notice.\n`
    );
  }
  const [, header, body] = match;

  const fields = {};
  for (const line of header.split("\n")) {
    if (!line.trim()) continue;
    const kv = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (!kv) throw new Error(`${file}: "${line.trim()}" is not "key: value"`);
    fields[kv[1]] = kv[2].trim();
  }

  const bump = fields.bump;
  if (!BUMPS.includes(bump)) {
    throw new Error(
      `${file}: bump is "${bump ?? "missing"}", which is not one of ${BUMPS.join(", ")}.\n` +
        `  See .changes/README.md for which one this change is.`
    );
  }

  const platforms = (fields.platforms ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (!platforms.length) throw new Error(`${file}: platforms is missing (e.g. "platforms: web, windows")`);
  for (const p of platforms) {
    if (!PLATFORMS.includes(p)) {
      throw new Error(`${file}: "${p}" is not a platform. Use ${PLATFORMS.join(", ")}.`);
    }
  }
  if (platforms.includes("none") && bump !== "none") {
    throw new Error(`${file}: platforms "none" only makes sense with bump "none".`);
  }

  const summary = body.trim();
  // A note with no body produces a release note with no body, and the release page is
  // where people decide whether to update. Length floor rather than mere presence,
  // because "fixes" satisfies "non-empty" and tells a reader nothing.
  if (bump !== "none" && summary.length < 20) {
    throw new Error(
      `${file}: the body is what users read on the download page, and this one is too ` +
        `short to be that.\n  Say what changed, and which app it affects.`
    );
  }

  const kind = fields.kind ?? DEFAULT_KIND[bump];
  if (!KINDS.includes(kind)) {
    throw new Error(`${file}: kind is "${kind}", which is not one of ${KINDS.join(", ")}.`);
  }

  return { file, bump, kind, platforms, body: summary };
}

/** Every note in `.changes/`, oldest name first. Throws on the first bad one. */
export function readNotes() {
  if (!existsSync(CHANGES_DIR)) return [];
  return readdirSync(CHANGES_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => parseNote(`.changes/${f}`, readFileSync(join(CHANGES_DIR, f), "utf8")));
}

/** The strongest bump among the notes, because one noticeable thing makes the release noticeable. */
export function highestBump(notes) {
  return notes.reduce((worst, n) => (BUMPS.indexOf(n.bump) > BUMPS.indexOf(worst) ? n.bump : worst), "none");
}

/**
 * Field-by-field as numbers, never as strings — a string compare puts 1.9.0 above
 * 1.10.0, and the whole release system reads as working while nobody is ever told
 * about an update again.
 */
export function nextVersion(current, bump) {
  const parts = current.trim().split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`VERSION is "${current}", which is not three numbers like 1.2.0`);
  }
  const [major, minor, patch] = parts;
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return current;
}

/** "*(Web, Windows.)*", or "" when the note is not about a particular app. */
export function platformTag(platforms) {
  const named = platforms.filter((p) => p !== "none").map((p) => PLATFORM_LABEL[p]);
  return named.length ? ` *(${named.join(", ")}.)*` : "";
}
