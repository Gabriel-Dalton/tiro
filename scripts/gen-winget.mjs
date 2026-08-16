#!/usr/bin/env node
// packaging/winget/*.yaml templates -> a submittable winget-pkgs manifest folder.
//
//   node scripts/gen-winget.mjs --tag v1.2.0 \
//     --x64 dist/Tiro-Windows-x64.zip --arm64 dist/Tiro-Windows-arm64.zip \
//     --out dist/winget
//
// The hashes come from the ZIPs themselves rather than from anything a human
// typed, because a wrong InstallerSha256 is the single most common way a winget
// submission fails, and it fails at install time, on someone else's machine.
//
// Output lands in the layout winget-pkgs expects, so submitting is: copy the
// manifests/ tree into a clone of microsoft/winget-pkgs and open a PR.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}

const tag = args.get("tag");
if (!tag || !/^v\d+\.\d+\.\d+/.test(tag)) {
  console.error("--tag is required and must look like v1.2.0 (got: " + tag + ")");
  process.exit(1);
}
// winget wants a bare version; the tag keeps its v because it is a URL component.
const version = tag.replace(/^v/, "");
const out = args.get("out") || join(root, "dist/winget");

const sha256 = (path) => {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
  } catch (err) {
    console.error(`Cannot hash ${path}: ${err.message}`);
    process.exit(1);
  }
};

const x64 = args.get("x64") || join(root, "dist/Tiro-Windows-x64.zip");
const arm64 = args.get("arm64") || join(root, "dist/Tiro-Windows-arm64.zip");

const fills = {
  __VERSION__: version,
  __TAG__: tag,
  // Whoever runs the release decides the date; ISO because that is what the schema takes.
  __RELEASE_DATE__: args.get("date") || new Date().toISOString().slice(0, 10),
  __SHA256_X64__: sha256(x64),
  __SHA256_ARM64__: sha256(arm64),
};

// manifests/<first letter, lowercased>/<Publisher>/<Package>/<Version>/
const pkgDir = join(out, "manifests", "g", "GabrielDalton", "Tiro", version);
mkdirSync(pkgDir, { recursive: true });

const files = [
  "GabrielDalton.Tiro.yaml",
  "GabrielDalton.Tiro.installer.yaml",
  "GabrielDalton.Tiro.locale.en-US.yaml",
];

for (const name of files) {
  let text = readFileSync(join(root, "packaging/winget", name), "utf8");
  // Strip the template banner; it is guidance for this repo, not for winget-pkgs.
  text = text.replace(/^#\n# TEMPLATE\.[\s\S]*?\n(?=[A-Z])/m, "");
  for (const [token, value] of Object.entries(fills)) text = text.split(token).join(value);

  const missing = text.match(/__[A-Z0-9_]+__/g);
  if (missing) {
    console.error(`${name} still has unfilled placeholders: ${[...new Set(missing)].join(", ")}`);
    process.exit(1);
  }

  // winget-pkgs requires UTF-8, and UTF-8 *with BOM* once a file leaves ASCII.
  // The em dashes in these comments are exactly that case, and the validation
  // failure it causes reads as an unrelated encoding error.
  const bom = /[^\x00-\x7F]/.test(text) ? "﻿" : "";
  writeFileSync(join(pkgDir, name), bom + text, "utf8");
  console.log(`wrote ${join(pkgDir, name)}${bom ? " (UTF-8 BOM)" : ""}`);
}

console.log(`\nGabrielDalton.Tiro ${version}`);
console.log(`  x64   ${fills.__SHA256_X64__}`);
console.log(`  arm64 ${fills.__SHA256_ARM64__}`);
