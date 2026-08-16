// Installing Tiro to the home screen / taskbar.
//
// Two worlds, and the difference is not ours to paper over:
//
//   Chromium (Android, Windows, ChromeOS, desktop Linux) fires
//   `beforeinstallprompt`. Stash it, and installing is genuinely one tap.
//
//   iOS has no install API at all. Safari's Share -> Add to Home Screen is the
//   only sanctioned path, and it cannot be opened from a page. So the same
//   button opens a guided sheet instead of a button that silently does nothing.
//
// Because iOS is the platform where we can do least, it is the one that gets
// the most care here: a picture of the toolbar the button actually lives in, a
// way out for people who arrived in the wrong browser, an ask timed to the
// moment they have just seen the app work, and a confirmation afterwards,
// since iOS fires no event to tell either of us that it worked.

const UA = navigator.userAgent;

const IS_IPAD = /ipad/i.test(UA) || (/mac/i.test(UA) && navigator.maxTouchPoints > 1);
const IS_IOS = /iphone|ipod/i.test(UA) || IS_IPAD;

// On iOS every browser is Safari's engine, but only Safari itself carries
// "Add to Home Screen". Sending a Chrome-on-iPhone user through the Safari
// steps ends at a share sheet with no such row, so name the real fix.
const IS_IOS_SAFARI = IS_IOS && !/crios|fxios|edgios|opios|firefox/i.test(UA);

const IS_ANDROID = /android/i.test(UA);
const IS_FIREFOX = /firefox|fxios/i.test(UA);

const SEEN_KEY = "tiro.install.asked";      // {n: times dismissed, at: last dismissal}
const HELLO_KEY = "tiro.install.greeted";   // confirmed once, after it worked

/** Already installed? Then no install UI anywhere. */
export function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    navigator.standalone === true
  );
}

// ---------------------------------------------------------------- glyphs

/** iOS Share glyph, drawn rather than described: the row is easier to find in
 * a share sheet when you have seen the shape. */
const SHARE_GLYPH = `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 3.5 v11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M8.4 7.1 12 3.5 15.6 7.1" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M7 10.5 H5.5 A1.5 1.5 0 0 0 4 12 v7 A1.5 1.5 0 0 0 5.5 20.5 h13 A1.5 1.5 0 0 0 20 19 v-7
           a1.5 1.5 0 0 0-1.5-1.5 H17" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const PLUS_GLYPH = `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
  <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.4" fill="none"
        stroke="currentColor" stroke-width="1.8"/>
  <path d="M12 8.4 v7.2 M8.4 12 h7.2" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

const MENU_GLYPH = `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
  <g fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></g>
</svg>`;

// Safari's own toolbar icons, near enough to be recognised at a glance. The
// point is not accuracy of draughtsmanship. It is that someone can hold this
// next to their screen and see which button we mean.
const BAR_ICON = {
  back: `<path d="M15 5 L8 12 l7 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,
  forward: `<path d="M9 5 l7 7 -7 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,
  book: `<path d="M5 4.5 h9 a2 2 0 0 1 2 2 v13 H7 a2 2 0 0 1-2-2 z M16 6.5 h3 v13 H7" fill="none"
          stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
  tabs: `<rect x="4" y="6.5" width="11" height="11" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/>
         <rect x="9" y="4" width="11" height="11" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/>`,
};

const barSlot = (name) =>
  `<span class="sb-slot"><svg viewBox="0 0 24 24" aria-hidden="true">${BAR_ICON[name]}</svg></span>`;

/** A drawing of the toolbar the Share button lives in, marked. On iPhone that
 * bar is at the bottom of the screen, directly below this sheet, so the arrow
 * points at the real thing. iPad puts it top-right instead. */
function toolbarDiagram() {
  const target =
    `<span class="sb-slot target"><svg viewBox="0 0 24 24" aria-hidden="true">
       <path d="M12 3.5 v11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
       <path d="M8.4 7.1 12 3.5 15.6 7.1" fill="none" stroke="currentColor" stroke-width="1.9"
             stroke-linecap="round" stroke-linejoin="round"/>
       <path d="M7 10.5 H5.5 A1.5 1.5 0 0 0 4 12 v7 A1.5 1.5 0 0 0 5.5 20.5 h13 A1.5 1.5 0 0 0 20 19 v-7
                a1.5 1.5 0 0 0-1.5-1.5 H17" fill="none" stroke="currentColor" stroke-width="1.9"
             stroke-linecap="round" stroke-linejoin="round"/>
     </svg></span>`;

  if (IS_IPAD) {
    return `<figure class="toolbar-figure ipad">
      <span class="point up" aria-hidden="true">↑</span>
      <div class="safari-bar" aria-hidden="true">
        ${barSlot("back")}${barSlot("forward")}
        <span class="sb-url">tiro</span>
        ${target}${barSlot("tabs")}
      </div>
      <figcaption>Top of your screen, next to the address bar</figcaption>
    </figure>`;
  }

  // Caption first, then the arrow last, so the arrow points past the edge of
  // the sheet at the real toolbar rather than appearing to point at the caption.
  return `<figure class="toolbar-figure">
    <div class="safari-bar" aria-hidden="true">
      ${barSlot("back")}${barSlot("forward")}${target}${barSlot("book")}${barSlot("tabs")}
    </div>
    <figcaption>Safari's toolbar, at the very bottom of your screen right now</figcaption>
    <span class="point down" aria-hidden="true">↓</span>
  </figure>`;
}

// ---------------------------------------------------------------- installer

export class Installer {
  /**
   * @param {object} els  { button, sheet, panel, lede, steps, visual, doButton,
   *                        copyButton, closeButton, card, cardButton }
   * @param {(text: string, tone?: string, ms?: number) => void} notice
   */
  constructor(els, notice) {
    this.els = els;
    this.notice = notice;
    this.prompt = null;      // the stashed BeforeInstallPromptEvent
    this.enabled = false;    // false inside the Windows shell / when installed
    this.asked = false;      // this session
  }

  /** Wire everything up. Safe to call once, at boot. */
  start({ isShell }) {
    const { button, sheet, doButton, closeButton, card } = this.els;

    // The Windows app *is* the installed app, and an installed PWA has nowhere
    // left to install to.
    if (isShell || isInstalled()) {
      button.hidden = true;
      if (card) card.hidden = true;
      if (!isShell) this._greetOnce();
      return;
    }
    this.enabled = true;

    // Chromium tells us the moment it considers the app installable. It fires
    // after the manifest and service worker check out, which is also the best
    // signal we have that installing will actually work.
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault(); // keep Chrome's own mini-infobar from racing this UI
      this.prompt = e;
      this._reveal();
    });

    window.addEventListener("appinstalled", () => {
      this.prompt = null;
      this.close();
      button.hidden = true;
      if (card) card.hidden = true;
      this.notice("Installed. Open Tiro from your home screen", "ok", 4000);
    });

    button.addEventListener("click", () => this.open());
    if (this.els.cardButton) this.els.cardButton.addEventListener("click", () => this.open());
    closeButton.addEventListener("click", () => this.dismiss());
    doButton.addEventListener("click", () => this.install());
    if (this.els.copyButton) this.els.copyButton.addEventListener("click", () => this.copyLink());
    sheet.addEventListener("click", (e) => { if (e.target === sheet) this.dismiss(); });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) this.dismiss(); });

    // iOS never fires beforeinstallprompt, so nothing above would ever show the
    // button there. Reveal it on the strength of the platform instead, and make
    // it read as an action rather than a chip. On the phone this is the whole
    // difference between a bookmark and an app.
    if (IS_IOS) {
      this._reveal();
      button.textContent = "Install";
      button.classList.add("strong");
    }

    // Handed over from the landing page: /app/?install=1 lands with the sheet open.
    if (new URLSearchParams(location.search).get("install") === "1") {
      history.replaceState(null, "", location.pathname); // one-shot, survives reload
      setTimeout(() => this.open(), 350);
      this.asked = true;
    }
  }

  _reveal() {
    if (!this.enabled) return;
    this.els.button.hidden = false;
    if (this.els.card) this.els.card.hidden = false;
  }

  // ---------------------------------------------------------------- timing

  _record() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch { return {}; }
  }

  /**
   * Ask at the one moment the answer is likely to be yes: straight after a take
   * has worked, when they have just watched their own voice turn into text.
   * Asking on arrival, before the app has proved anything, is how install
   * prompts train people to dismiss install prompts.
   */
  offerAfterSuccess() {
    if (!this.enabled || this.asked || isInstalled()) return;
    // Only iOS needs the nudge. Chromium already shows its own install affordance
    // in the address bar, and doubling up on it is nagging.
    if (!IS_IOS_SAFARI) return;

    const { n = 0, at = 0 } = this._record();
    if (n >= 2) return;                                   // asked twice, took the hint
    if (Date.now() - at < 7 * 24 * 60 * 60 * 1000) return; // not twice in a week

    this.asked = true;
    setTimeout(() => { if (!isInstalled()) this.open(); }, 1400); // let them read the transcript first
  }

  /** Closing counts as "not now" and is remembered; the button stays regardless. */
  dismiss() {
    if (IS_IOS_SAFARI && !isInstalled()) {
      const { n = 0 } = this._record();
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify({ n: n + 1, at: Date.now() }));
      } catch {}
    }
    this.close();
  }

  /** iOS fires no `appinstalled`, so the first launch from the home screen is
   * the only chance to confirm to someone that they did it right. */
  _greetOnce() {
    try {
      if (localStorage.getItem(HELLO_KEY)) return;
      localStorage.setItem(HELLO_KEY, "1");
    } catch { return; }
    setTimeout(() => this.notice("Installed. This is Tiro's own window now", "ok", 4000), 900);
  }

  // ---------------------------------------------------------------- actions

  /** The real one-tap path. Only Chromium ever gets here. */
  async install() {
    if (!this.prompt) return;
    const p = this.prompt;
    this.prompt = null; // a BeforeInstallPromptEvent can only be prompted once
    this.close();
    try {
      await p.prompt();
      const { outcome } = await p.userChoice;
      if (outcome !== "accepted") {
        // Dismissing is a decision, not an error, but the button has to keep
        // working, and the event is spent, so fall back to the written steps.
        this._reveal();
        this.notice("No problem. The Install button is in Settings when you want it", "warn");
      }
    } catch {
      this._reveal();
    }
  }

  /** For iOS browsers that are not Safari: the fix is "open this in Safari",
   * and retyping a URL on a phone is exactly where people give up. */
  async copyLink() {
    const url = location.origin + location.pathname;
    try {
      await navigator.clipboard.writeText(url);
      this.notice("Link copied. Open Safari and paste it into the address bar", "ok", 5000);
      this.close();
    } catch {
      // Clipboard refused: show the URL so it can at least be read off.
      this.notice(url, "warn", 8000);
    }
  }

  open() {
    const { sheet, lede, steps, visual, doButton, copyButton } = this.els;
    steps.textContent = "";
    visual.innerHTML = "";
    visual.hidden = true;

    const plan = this._plan();
    this.els.title.textContent = plan.title;
    lede.textContent = plan.lede;
    if (plan.visual) {
      visual.innerHTML = plan.visual; // fixed strings from this module, no user input
      visual.hidden = false;
    }
    for (const step of plan.steps) {
      const li = document.createElement("li");
      li.innerHTML = step;
      steps.appendChild(li);
    }
    doButton.hidden = !this.prompt;
    copyButton.hidden = !plan.offerCopy;

    sheet.hidden = false;
    // Focus the panel itself when there is nothing to press: putting the ring
    // on Close makes "give up" look like the recommended move.
    const primary = !doButton.hidden ? doButton : !copyButton.hidden ? copyButton : null;
    (primary || this.els.panel).focus();
  }

  close() {
    this.els.sheet.hidden = true;
  }

  /** What to actually tell this visitor. */
  _plan() {
    if (this.prompt) {
      return {
        title: "Add Tiro to your device",
        lede: "Tiro becomes a real app: its own icon, its own window, and it opens straight to the button.",
        steps: [
          "Tap <strong>Install</strong> below.",
          "Confirm in your browser's prompt.",
          IS_ANDROID
            ? "Tiro lands on your home screen and in your app drawer."
            : "Tiro lands in your Start menu. Right-click it there to pin it to the taskbar.",
        ],
      };
    }

    if (IS_IOS_SAFARI) {
      return {
        title: IS_IPAD ? "Put Tiro on your iPad" : "Put Tiro on your Home Screen",
        lede:
          "Three taps, and it stops being a website. Apple keeps this in the Share menu and gives " +
          "pages no way to open it, so here is exactly where to look:",
        visual: toolbarDiagram(),
        steps: [
          `Tap <strong>Share</strong> ${SHARE_GLYPH}, the circled button above.`,
          `Scroll the list down and tap <strong>Add to Home Screen</strong> ${PLUS_GLYPH}.`,
          "Tap <strong>Add</strong>, top right. Done: Tiro is on your home screen like any other app.",
        ],
      };
    }

    if (IS_IOS) {
      return {
        title: "Open Tiro in Safari",
        lede:
          "Only Safari can add an app to the iPhone home screen. Every other iOS browser is the " +
          "same engine underneath, but Apple leaves that row out of their share menus, so there " +
          "is nothing to tap for in this one.",
        offerCopy: true,
        steps: [
          "Tap <strong>Copy link</strong> below.",
          "Open <strong>Safari</strong> and paste it into the address bar.",
          "Tap <strong>Install</strong> there, and Tiro will walk you through the two taps.",
        ],
      };
    }

    if (IS_FIREFOX) {
      return {
        title: "Firefox does not install web apps",
        lede:
          "Tiro works perfectly in the tab here, or use Chrome, Edge or Safari to give it an icon " +
          "of its own.",
        steps: [
          "Keep using it here: everything works in a normal tab.",
          "On Windows, the <strong>Tiro for Windows</strong> download is the better answer: it types into other apps.",
        ],
      };
    }

    if (/safari/i.test(UA) && !/chrome|chromium|edg/i.test(UA)) {
      return {
        title: "Add Tiro to your Dock",
        lede: "Safari on the Mac installs web apps from the File menu.",
        steps: [
          "<strong>File → Add to Dock…</strong> in Safari's menu bar.",
          "Name it and click <strong>Add</strong>.",
          "On a Mac, though, the native <strong>Tiro for Mac</strong> app is the better one: it types into any app.",
        ],
      };
    }

    return {
      title: "Add Tiro to your device",
      lede: "Your browser can install Tiro as its own app.",
      steps: [
        `Open the browser menu ${MENU_GLYPH} and look for <strong>Install Tiro</strong> or <strong>Add to Home screen</strong>.`,
        "If you cannot find it, the app works exactly the same in a normal tab.",
      ],
    };
  }
}
