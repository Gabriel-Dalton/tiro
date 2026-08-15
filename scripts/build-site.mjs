#!/usr/bin/env node
// Assemble the deployable site into public/:
//
//   /       the landing page (landing/)
//   /app/   the PWA (web/)
//
// One deployment serves both, so the download page and the web app share an
// origin and the landing page can link to /app with a relative URL.
//
// Generated files are rebuilt first, so a deploy can never ship a stale palette
// or icon set: shared/design-tokens.json is always the source of truth.

import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public");

for (const script of ["gen-tokens.mjs", "gen-icons.mjs"]) {
  execFileSync(process.execPath, [join(root, "scripts", script)], { stdio: "inherit" });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// landing page at the site root
cpSync(join(root, "landing"), out, { recursive: true });

// the PWA under /app — index.html, manifest, sw.js and every asset path in the
// web core is relative, so it works unchanged from a subdirectory
cpSync(join(root, "web"), join(out, "app"), { recursive: true });

// web/vercel.json only applies when web/ is deployed as its own project;
// the root vercel.json carries the headers for this combined deploy
const strayConfig = join(out, "app", "vercel.json");
if (existsSync(strayConfig)) rmSync(strayConfig);

console.log("built public/ — landing at /, PWA at /app/");
