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

// Set to deploy a "new version": the worker comes back one byte different,
// which is exactly what the browser compares to decide there is an update. It
// is the only way to test the update prompt without publishing something.
let deployedVersion = "";

const server = createServer((req, res) => {
  let p = join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (p.endsWith("/")) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404); res.end("no"); return; }
  let body = readFileSync(p);
  if (deployedVersion && p.endsWith("sw.js")) {
    // Rename the cache exactly as gen-version.mjs does on a real release. This
    // is the difference between a test that means something and one that lies:
    // reusing the cache name lets the installing worker overwrite the old files
    // in place, so the page reads the new version by accident. In production
    // both caches exist at once and `caches.match` can answer from either.
    body = Buffer.from(
      String(body).replace(/const CACHE = "tiro-[^"]*";/, `const CACHE = "tiro-${deployedVersion}";`)
    );
  }
  // The app reads the incoming version off this file to decide both what to
  // call the update and whether it is worth mentioning at all, so a fake deploy
  // has to move it the way a real one would.
  if (deployedVersion && p.endsWith("version.js")) {
    body = Buffer.from(String(body).replace(/VERSION = "[^"]*"/, `VERSION = "${deployedVersion}"`));
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(p)] || "application/octet-stream",
    // sw.js is served no-cache in production too (web/vercel.json); without it
    // the browser can answer registration.update() from its own cache.
    "cache-control": "no-cache",
  });
  res.end(body);
});
await new Promise((r) => server.listen(8099, r));

const browser = await chromium.launch({
  // a synthetic mic, so a real take can run end to end without hardware
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  // Sandboxes and locked-down CI images often ship a Chromium already and block
  // the download Playwright would otherwise insist on. Point this at that binary
  // rather than pinning the npm version to whatever the image happens to carry.
  executablePath: process.env.TIRO_CHROMIUM || undefined,
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

  // The toolbar drawing is the part that makes "tap Share" findable by someone
  // who does not already know which icon that is.
  check("iPhone sheet draws Safari's toolbar", await page.locator(".safari-bar").isVisible());
  check("the Share slot is the one marked", await page.locator(".sb-slot.target").isVisible());
  check("the arrow points down, at the real toolbar below",
    await page.locator(".toolbar-figure .point.down").isVisible());
  check("iPhone sheet offers no Copy link (it is already in Safari)",
    await page.locator("#install-copy").isHidden());

  // the landing-page handoff
  await page.goto("http://localhost:8099/?install=1");
  await page.waitForTimeout(700);
  check("?install=1 opens the sheet on arrival", await page.locator("#install-sheet").isVisible());
  check("?install=1 is cleared from the URL", !page.url().includes("install=1"), page.url());

  await ctx.close();
}

// ------------------------------------ the sheet has to fit a small iPhone too
{
  // iPhone SE: the shortest screen still sold. The walkthrough is the tallest
  // thing in the app, and steps 2 and 3 being below an unscrollable fold would
  // be worse than no walkthrough at all.
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: { width: 375, height: 667 },
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8099/?install=1");
  await page.waitForTimeout(800);

  const fit = await page.evaluate(() => {
    const panel = document.getElementById("install-panel");
    const r = panel.getBoundingClientRect();
    return {
      withinViewport: r.top >= -1 && r.bottom <= window.innerHeight + 1,
      scrollable: panel.scrollHeight > panel.clientHeight,
      lastStepReachable: (() => {
        const steps = panel.querySelectorAll(".install-steps li");
        const last = steps[steps.length - 1];
        panel.scrollTop = panel.scrollHeight;
        return last.getBoundingClientRect().bottom <= window.innerHeight + 1;
      })(),
    };
  });
  check("the sheet stays inside a 667pt screen", fit.withinViewport, JSON.stringify(fit));
  check("the last step is reachable by scrolling", fit.lastStepReachable);
  check("no horizontal overflow on the narrowest phone",
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  await ctx.close();
}

// -------------------------------------------------- iPad puts Share elsewhere
{
  const ctx = await browser.newContext({ ...devices["iPad (gen 7)"] });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(400);
  await page.locator("#install-btn").click();
  await page.waitForTimeout(150);
  check("iPad sheet points up, not down",
    await page.locator(".toolbar-figure.ipad .point.up").isVisible());
  check("iPad caption names the address bar",
    /address bar/i.test(await page.locator(".toolbar-figure figcaption").innerText()));
  await ctx.close();
}

// ------------------------------- Chrome on iOS cannot install, and says so
{
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    userAgent: devices["iPhone 13"].userAgent.replace("Version/", "CriOS/120.0 Version/"),
    permissions: ["clipboard-write", "clipboard-read"],
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(400);
  await page.locator("#install-btn").click();
  await page.waitForTimeout(150);

  check("Chrome-on-iPhone is told to switch to Safari",
    /Safari/i.test(await page.locator("#install-title").innerText()),
    await page.locator("#install-title").innerText());
  check("Chrome-on-iPhone gets a Copy link escape hatch",
    await page.locator("#install-copy").isVisible());
  check("Chrome-on-iPhone is shown no Safari toolbar it cannot use",
    await page.locator(".safari-bar").count() === 0);

  await page.locator("#install-copy").click();
  await page.waitForTimeout(250);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check("Copy link puts the app URL on the clipboard", copied === "http://localhost:8099/", copied);
  check("the sheet closes once the link is copied",
    await page.locator("#install-sheet").isHidden());

  await ctx.close();
}

// ---------------------------------------------------------------- halo pulse
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(300);

  // No CSS transition may remain on the halo: a transition re-armed by every
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
      window.__wsOpen = (window.__wsOpen || 0) + 1;
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
    close() {
      if (this.readyState !== 3) window.__wsOpen--;
      this.readyState = 3;
      setTimeout(() => this.onclose && this.onclose({ code: 1000 }), 0);
    }
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

  const bytesAtRelease = await page.evaluate(() => window.__audioBytes || 0);
  await page.mouse.up();
  // Inside TAIL_SEC (0.5 s). The tail exists so the last word is not clipped,
  // and for a long time it did not work: stopAndInsert nulls the module-level
  // `stream` before sleeping, and the engine's chunk handler closed over exactly
  // that variable, so every chunk in the tail evaluated to `null && …`. The
  // audio was captured and billed and never sent. Nothing noticed, because the
  // transcript still arrives — just without whatever you said last.
  await page.waitForTimeout(380);
  const bytesInTail = await page.evaluate(() => window.__audioBytes || 0);
  check("the tail actually streams, rather than just delaying CloseStream",
    bytesInTail > bytesAtRelease,
    `${bytesAtRelease} bytes at release, ${bytesInTail} during the tail`);

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

  // The confirmation is the button, not a chip in the corner of the card. The
  // chip was the only answer there was and it was missed by everyone, because
  // it is not where the tap is.
  check("no confirmation chip left in the card head",
    (await page.locator("#result-card .badge").count()) === 0);
  check("the automatic copy reports itself on the button",
    (await page.locator("#result-copy").innerText()).trim() === "Copied",
    await page.locator("#result-copy").innerText());
  check("and the button carries the copied state, not just the word",
    await page.locator("#result-copy.is-done").count() === 1);

  await page.locator("#result-copy").click();
  await page.waitForTimeout(120);
  check("pressing Copy still answers Copied",
    (await page.locator("#result-copy").innerText()).trim() === "Copied");
  check("the clipboard has the transcript in it",
    (await page.evaluate(() => navigator.clipboard.readText())).includes("hello from the fake mic"));

  // navigator.share does not exist in desktop Chromium, and used to hide this
  // button outright: a desktop user had no way to send a transcript anywhere.
  check("Share is offered whether or not the browser has an OS share sheet",
    await page.locator("#result-share").isVisible());
  await page.locator("#result-share").click();
  await page.waitForTimeout(200);
  check("Share opens Tiro's own sheet", await page.locator("#share-sheet").isVisible());
  check("the sheet shows what is about to be sent",
    (await page.locator("#share-preview").innerText()).includes("hello from the fake mic"));
  const targets = await page.locator("#share-targets .share-target").count();
  check("the sheet offers somewhere to send it", targets >= 2, `${targets} targets`);
  const hasNative = await page.evaluate(() => !!navigator.share);
  check("the hand-off to the OS sheet appears only where there is one",
    (await page.locator("#share-targets").innerText()).includes("Other apps") === hasNative);

  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  check("Tab stays inside the share sheet",
    await page.evaluate(() => document.getElementById("share-panel").contains(document.activeElement)));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check("Escape closes the share sheet", await page.locator("#share-sheet").isHidden());
  check("and hands focus back to the button that opened it",
    await page.evaluate(() => document.activeElement === document.getElementById("result-share")));

  await page.locator('.tab[data-view="history"]').click();
  await page.waitForTimeout(300);
  check("the take is written to history",
    (await page.locator("#history-list").innerText()).includes("hello from the fake mic"));
  check("no page errors during a full take", errors.length === 0, errors.join(" | "));

  await ctx.close();
}

// ------------------------------------------------------------ discarding a take
//
// Cancel is the one path where being wrong is expensive in the opposite
// direction from everything else here: a discard that half-works still pastes
// your words into someone else's window.
{
  const ctx = await browser.newContext({ permissions: ["microphone", "clipboard-write", "clipboard-read"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem("tiro.apiKey", "test-key-not-real"));
  await page.addInitScript(FAKE_SOCKET);
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(400);

  check("no Discard control before a take starts", await page.locator("#discard").isHidden());

  const box = await page.locator("#talk").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  check("Discard appears once a take is running", await page.locator("#discard").isVisible());

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape ends the take", /hold to talk/i.test(await page.locator("#talk-label").innerText()));
  check("Escape says so", /discarded/i.test(await page.locator("#toast-text").innerText()));
  await page.mouse.up();
  // Long enough for the tail, the socket's finals and the fake transcript to
  // have arrived had anything still been listening for them.
  await page.waitForTimeout(2000);
  check("a discarded take leaves no transcript on screen",
    await page.locator("#result-card").isHidden());
  check("a discarded take is not billed to history",
    (await page.evaluate(() => localStorage.getItem("tiro.history"))) === null ||
    !(await page.evaluate(() => localStorage.getItem("tiro.history") || "")).includes("fake mic"));

  // Now the harder half: discard after the audio is already on its way, which
  // is when most people notice they did not mean it.
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();               // held, so this transcribes
  await page.waitForTimeout(120);
  check("Discard is still offered while transcribing", await page.locator("#discard").isVisible());
  await page.locator("#discard").click();
  // Straight after the click, well inside TAIL_SEC. Discarding while
  // transcribing has to close the socket itself: the take's own tail is asleep,
  // and the stream is no longer reachable through `stream`. Miss it and the
  // socket stays open with its keepalive armed for as long as the page lives.
  await page.waitForTimeout(120);
  check("discarding mid-transcribe closes the socket rather than orphaning it",
    (await page.evaluate(() => window.__wsOpen)) === 0,
    `${await page.evaluate(() => window.__wsOpen)} still open`);
  await page.waitForTimeout(2200);     // past the tail and the fake finals
  check("discarding mid-transcribe drops the result", await page.locator("#result-card").isHidden());
  check("no page errors across two discards", errors.length === 0, errors.join(" | "));

  // And the take after a discard still works, which is what the take token is
  // really protecting: a stale tail must not poison the next one.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); // off the Discard button
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(2200);
  check("the take after a discard still lands",
    (await page.locator("#result-text").innerText()).includes("hello from the fake mic"));

  await ctx.close();
}

// -------------------------------------------------- the Windows shell bridge
//
// Same core, WebView2 seam faked. This covers the two messages the pill lives
// on: the level stream that drives its waveform, and the cancel/stop commands
// its buttons send back.
{
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem("tiro.apiKey", "test-key-not-real");
    window.__sent = [];
    // The Windows app's normal state is a tray icon with its window hidden, and
    // a hidden WebView2 produces no frames, so requestAnimationFrame never
    // fires. Kill it outright here: the halo is allowed to stop, the pill's
    // level feed is not, and the first version of this shipped with the feed
    // riding on the halo's loop.
    window.requestAnimationFrame = () => 0;
    window.chrome = {
      webview: {
        addEventListener: (type, fn) => { if (type === "message") window.__hostSend = (m) => fn({ data: m }); },
        postMessage: (m) => window.__sent.push(m),
      },
    };
  });
  await page.addInitScript(FAKE_SOCKET);
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(400);

  check("the core knows it is inside the shell",
    await page.evaluate(() => window.__sent.some((m) => m.type === "ready")));

  // The host drives the take through the global hotkey, exactly as the C# hook does.
  await page.evaluate(() => window.__hostSend({ type: "hotkey", phase: "down" }));
  await page.waitForTimeout(1200);

  const levels = await page.evaluate(() =>
    window.__sent.filter((m) => m.type === "level").map((m) => m.value));
  check("the mic level reaches the host with requestAnimationFrame dead",
    levels.length > 0, `${levels.length} messages`);
  check("the level is a real signal, not a stuck number",
    new Set(levels).size > 3, `${new Set(levels).size} distinct values`);
  check("the level stays inside 0..1",
    levels.every((v) => v >= 0 && v <= 1), `range ${Math.min(...levels)}..${Math.max(...levels)}`);
  // The feed runs at 20 Hz and repeats are dropped, so a second of audio must
  // not arrive as one message per animation frame.
  check("the level is paced by the feed, not by the frame rate",
    levels.length < 40, `${levels.length} messages in ~1.2s`);

  // The pill's check: finish now, from a window that is not this one.
  await page.evaluate(() => window.__hostSend({ type: "stop" }));
  await page.waitForTimeout(2200);
  check("the pill's check finishes the take and hands the host a transcript",
    await page.evaluate(() => window.__sent.some(
      (m) => m.type === "transcript" && /hello from the fake mic/.test(m.text))));
  const parked = await page.evaluate(() => {
    const l = window.__sent.filter((m) => m.type === "level");
    return l.length ? l[l.length - 1].value : null;
  });
  check("the level parks at zero so the pill's bars do not freeze", parked === 0, `last level ${parked}`);

  // The pill's X, mid-take.
  await page.evaluate(() => { window.__sent.length = 0; window.__hostSend({ type: "hotkey", phase: "down" }); });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__hostSend({ type: "cancel" }));
  await page.waitForTimeout(2200);
  check("the pill's X discards without handing the host anything to paste",
    await page.evaluate(() => !window.__sent.some((m) => m.type === "transcript")));
  check("the host is told the take is over",
    await page.evaluate(() => {
      const s = window.__sent.filter((m) => m.type === "state");
      return s.length > 0 && s[s.length - 1].state === "idle";
    }));
  check("no page errors on the shell path", errors.length === 0, errors.join(" | "));

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

// ------------------- iPhone: the ask arrives after the app has proved itself
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"], permissions: ["microphone"] });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("tiro.apiKey", "test-key-not-real"));
  await page.addInitScript(FAKE_SOCKET);
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(600);

  check("no install sheet on arrival, nothing has been proved yet",
    await page.locator("#install-sheet").isHidden());

  const box = await page.locator("#talk").boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); // stop
  await page.waitForTimeout(2000);

  check("the take produced a transcript",
    /hello from the fake mic/.test(await page.locator("#result-text").innerText()));
  await page.waitForTimeout(1600); // the deliberate pause before asking
  check("the install sheet arrives after the first successful take",
    await page.locator("#install-sheet").isVisible());

  // Closing is "not now", and it must be remembered rather than asked again.
  await page.locator("#install-close").click();
  await page.waitForTimeout(150);
  check("closing records the refusal",
    (await page.evaluate(() => JSON.parse(localStorage.getItem("tiro.install.asked") || "{}").n)) === 1);

  await page.reload();
  await page.waitForTimeout(600);
  const box2 = await page.locator("#talk").boundingBox();
  await page.touchscreen.tap(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.waitForTimeout(600);
  await page.touchscreen.tap(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.waitForTimeout(4200);
  check("it does not ask again the same week",
    await page.locator("#install-sheet").isHidden());
  check("but the Install button is still right there",
    await page.locator("#install-btn").isVisible());

  await ctx.close();
}

// ------------------------------- once installed, the app confirms it worked
{
  // iOS fires no `appinstalled` event, so a launch in standalone display mode is
  // the only signal either side gets that the home-screen icon exists.
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      q.includes("standalone") ? { matches: true, addEventListener() {}, removeEventListener() {} } : mm(q);
  });
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(1400);

  check("installed: no Install button anywhere", await page.locator("#install-btn").isHidden());
  check("installed: the app confirms it once",
    /installed/i.test(await page.locator("#toast-text").innerText()),
    await page.locator("#toast-text").innerText());

  await page.reload();
  await page.waitForTimeout(1400);
  check("installed: it does not say so twice",
    !/installed/i.test(await page.locator("#toast-text").innerText()));
  await ctx.close();
}

// ---------------------------------------------------------------- interface
//
// The rules the redesign is built on, as assertions. Every one of these is
// something that was wrong at some point and would go quietly wrong again:
// interface type creeping back into the mono, an icon that renders as a missing
// glyph, a touch target too small for a thumb, a colour that looks fine to the
// person choosing it and fails for everyone else.
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("tiro.apiKey", "test-key-not-real"));
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(400);

  // --- type: the mono is for figures, not for the interface
  const mono = await page.evaluate(() => {
    const isMono = (el) => /mono|menlo|consolas|courier/i.test(getComputedStyle(el).fontFamily);
    const sel = (s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent !== null);
    return {
      interfaceInMono: [...sel(".tab-label"), ...sel(".caps"), ...sel(".btn"), ...sel(".status"),
        ...sel("#talk-label"), ...sel(".view-head h2")].filter(isMono).map((el) => el.textContent.trim()),
      figuresInMono: sel("#timer, .version").every(isMono),
    };
  });
  check("no interface type is set in the mono any more", mono.interfaceInMono.length === 0,
    mono.interfaceInMono.join(", "));

  // --- the tab bar
  const tabs = await page.evaluate(() => {
    return [...document.querySelectorAll(".tab")].map((t) => {
      const r = t.getBoundingClientRect();
      const icon = t.querySelector("svg");
      const ir = icon ? icon.getBoundingClientRect() : { width: 0, height: 0 };
      return {
        view: t.dataset.view,
        label: t.querySelector(".tab-label")?.textContent.trim(),
        h: Math.round(r.height),
        w: Math.round(r.width),
        icon: Math.round(ir.width),
        current: t.getAttribute("aria-current"),
      };
    });
  });
  check("four tabs, each with a drawn icon rather than a text glyph",
    tabs.length === 4 && tabs.every((t) => t.icon >= 18),
    JSON.stringify(tabs.map((t) => `${t.view}:${t.icon}px`)));
  check("every tab is a 44px-plus touch target",
    tabs.every((t) => t.h >= 44 && t.w >= 44),
    JSON.stringify(tabs.map((t) => `${t.view} ${t.w}×${t.h}`)));
  check("the current tab is marked for screen readers, not only in colour",
    tabs.filter((t) => t.current === "page").length === 1 &&
    tabs.find((t) => t.current === "page").view === "record");

  await page.locator('.tab[data-view="usage"]').click();
  await page.waitForTimeout(200);
  check("aria-current follows the tab you moved to",
    (await page.locator('.tab[data-view="usage"]').getAttribute("aria-current")) === "page" &&
    (await page.locator('.tab[data-view="record"]').getAttribute("aria-current")) === null);

  // --- every control says what it is
  await page.locator('.tab[data-view="history"]').click();
  await page.waitForTimeout(200);
  const nameless = await page.evaluate(() =>
    [...document.querySelectorAll("button, input, select")]
      .filter((el) => el.offsetParent !== null)
      .filter((el) => {
        const label = el.getAttribute("aria-label") || el.getAttribute("title") ||
          (el.labels && el.labels.length) || el.textContent.trim();
        return !label;
      })
      .map((el) => el.id || el.className || el.tagName));
  check("no unlabelled control on the History view", nameless.length === 0, nameless.join(", "));

  // --- the chart is not only a picture
  await page.locator('.tab[data-view="usage"]').click();
  await page.waitForTimeout(250);
  check("the daily chart carries a spoken summary",
    /minutes dictated per day/i.test(await page.locator("#daily-bars").getAttribute("aria-label")),
    await page.locator("#daily-bars").getAttribute("aria-label"));

  // --- nothing overflows the narrowest phone still sold
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(150);
  for (const v of ["record", "history", "usage", "settings"]) {
    await page.locator(`.tab[data-view="${v}"]`).click();
    await page.waitForTimeout(150);
    check(`no horizontal overflow on a 320px screen (${v})`,
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }

  await ctx.close();
}

// ------------------------------------------- text contrast, light and dark
//
// WCAG AA for body text is 4.5:1. Reading it off the rendered page rather than
// off the palette is the only way to catch a colour that is fine in the token
// file and wrong once it lands on the surface it is actually used on — and it
// checks the dark theme, which nobody looks at as often.
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], colorScheme: scheme });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("tiro.apiKey", "test-key-not-real"));
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(300);
  await page.locator('.tab[data-view="settings"]').click();
  await page.waitForTimeout(250);

  const worst = await page.evaluate(() => {
    const nums = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = [r, g, b].map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    // the first ancestor that actually paints something
    const bgOf = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const p = nums(getComputedStyle(n).backgroundColor);
        if (p.length >= 3 && (p[3] === undefined || p[3] > 0.5)) return p.slice(0, 3);
      }
      return [255, 255, 255];
    };
    const ratio = (a, b) => {
      const [l1, l2] = [lum(a), lum(b)];
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const samples = ["body", ".hint", ".caps", ".status", ".badge", ".tab:not(.active) .tab-label",
      ".tab.active .tab-label", ".btn", ".btn-accent", "a", ".version", "input"];
    const out = [];
    for (const sel of samples) {
      const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null);
      if (!el) continue;
      out.push({ sel, r: Math.round(ratio(nums(getComputedStyle(el).color).slice(0, 3), bgOf(el)) * 100) / 100 });
    }
    return out.sort((a, b) => a.r - b.r);
  });
  const failing = worst.filter((s) => s.r < 4.5);
  check(`${scheme}: every sampled text colour clears 4.5:1`, failing.length === 0,
    failing.map((f) => `${f.sel} ${f.r}`).join(", ") || `worst was ${worst[0].sel} at ${worst[0].r}`);

  await ctx.close();
}

// ------------------------------------------ the toast is sized against the screen
//
// It was positioned with `left: 50%` and centred with a transform. A fixed box
// with a left edge and `right: auto` shrinks to fit what is left of the line, so
// every message was laid out inside half the viewport and the 420px max-width
// could never apply: "Recording. Tap the button when you're done" wrapped to
// three lines inside a 195px pill on an iPhone, which is what it looked like.
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("tiro.apiKey", "test-key-not-real"));
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(300);

  // A real path to a real toast, rather than poking one in from the test.
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.waitForTimeout(260);

  const t = await page.evaluate(() => {
    const el = document.getElementById("toast");
    const span = document.getElementById("toast-text");
    const b = el.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(span).lineHeight) || 20;
    return {
      w: Math.round(b.width), vw: innerWidth,
      lines: Math.round(span.getBoundingClientRect().height / line),
      offCentre: Math.abs((b.left + b.right) / 2 - innerWidth / 2),
      overflows: b.left < 0 || b.right > innerWidth,
    };
  });
  check("a toast may be wider than half the screen", t.w > t.vw / 2, `${t.w}px of ${t.vw}`);
  check("an ordinary message fits on one line on a phone", t.lines === 1, `${t.lines} lines`);
  check("the toast is still centred", t.offCentre < 1, `${t.offCentre.toFixed(1)}px off`);
  check("and still inside the screen", !t.overflows);

  await ctx.close();
}

// ------------------------------------ dictating without touching the screen
{
  // The button was pointer-only, so a keyboard could focus it and do nothing at
  // all with it. Space has to hold it exactly like a finger does.
  const ctx = await browser.newContext({ permissions: ["microphone", "clipboard-write"] });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("tiro.apiKey", "test-key-not-real"));
  await page.addInitScript(FAKE_SOCKET);
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(400);

  await page.locator("#talk").focus();
  await page.keyboard.down(" ");
  await page.waitForTimeout(900);
  check("holding Space starts a take",
    /listening/i.test(await page.locator("#talk-label").innerText()),
    await page.locator("#talk-label").innerText());
  await page.keyboard.up(" ");
  await page.waitForTimeout(2000);
  check("releasing Space finishes it, transcript and all",
    (await page.locator("#result-text").innerText()).includes("hello from the fake mic"));

  // A dialog is only modal if Tab cannot walk out of the back of it.
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt");
    e.prompt = () => Promise.resolve();
    Object.defineProperty(e, "userChoice", { value: Promise.resolve({ outcome: "dismissed" }) });
    window.dispatchEvent(e);
  });
  await page.locator("#install-btn").click();
  await page.waitForTimeout(200);
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  check("Tab stays inside the install sheet",
    await page.evaluate(() => document.getElementById("install-panel").contains(document.activeElement)));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check("closing the sheet gives focus back to the button that opened it",
    await page.evaluate(() => document.activeElement === document.getElementById("install-btn")));

  await ctx.close();
}

// ------------------------------------------- being told there is a new version
//
// An installed web app has no App Store to tell it it is out of date, and the
// service worker used to swap the new shell in under a running page without
// saying anything. Three things have to hold: the new version waits rather than
// taking over, the app offers a reload, and taking the offer actually reloads.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("tiro.apiKey", "test-key-not-real"));
  await page.goto("http://localhost:8099/");

  const controlled = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    // `ready` resolves on activation, which on a first load can be a beat before
    // the page is controlled.
    for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return !!navigator.serviceWorker.controller;
  });
  check("the service worker takes control on first load", controlled);
  check("no update offer when there is no update",
    await page.locator("#toast-action").isHidden());

  deployedVersion = "1.99.0"; // "ship" a new feature release while the app is open
  const waiting = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await reg.update();
    for (let i = 0; i < 60 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 100));
    return { waiting: !!reg.waiting, stillControlledByOld: !!navigator.serviceWorker.controller };
  });
  check("a new version installs but waits instead of taking over",
    waiting.waiting && waiting.stillControlledByOld, JSON.stringify(waiting));

  await page.waitForSelector("#toast-action:not([hidden])", { timeout: 5000 }).catch(() => {});
  const toast = await page.locator("#toast").innerText();
  check("the app names the version that is ready", /1\.99\.0 is ready/i.test(toast),
    toast.replace(/\n/g, " "));
  check("the offer is a button, not a message that scrolls away",
    (await page.locator("#toast-action").innerText()).trim() === "Update");
  check("and it can be turned down", await page.locator("#toast-dismiss").isVisible());
  // These two are the only things you can press in an update offer, and on a
  // phone they are the ones being pressed.
  const offerTargets = await page.evaluate(() =>
    ["toast-action", "toast-dismiss"].map((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { id, w: Math.round(r.width), h: Math.round(r.height) };
    }));
  check("the offer's own controls are 44px targets too",
    offerTargets.every((t) => t.h >= 44 && t.w >= 44), JSON.stringify(offerTargets));

  // An ordinary toast must not take the offer away with it: "Copied" used to
  // reuse this element, strip the buttons, and close on its own timer, killing
  // the offer for the rest of the session.
  await page.evaluate(() => {
    document.querySelector('.tab[data-view="history"]').click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.waitForTimeout(300);
  check("an ordinary message does not destroy the pending offer",
    await page.locator("#toast-action").isHidden() ||
      (await page.locator("#toast-action").innerText()).trim() === "Update");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(2200);
  check("and the offer comes back once that message has passed",
    (await page.locator("#toast").innerText()).includes("Update"),
    await page.locator("#toast").innerText());
  await page.locator('.tab[data-view="record"]').click();
  check("an offer does not time out while you are reading it",
    await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 4000)); // longer than any notice()
      return document.getElementById("toast").dataset.open === "true";
    }));

  await page.evaluate(() => { window.__beforeReload = true; });
  await page.locator("#toast-action").click();
  await page.waitForTimeout(2500);
  check("Reload actually reloads onto the new version",
    await page.evaluate(() => window.__beforeReload === undefined));

  deployedVersion = "";
  await ctx.close();
}

// ------------------------------------- what is worth interrupting someone for
//
// The rule, in one place so it cannot drift between the app and the shell: a
// release that adds something is worth one interruption; a release that fixes a
// typo is not, and lands on next launch anyway; enough fixes piled up is worth
// saying once. And whatever is shown is shown once per version — an update
// prompt that comes back is how people learn to dismiss them unread.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("http://localhost:8099/");
  await page.waitForTimeout(300);

  const verdicts = await page.evaluate(async () => {
    const { updateWorth } = await import("./src/app.js");
    return {
      minor: updateWorth("1.2.0", "1.3.0"),
      major: updateWorth("1.9.9", "2.0.0"),
      onePatch: updateWorth("1.2.0", "1.2.1"),
      twoPatches: updateWorth("1.2.0", "1.2.2"),
      same: updateWorth("1.2.0", "1.2.0"),
      older: updateWorth("1.2.0", "1.1.9"),
      tenVsNine: updateWorth("1.9.0", "1.10.0"),
      nonsense: updateWorth("1.2.0", "nightly"),
    };
  });
  check("a release that adds something is worth saying",
    verdicts.minor === "feature" && verdicts.major === "feature", JSON.stringify(verdicts));
  check("a single fix is not worth interrupting anyone", verdicts.onePatch === "quiet");
  check("fixes piling up are worth saying once", verdicts.twoPatches === "fixes");
  check("the same version, an older one, and nonsense are not updates",
    verdicts.same === null && verdicts.older === null && verdicts.nonsense === null);
  check("1.10.0 beats 1.9.0 here too", verdicts.tenVsNine === "feature");

  await ctx.close();
}

// ------------------- a redeploy that changes no version says nothing at all
//
// Every push to the site produces a new worker, version bump or not: a typo in
// a comment counts. Without this, every deploy would interrupt every user with
// "a new version is ready", which is precisely how update prompts become things
// people dismiss unread.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("http://localhost:8099/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForTimeout(300);

  deployedVersion = "same"; // salts the worker; version.js comes back unparseable
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await reg.update();
    for (let i = 0; i < 60 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 100));
  });
  await page.waitForTimeout(1500);
  check("an unreadable or unmoved version produces no banner",
    await page.locator("#toast-action").isHidden(),
    await page.locator("#toast").innerText());

  deployedVersion = "";
  await ctx.close();
}

// ------------------------------- a fix-only release does not interrupt at all
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("http://localhost:8099/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForTimeout(300);

  const current = await page.evaluate(async () => (await import("./src/version.js")).VERSION);
  const [maj, min, patch] = current.split(".").map(Number);
  deployedVersion = `${maj}.${min}.${patch + 1}`; // one patch: a typo, not news

  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await reg.update();
    for (let i = 0; i < 60 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 100));
    return !!reg.waiting;
  });
  await page.waitForTimeout(1200);
  check("a fix-only release installs quietly, with no banner",
    await page.locator("#toast-action").isHidden(),
    await page.locator("#toast").innerText());

  deployedVersion = "";
  await ctx.close();
}

// ------------------------------- what "Save & test" is allowed to blame
//
// A socket that closes before it opens used to be read as a rejected key
// whenever the browser believed it was online. 1006 is what a browser reports
// for both a refused handshake and a connection that never arrived, and
// navigator.onLine is true on a captive portal, so a working key behind a hotel
// wifi login was reported as rejected. The test may only blame the key when
// Deepgram says so.
{
  // Close before open with a given code, which is the shape of every failure
  // this is about.
  const CLOSING_SOCKET = (code) => {
    window.__closeCode = code;
    class DeadWS {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        setTimeout(() => {
          this.readyState = 3;
          this.onclose && this.onclose({ code: window.__closeCode });
        }, 20);
      }
      send() {}
      close() {}
    }
    DeadWS.OPEN = 1;
    DeadWS.CLOSED = 3;
    window.WebSocket = DeadWS;
  };

  const testWithClose = async (code) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(CLOSING_SOCKET, code);
    await page.goto("http://localhost:8099/");
    await page.waitForTimeout(300);
    await page.locator("#setup-key").fill("dg_a_key_that_works_fine");
    await page.locator("#setup-save").click();
    await page.waitForTimeout(1200);
    const text = await page.locator("#setup-status").innerText();
    await ctx.close();
    return text;
  };

  const ambiguous = await testWithClose(1006);
  check("1006 does not accuse the key: the test never got an answer",
    !/reject|key/i.test(ambiguous) || /check your connection/i.test(ambiguous), ambiguous);
  check("1006 says what actually happened", /deepgram/i.test(ambiguous), ambiguous);

  const refused = await testWithClose(1008);
  check("1008 is Deepgram refusing the key, and is reported as such",
    /reject/i.test(refused), refused);
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
