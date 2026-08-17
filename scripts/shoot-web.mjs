// Photograph the web core, out of a real browser rather than a mockup.
//
//   node scripts/shoot-web.mjs      (needs: npm i -D playwright && npx playwright install chromium)
//
// Writes docs/web/*.png. Every frame is the shipped `web/` running against the
// same stubbed Deepgram socket and synthetic microphone the smoke suite uses, so
// this needs no key, no network and no hardware, and nothing in the pictures is
// staged: the transcript on the card arrived through the app's own state machine
// and the halo is sitting wherever the audio put it.
//
// What this is not: a photograph of iOS. Chromium at an iPhone viewport draws the
// layout and the type faithfully and cannot draw Safari's chrome, the Home Screen
// or the share sheet. Shots that need those stay in the "still to take" table in
// docs/FORK.md rather than being approximated here, and the captions say which
// browser took each one.
//
// The screenshots are committed. Regenerate them when the interface changes, in
// the same pull request, so the document never advertises a version of the app
// that no longer exists.
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "web");
const OUT = join(HERE, "..", "docs", "web");
mkdirSync(OUT, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let p = join(ROOT, urlPath);
  if (urlPath.endsWith("/")) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404); res.end("no"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream",
    "cache-control": "no-cache" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(8098, r));

// Same fake socket as scripts/smoke-web.mjs: opens, accepts audio, and answers
// CloseStream with a final transcript then Metadata.
const FAKE_SOCKET = () => {
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 30);
    }
    send(data) {
      if (typeof data === "string") {
        if (data.includes("CloseStream")) {
          setTimeout(() => {
            this.onmessage && this.onmessage({ data: JSON.stringify({
              type: "Results", is_final: true,
              channel: { alternatives: [{ transcript: window.__fakeTranscript || "hello" }] },
            }) });
            this.onmessage && this.onmessage({ data: JSON.stringify({ type: "Metadata" }) });
          }, 20);
        }
      }
    }
    close() { this.readyState = 3; setTimeout(() => this.onclose && this.onclose({ code: 1000 }), 0); }
  }
  FakeWS.OPEN = 1;
  FakeWS.CLOSED = 3;
  window.WebSocket = FakeWS;
};

// Long enough to be a paragraph rather than a test string, because a screenshot
// of "hello from the fake mic" says nothing about how the card handles real text.
const SPOKEN = "The whole point of a scratchpad is that it is faster than opening " +
  "anything. Hold the button, say the sentence, and the transcript is on the " +
  "clipboard before you have switched apps.";

const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  executablePath: process.env.TIRO_CHROMIUM || undefined,
});

const shots = [];
const shoot = async (page, name, locator) => {
  const file = join(OUT, `${name}.png`);
  await (locator ? page.locator(locator) : page).screenshot({ path: file });
  shots.push(name);
  console.log(`  wrote docs/web/${name}.png`);
};

// History lives in IndexedDB, not localStorage, and the records are the shared
// JSONL schema from docs/ARCHITECTURE.md. Seeding it is the one thing in here
// that is not the app's own output: three takes run for the camera would all be
// stamped "just now" and a history screenshot is about the list over time. The
// text is written sample text for that reason, and the captions say so. The
// rendering, the grouping and the relative dates are the app's.
const SEED_HISTORY = async (page, records) => {
  // Through the app's own addEntry rather than a raw IndexedDB transaction: the
  // records then land exactly as a take's would, and a schema change here breaks
  // this script instead of quietly producing a screenshot of an empty list.
  await page.evaluate(async (records) => {
    const h = await import("/src/history.js");
    for (const r of records) await h.addEntry(r);
  }, records);
  await page.reload();
  await page.waitForTimeout(500);
};

// A phone-shaped context with a key already stored, a take already taken, and
// the animations stilled so two runs of this script produce the same bytes.
const phone = async ({ scheme = "light", keyed = true, history = [] } = {}) => {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    colorScheme: scheme,
    permissions: ["microphone", "clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  await page.addInitScript(FAKE_SOCKET);
  await page.addInitScript(([keyed, spoken]) => {
    if (keyed) localStorage.setItem("tiro.apiKey", "test-key-not-real");
    window.__fakeTranscript = spoken;
  }, [keyed, SPOKEN]);
  await page.goto("http://localhost:8098/");
  await page.waitForTimeout(500);
  if (history.length) await SEED_HISTORY(page, history);
  return { ctx, page };
};

// Offsets from the moment of capture rather than absolute dates, so the list
// always reads like a history somebody has been using rather than one abandoned
// on whatever day this script last ran.
const ago = (ms) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const HISTORY = [
  { ts: ago(4 * 6e4), text: SPOKEN, sec: 11.2 },
  { ts: ago(52 * 6e4), text: "Ask the supplier whether the March invoice covers both sites, and if it does, why the total moved.", sec: 7.4 },
  { ts: ago(26 * 36e5), text: "Rewrite the second paragraph so it leads with the limit rather than burying it, because that is the sentence people will quote.", sec: 6.8 },
  { ts: ago(3 * 864e5), text: "Two pounds of flour, the good yeast if they have it, and whatever tomatoes look least tired.", sec: 5.1 },
];

// ------------------------------------------------------- the take, end to end
{
  const { ctx, page } = await phone();
  await shoot(page, "phone-idle");

  const box = await page.locator("#talk").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1400); // a hold, and long enough for the clock to read
  await shoot(page, "phone-recording");
  await page.mouse.up();
  await page.waitForTimeout(1500);
  await shoot(page, "phone-take");

  // The install walkthrough arrives on its own here, which is the point of it:
  // docs/SPEC-PWA.md asks after the first successful take rather than on arrival.
  // docs/install-iphone-safari.png already carries that screen, so this only gets
  // it out of the way rather than photographing it twice.
  await page.waitForTimeout(1200);
  if (await page.locator("#install-sheet").isVisible()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  await page.locator('.tab[data-view="settings"]').click();
  await page.waitForTimeout(300);
  await shoot(page, "phone-settings");
  await ctx.close();
}

// -------------------------------------------------------- first run, and dark
{
  const { ctx, page } = await phone({ keyed: false });
  await shoot(page, "phone-setup");
  await ctx.close();
}
{
  const { ctx, page } = await phone({ scheme: "dark", history: HISTORY });
  await page.locator('.tab[data-view="history"]').click();
  await page.waitForTimeout(300);
  await shoot(page, "phone-history-dark");
  await ctx.close();
}
{
  const { ctx, page } = await phone({ history: HISTORY });
  await page.locator('.tab[data-view="history"]').click();
  await page.waitForTimeout(300);
  await shoot(page, "phone-history");

  // Usage reads off history, so it goes here rather than after a single take:
  // the figures are arithmetic over the list in the shot above it, and the
  // comparison against the subscriptions is the app's own table of prices.
  await page.locator('.tab[data-view="usage"]').click();
  await page.waitForTimeout(300);
  await shoot(page, "phone-usage");
  await ctx.close();
}


// ------------------------------------------------------------------- Windows
//
// The same files, at the size the WebView2 window opens at. Nothing here is a
// second implementation, which is the claim the picture is evidence for: a
// desktop-width capture of web/ is what the Windows app's window contains.
{
  const ctx = await browser.newContext({
    viewport: { width: 1040, height: 720 },
    deviceScaleFactor: 2,
    permissions: ["microphone", "clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  await page.addInitScript(FAKE_SOCKET);
  await page.addInitScript((spoken) => {
    localStorage.setItem("tiro.apiKey", "test-key-not-real");
    window.__fakeTranscript = spoken;
  }, SPOKEN);
  await page.goto("http://localhost:8098/");
  await page.waitForTimeout(500);
  await shoot(page, "desktop-idle");

  const box = await page.locator("#talk").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1400);
  await shoot(page, "desktop-recording");
  await page.mouse.up();
  await page.waitForTimeout(1500);
  await shoot(page, "desktop-take");

  // Everything but the first record, which the take above has already written:
  // seeding it again puts the same sentence in the list twice and the picture
  // reads as a duplicate-entry bug.
  await SEED_HISTORY(page, HISTORY.slice(1));
  await page.locator('.tab[data-view="history"]').click();
  await page.waitForTimeout(300);
  await shoot(page, "desktop-history");
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${shots.length} screenshots in docs/web/`);
