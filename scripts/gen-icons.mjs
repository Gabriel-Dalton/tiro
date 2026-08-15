#!/usr/bin/env node
// Tironian et path -> the whole icon set. No hand-drawn assets, no image dependencies:
// strokes are rasterised with a distance field and PNGs encoded with node:zlib.
// Run: node scripts/gen-icons.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "shared/design-tokens.json"), "utf8"));
const C = tokens.color;
const BOX = tokens.mark.viewBox; // 48

// ---- geometry: the mark as polylines in the 48-unit box --------------------

// bar: M11 14 H37
const bar = [[11, 14], [37, 14]];
// curl: M30 14 C30 26 30 34 19 37, flattened
const curl = [];
for (let i = 0; i <= 48; i++) {
  const t = i / 48, u = 1 - t;
  curl.push([
    u * u * u * 30 + 3 * u * u * t * 30 + 3 * u * t * t * 30 + t * t * t * 19,
    u * u * u * 14 + 3 * u * u * t * 26 + 3 * u * t * t * 34 + t * t * t * 37,
  ]);
}
const slash = [[6, 6], [42, 42]];

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.hypot(qx, qy);
}

function polyDist(px, py, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length - 1; i++) d = Math.min(d, segDist(px, py, poly[i], poly[i + 1]));
  return d;
}

// ---- tiny raster compositor -------------------------------------------------

const hex = (h) => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

function blend(img, size, x, y, [r, g, b], a) {
  if (a <= 0) return;
  const i = (y * size + x) * 4;
  const na = a + (img[i + 3] / 255) * (1 - a);
  if (na <= 0) return;
  img[i] = Math.round((r * a + img[i] * (img[i + 3] / 255) * (1 - a)) / na);
  img[i + 1] = Math.round((g * a + img[i + 1] * (img[i + 3] / 255) * (1 - a)) / na);
  img[i + 2] = Math.round((b * a + img[i + 2] * (img[i + 3] / 255) * (1 - a)) / na);
  img[i + 3] = Math.round(na * 255);
}

/**
 * Render one icon.
 *  bg          background colour, or null for transparent
 *  rounded     corner radius as a fraction of size (0 = square / full bleed)
 *  markScale   mark box size relative to canvas (maskable icons need head-room)
 *  stroke      stroke width in 48-box units
 *  slashed     draw the red "blocked" slash
 *  fg          stroke colour
 */
function render(size, { bg, rounded = 0, markScale = 1, stroke = 5.4, slashed = false, fg = C["paper-50"] }) {
  const img = new Uint8Array(size * size * 4);
  const bgc = bg ? hex(bg) : null;
  const fgc = hex(fg);
  const slc = hex(C["clay-400"]);
  const radius = rounded * size;
  const s = (size * markScale) / BOX;          // design units -> px
  const off = (size - size * markScale) / 2;   // centre the mark box
  const half = (stroke * s) / 2;
  const aa = 1; // 1px anti-alias ramp

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      if (bgc) {
        // signed distance to rounded rect centred on the canvas
        const hx = size / 2 - radius, hy = size / 2 - radius;
        const qx = Math.abs(cx - size / 2) - hx, qy = Math.abs(cy - size / 2) - hy;
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
        blend(img, size, x, y, bgc, Math.max(0, Math.min(1, 0.5 - d / aa)));
      }
      // mark strokes
      const px = (cx - off) / s, py = (cy - off) / s;
      const d = Math.min(polyDist(px, py, bar), polyDist(px, py, curl)) * s;
      blend(img, size, x, y, fgc, Math.max(0, Math.min(1, (half - d) / aa + 0.5)));
      if (slashed) {
        const ds = polyDist(px, py, slash) * s;
        blend(img, size, x, y, slc, Math.max(0, Math.min(1, (half - ds) / aa + 0.5)));
      }
    }
  }
  return img;
}

// ---- PNG encoder ------------------------------------------------------------

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(img, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(img.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- ICO packer (PNG-compressed entries, fine on Windows Vista+) -------------

function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dirs = [], blobs = [];
  let offset = 6 + entries.length * 16;
  for (const { size, data } of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = size >= 256 ? 0 : size;
    dir[1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, 4);  // planes
    dir.writeUInt16LE(32, 6); // bpp
    dir.writeUInt32LE(data.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += data.length;
    dirs.push(dir);
    blobs.push(data);
  }
  return Buffer.concat([header, ...dirs, ...blobs]);
}

// ---- SVG (the one true vector definition, for favicons and inline use) -------

function svg({ bg = null, rounded = 0, fg = C["paper-50"], stroke = 5.4 } = {}) {
  const rect = bg
    ? `  <rect width="48" height="48" rx="${(rounded * 48).toFixed(1)}" fill="${bg}"/>\n`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}">
${rect}  <g fill="none" stroke="${fg}" stroke-width="${stroke}" stroke-linecap="round">
    <path d="${tokens.mark.bar}"/>
    <path d="${tokens.mark.curl}"/>
  </g>
</svg>
`;
}

// ---- outputs ------------------------------------------------------------------

const webIcons = join(root, "web/icons");
const winAssets = join(root, "windows/Tiro.Windows/Assets");
const landing = join(root, "landing");
mkdirSync(webIcons, { recursive: true });
mkdirSync(winAssets, { recursive: true });
mkdirSync(landing, { recursive: true });

const appIcon = { bg: C["clay-500"], rounded: 0.24, markScale: 0.98 };
const fullBleed = { bg: C["clay-500"], rounded: 0, markScale: 0.72 };

// PWA icons: regular (rounded, transparent corners) + maskable (full bleed, safe zone)
for (const size of [192, 512]) writeFileSync(join(webIcons, `icon-${size}.png`), png(render(size, appIcon), size));
writeFileSync(join(webIcons, "maskable-512.png"), png(render(512, fullBleed), 512));
// iOS rounds the corners itself; give it full bleed with a slightly larger mark
writeFileSync(join(webIcons, "apple-touch-icon.png"), png(render(180, { ...fullBleed, markScale: 0.8 }), 180));
writeFileSync(join(webIcons, "favicon-32.png"), png(render(32, appIcon), 32));
writeFileSync(join(webIcons, "icon.svg"), svg({ bg: C["clay-500"], rounded: 0.24 }));

// landing page ships standalone, so it gets its own favicon copies
writeFileSync(join(landing, "favicon-32.png"), png(render(32, appIcon), 32));
writeFileSync(join(landing, "icon.svg"), svg({ bg: C["clay-500"], rounded: 0.24 }));

// Windows: app icon + one tray icon per state, colour-coded background so the
// state reads at 16px. Same states as the macOS menu bar item.
const trayStates = {
  "tiro": appIcon,                                                    // app/installer icon
  "tray-idle": { bg: C["ink-800"], rounded: 0.5, markScale: 0.95 },
  "tray-recording": { bg: C["clay-500"], rounded: 0.5, markScale: 0.95 },
  "tray-transcribing": { bg: C["gilt-500"], rounded: 0.5, markScale: 0.95 },
  "tray-blocked": { bg: C["ink-800"], rounded: 0.5, markScale: 0.95, slashed: true },
};
for (const [name, style] of Object.entries(trayStates)) {
  const sizes = name === "tiro" ? [16, 24, 32, 48, 64, 256] : [16, 20, 24, 32, 48];
  writeFileSync(
    join(winAssets, `${name}.ico`),
    ico(sizes.map((s) => ({ size: s, data: png(render(s, style), s) })))
  );
}

console.log("wrote web/icons/* and windows/Tiro.Windows/Assets/*.ico");
