#!/usr/bin/env node
// design-tokens.json -> web/styles/tokens.css and web/src/tokens.js
// Run from anywhere: node scripts/gen-tokens.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "shared/design-tokens.json"), "utf8"));

const header = "/* GENERATED from shared/design-tokens.json. Do not edit by hand.\n * Regenerate with: node scripts/gen-tokens.mjs */\n";

// Documentation keys live alongside the tokens; they are not tokens.
const real = (obj) => Object.entries(obj).filter(([k]) => !k.startsWith("$"));

// A semantic value is either a raw CSS value or a {palette-token} reference.
const resolve = (v) => v.replace(/\{([a-z0-9-]+)\}/gi, (_, name) => `var(--${name})`);

let css = header + ":root {\n";
for (const [k, v] of real(tokens.color)) css += `  --${k}: ${v};\n`;
for (const [k, v] of real(tokens.font)) css += `  --font-${k}: ${v};\n`;
for (const [k, v] of real(tokens.radius)) css += `  --radius-${k}: ${v};\n`;
css += "\n  /* what each colour is for; the only names the UI should use */\n";
for (const [k, v] of real(tokens.semantic.light)) css += `  --${k}: ${resolve(v)};\n`;
css += "}\n";

// The same semantic names, repointed. Nothing else in the app knows the theme:
// this block is the whole of dark mode.
css += "\n@media (prefers-color-scheme: dark) {\n  :root {\n";
for (const [k, v] of real(tokens.semantic.dark)) css += `    --${k}: ${resolve(v)};\n`;
css += "  }\n}\n";

mkdirSync(join(root, "web/styles"), { recursive: true });
writeFileSync(join(root, "web/styles/tokens.css"), css);

// Behavioural constants as an ES module, so app code and the design file cannot drift.
const c = tokens.constants;
let js = "// GENERATED from shared/design-tokens.json. Do not edit by hand.\n";
js += "// Regenerate with: node scripts/gen-tokens.mjs\n\n";
js += `export const TAP_THRESHOLD_MS = ${c.tapThresholdSec * 1000};\n`;
js += `export const PRE_ROLL_SEC = ${c.preRollSec};\n`;
js += `export const TAIL_SEC = ${c.tailSec};\n`;
js += `export const TARGET_SAMPLE_RATE = ${c.sampleRate};\n`;
js += `export const STREAMING_PER_MIN = ${c.deepgramStreamingPerMin};\n`;
js += `export const KEEPALIVE_INTERVAL_MS = ${c.keepAliveIntervalSec * 1000};\n`;
js += `export const COMPETITORS = ${JSON.stringify(c.competitors, null, 2)};\n`;
js += `export const MARK = ${JSON.stringify(tokens.mark, null, 2)};\n`;

mkdirSync(join(root, "web/src"), { recursive: true });
writeFileSync(join(root, "web/src/tokens.js"), js);

console.log("wrote web/styles/tokens.css and web/src/tokens.js");
