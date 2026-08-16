#!/usr/bin/env node
// VERSION -> everywhere a build has to say which version it is.
// Run from anywhere: node scripts/gen-version.mjs
//
//   web/src/version.js                  the About card in the app
//   web/sw.js                           cache name, so an upgrade drops the old shell
//   windows/Tiro.Windows/Version.props  file and product version on Tiro.exe
//   landing/index.html                  footer, so the download page names what it links to
//
// Bump VERSION, run this, commit. The stamped files are checked in, so a clone
// builds the right numbers without having to run anything first.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(join(root, "VERSION"), "utf8").trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`VERSION is "${version}", which is not three numbers like 1.2.0`);
  process.exit(1);
}

// --- fully generated files -------------------------------------------------

mkdirSync(join(root, "web/src"), { recursive: true });
writeFileSync(
  join(root, "web/src/version.js"),
  "// GENERATED from VERSION at the repository root. Do not edit by hand.\n" +
    "// Regenerate with: node scripts/gen-version.mjs\n\n" +
    `export const VERSION = "${version}";\n`
);

writeFileSync(
  join(root, "windows/Tiro.Windows/Version.props"),
  "<!-- GENERATED from VERSION at the repository root. Do not edit by hand.\n" +
    "     Regenerate with: node scripts/gen-version.mjs -->\n" +
    "<Project>\n" +
    "  <PropertyGroup>\n" +
    `    <Version>${version}</Version>\n` +
    "  </PropertyGroup>\n" +
    "</Project>\n"
);

// --- files that are hand-written apart from one stamped line ---------------

// A missing anchor means someone rewrote the line and the version quietly
// stopped being stamped, so treat it as a failure rather than a silent no-op.
function stamp(file, pattern, replacement) {
  const path = join(root, file);
  const before = readFileSync(path, "utf8");
  if (!pattern.test(before)) {
    console.error(`${file} has no line matching ${pattern}, so the version cannot be stamped`);
    process.exit(1);
  }
  const after = before.replace(pattern, replacement);
  if (after !== before) writeFileSync(path, after);
}

stamp("web/sw.js", /const CACHE = "tiro-[^"]*";/, `const CACHE = "tiro-${version}";`);
stamp("landing/index.html", /(<span class="version">)[^<]*(<\/span>)/, `$1v${version}$2`);

console.log(`stamped ${version} into the web app, service worker, Windows build and landing page`);
