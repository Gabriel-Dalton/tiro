// End-to-end check of the web core, run against a real Chromium.
//
//   node scripts/smoke-web.mjs      (needs: npm i -D playwright && npx playwright install chromium)
//
// The point is to cover the things that only break in a browser and that
// reading the code will not tell you: whether the install affordance appears on
// each platform, whether the level halo actually tracks the microphone, and
// whether a take survives a user who taps faster than the mic can open.
//
// Deepgram is stubbed (a fake socket) and the microphone is Chromium's synthetic
// device, so this needs no key, no network and no hardware.
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = createServer((req, res) => {
  let p = join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (p.endsWith("/")) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404); res.end("no"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(8099, r));

const browser = await chromium.launch({
  // a synthetic mic, so a real take can run end to end without hardware
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- desktop
{
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(400);

  check("desktop boots with no page errors", errors.length === 0, errors.join(" | "));
  check("install button hidden with no beforeinstallprompt",
    await page.locator("#install-btn").isHidden());
  check("setup card shows when no key is stored",
    await page.locator("#setup-card").isVisible());

  // Chromium fires beforeinstallprompt only for a real installability check, so
  // synthesise the event the way the browser would.
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt");
    e.prompt = () => { window.__promptCalled = true; return Promise.resolve(); };
    Object.defineProperty(e, "userChoice", { value: Promise.resolve({ outcome: "accepted" }) });
    window.dispatchEvent(e);
  });
  await page.waitForTimeout(100);
  check("install button appears after beforeinstallprompt",
    await page.locator("#install-btn").isVisible());
  check("settings install card is revealed too",
    !(await page.locator("#install-card").getAttribute("hidden")));
  await page.locator('.tab[data-view="settings"]').click();
  await page.waitForTimeout(100);
  check("settings install card is on screen once Settings is open",
    await page.locator("#install-card").isVisible());
  await page.locator('.tab[data-view="record"]').click();

  await page.locator("#install-btn").click();
  await page.waitForTimeout(150);
  check("sheet opens", await page.locator("#install-sheet").isVisible());
  check("sheet offers the one-tap Install button", await page.locator("#install-do").isVisible());
  const steps = await page.locator("#install-steps li").count();
  check("sheet lists steps", steps === 3, `${steps} steps`);

  await page.locator("#install-do").click();
  await page.waitForTimeout(150);
  check("Install calls the stashed prompt", await page.evaluate(() => window.__promptCalled === true));
  check("sheet closes after installing", await page.locator("#install-sheet").isHidden());

  // Escape must close it too
  await page.locator("#install-btn").click();
  await page.waitForTimeout(100);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  check("Escape closes the sheet", await page.locator("#install-sheet").isHidden());

  await ctx.close();
}

// ---------------------------------------------------------------- iPhone
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(400);

  check("iPhone boots with no page errors", errors.length === 0, errors.join(" | "));
  check("iPhone shows the install button with no beforeinstallprompt",
    await page.locator("#install-btn").isVisible());

  await page.locator("#install-btn").click();
  await page.waitForTimeout(150);
  check("iPhone sheet opens", await page.locator("#install-sheet").isVisible());
  check("iPhone sheet hides the one-tap button (no such API on iOS)",
    await page.locator("#install-do").isHidden());
  const text = await page.locator("#install-steps").innerText();
  check("iPhone sheet names Share and Add to Home Screen",
    /Share/.test(text) && /Add to Home Screen/.test(text), text.replace(/\n/g, " / "));
  const glyphs = await page.locator("#install-steps .glyph").count();
  check("iPhone sheet draws the Share glyph", glyphs >= 1, `${glyphs} glyphs`);

  // the landing-page handoff
  await page.goto("http://localhost:8099/?install=1");
  await page.waitForTimeout(700);
  check("?install=1 opens the sheet on arrival", await page.locator("#install-sheet").isVisible());
  check("?install=1 is cleared from the URL", !page.url().includes("install=1"), page.url());

  await ctx.close();
}

// ---------------------------------------------------------------- halo pulse
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(300);

  // No CSS transition may remain on the halo — a transition re-armed by every
  // rAF write is exactly what made the old pulse smear behind the voice.
  const dur = await page.evaluate(() =>
    getComputedStyle(document.getElementById("halo")).transitionDuration);
  check("halo carries no CSS transition", dur === "0s", dur);

  // narrow viewport uses the 26px stage padding
  await page.setViewportSize({ width: 420, height: 800 });
  await page.waitForTimeout(80);
  let aligned = await page.evaluate(() => {
    const h = document.getElementById("halo").getBoundingClientRect();
    const b = document.getElementById("talk").getBoundingClientRect();
    return { dTop: Math.round(h.top - b.top), dLeft: Math.round(h.left - b.left) };
  });
  check("halo sits exactly on the button at 420px", aligned.dTop === 0 && aligned.dLeft === 0,
    JSON.stringify(aligned));

  // wide viewport crosses the 700px breakpoint, where the padding changes
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(80);
  aligned = await page.evaluate(() => {
    const h = document.getElementById("halo").getBoundingClientRect();
    const b = document.getElementById("talk").getBoundingClientRect();
    return { dTop: Math.round(h.top - b.top), dLeft: Math.round(h.left - b.left) };
  });
  check("halo sits exactly on the button at 1100px (the old off-by-14px)",
    aligned.dTop === 0 && aligned.dLeft === 0, JSON.stringify(aligned));

  await ctx.close();
}

// Deepgram is unreachable from this sandbox (and would want a real key), so
// stand in a socket that behaves the way theirs does: opens, accepts audio,
// and answers CloseStream with a final transcript then Metadata.
const FAKE_SOCKET = () => {
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sentBytes = 0;
      window.__wsCount = (window.__wsCount || 0) + 1;
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 30);
    }
    send(data) {
      if (typeof data === "string") {
        if (data.includes("CloseStream")) {
          setTimeout(() => {
            this.onmessage && this.onmessage({ data: JSON.stringify({
              type: "Results", is_final: true,
              channel: { alternatives: [{ transcript: "hello from the fake mic" }] },
            }) });
            this.onmessage && this.onmessage({ data: JSON.stringify({ type: "Metadata" }) });
          }, 20);
        }
        return;
      }
      this.sentBytes += data.byteLength || 0;
      window.__audioBytes = (window.__audioBytes || 0) + (data.byteLength || 0);
    }
    close() { this.readyState = 3; setTimeout(() => this.onclose && this.onclose({ code: 1000 }), 0); }
  }
  FakeWS.OPEN = 1;
  FakeWS.CLOSED = 3;
  window.WebSocket = FakeWS;
};

// ------------------------------------------------- a real take, with a fake mic
{
  const ctx = await browser.newContext({ permissions: ["microphone", "clipboard-write", "clipboard-read"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem("tiro.apiKey", "test-key-not-real"));
  await page.addInitScript(FAKE_SOCKET);
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(400);

  const btn = page.locator("#talk");
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900); // hold, so this is a hold and not a tap

  check("holding enters the recording state",
    /listening/i.test(await page.locator("#talk-label").innerText()));

  // Sample the halo across a second of the fake mic's tone.
  const frames = await page.evaluate(() => new Promise((resolve) => {
    const halo = document.getElementById("halo");
    const seen = [];
    const t0 = performance.now();
    const grab = () => {
      const s = getComputedStyle(halo);
      seen.push({ o: parseFloat(s.opacity), m: s.transform });
      if (performance.now() - t0 < 900) requestAnimationFrame(grab);
      else resolve(seen);
    };
    requestAnimationFrame(grab);
  }));
  const opacities = frames.map((f) => f.o);
  const scales = [...new Set(frames.map((f) => f.m))];
  check("halo is visible while recording", Math.max(...opacities) > 0.25,
    `peak opacity ${Math.max(...opacities).toFixed(2)}`);
  check("halo actually moves with the audio", scales.length > 5,
    `${scales.length} distinct transforms across ${frames.length} frames`);
  // A smeared pulse shows as huge jumps between adjacent frames; a smoothed one
  // never moves far in 16 ms.
  const jumps = opacities.slice(1).map((o, i) => Math.abs(o - opacities[i]));
  check("halo eases rather than jumping", Math.max(...jumps) < 0.35,
    `largest single-frame opacity jump ${Math.max(...jumps).toFixed(3)}`);

  check("audio actually reached the socket",
    (await page.evaluate(() => window.__audioBytes || 0)) > 0,
    `${await page.evaluate(() => window.__audioBytes || 0)} bytes`);

  await page.mouse.up();
  await page.waitForTimeout(2000);
  check("halo settles back to invisible after the take",
    (await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("halo")).opacity))) < 0.02);
  check("halo transform is reset, not frozen mid-pulse",
    (await page.evaluate(() => {
      const t = getComputedStyle(document.getElementById("halo")).transform;
      return t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
    })));
  check("the take ends back at idle", /hold to talk/i.test(await page.locator("#talk-label").innerText()));
  check("the transcript lands on the result card",
    (await page.locator("#result-text").innerText()).includes("hello from the fake mic"));
  check("exactly one socket was opened for one take",
    (await page.evaluate(() => window.__wsCount)) === 1,
    `${await page.evaluate(() => window.__wsCount)} sockets`);

  await page.locator('.tab[data-view="history"]').click();
  await page.waitForTimeout(300);
  check("the take is written to history",
    (await page.locator("#history-list").innerText()).includes("hello from the fake mic"));
  check("no page errors during a full take", errors.length === 0, errors.join(" | "));

  await ctx.close();
}

// ----------------------------------------- releasing before the mic is ready
{
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("tiro.apiKey", "test-key-not-real");
    // First run on a phone: the permission prompt holds getUserMedia open long
    // past the tap. This is the window the old code had no guard for.
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) =>
      new Promise((r) => setTimeout(() => r(real(c)), 900));
  });
  await page.addInitScript(FAKE_SOCKET);
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(300);

  const box = await page.locator("#talk").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();          // released long before the mic opens
  await page.waitForTimeout(1400);

  const label = await page.locator("#talk-label").innerText();
  check("tap-before-mic-ready lands in hands-free mode, not stuck on Listening",
    /tap to stop/i.test(label), `label is "${label}"`);

  // The old bug: pressing again here opened a second Deepgram socket and
  // orphaned the first. Now the second press stops the take instead.
  await page.mouse.down();
  await page.waitForTimeout(30);
  await page.mouse.up();
  await page.waitForTimeout(1800);
  const after = await page.locator("#talk-label").innerText();
  check("the next tap stops the take rather than starting a second one",
    /hold to talk/i.test(after), `label is "${after}"`);
  check("only one socket was ever opened across the whole fumbled sequence",
    (await page.evaluate(() => window.__wsCount)) === 1,
    `${await page.evaluate(() => window.__wsCount)} sockets`);

  await ctx.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
