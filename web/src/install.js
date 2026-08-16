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
// Firefox on the desktop does not install PWAs at all; it gets told so rather
// than being shown steps that lead nowhere.

const UA = navigator.userAgent;

const IS_IOS =
  /iphone|ipad|ipod/i.test(UA) ||
  // iPadOS reports itself as a Mac; the touch points give it away
  (/mac/i.test(UA) && navigator.maxTouchPoints > 1);

// On iOS every browser is Safari's engine, but only Safari itself carries
// "Add to Home Screen". Sending a Chrome-on-iPhone user through the Safari
// steps ends at a share sheet with no such row, so name the real fix.
const IS_IOS_SAFARI = IS_IOS && !/crios|fxios|edgios|opios|firefox/i.test(UA);

const IS_ANDROID = /android/i.test(UA);
const IS_FIREFOX = /firefox|fxios/i.test(UA);

/** Already installed? Then no install UI anywhere. */
export function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    navigator.standalone === true
  );
}

/** iOS Share glyph, drawn rather than described — the row is easier to find in
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

export class Installer {
  /**
   * @param {object} els  { button, sheet, panel, lede, steps, doButton, closeButton, card }
   * @param {(text: string, tone?: string) => void} notice
   */
  constructor(els, notice) {
    this.els = els;
    this.notice = notice;
    this.prompt = null;      // the stashed BeforeInstallPromptEvent
    this.enabled = false;    // false inside the Windows shell / when installed
  }

  /** Wire everything up. Safe to call once, at boot. */
  start({ isShell }) {
    const { button, sheet, doButton, closeButton, card } = this.els;

    // The Windows app *is* the installed app, and an installed PWA has nowhere
    // left to install to.
    if (isShell || isInstalled()) {
      button.hidden = true;
      if (card) card.hidden = true;
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
      this.notice("Installed — open Tiro from your home screen", "ok", 4000);
    });

    button.addEventListener("click", () => this.open());
    if (this.els.cardButton) this.els.cardButton.addEventListener("click", () => this.open());
    closeButton.addEventListener("click", () => this.close());
    doButton.addEventListener("click", () => this.install());
    sheet.addEventListener("click", (e) => { if (e.target === sheet) this.close(); });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) this.close(); });

    // iOS never fires beforeinstallprompt, so nothing above would ever show the
    // button there. Reveal it on the strength of the platform instead.
    if (IS_IOS) this._reveal();

    // Handed over from the landing page: /app/?install=1 lands with the sheet open.
    if (new URLSearchParams(location.search).get("install") === "1") {
      history.replaceState(null, "", location.pathname); // one-shot, survives reload
      setTimeout(() => this.open(), 350);
    }
  }

  _reveal() {
    if (!this.enabled) return;
    this.els.button.hidden = false;
    if (this.els.card) this.els.card.hidden = false;
  }

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
        // Dismissing is a decision, not an error — but the button has to keep
        // working, and the event is spent, so fall back to the written steps.
        this._reveal();
        this.notice("No problem — the Install button is in Settings when you want it", "warn");
      }
    } catch {
      this._reveal();
    }
  }

  open() {
    const { sheet, lede, steps, doButton } = this.els;
    steps.textContent = "";
    doButton.hidden = !this.prompt;

    const plan = this._plan();
    lede.textContent = plan.lede;
    for (const step of plan.steps) {
      const li = document.createElement("li");
      li.innerHTML = step; // fixed strings from _plan(), no user input
      steps.appendChild(li);
    }

    sheet.hidden = false;
    // focus the primary control so the sheet is operable from a keyboard
    (this.prompt ? doButton : this.els.closeButton).focus();
  }

  close() {
    this.els.sheet.hidden = true;
  }

  /** What to actually tell this visitor. */
  _plan() {
    if (this.prompt) {
      return {
        lede: "Tiro becomes a real app: its own icon, its own window, and it opens straight to the button.",
        steps: [
          "Tap <strong>Install</strong> below.",
          "Confirm in your browser's prompt.",
          IS_ANDROID
            ? "Tiro lands on your home screen and in your app drawer."
            : "Tiro lands in your Start menu — right-click it there to pin it to the taskbar.",
        ],
      };
    }

    if (IS_IOS_SAFARI) {
      return {
        lede:
          "iPhone and iPad have no one-tap install — Apple reserves it for the Share menu. " +
          "It takes two taps, and it is worth doing: an installed Tiro opens full screen and " +
          "keeps your history and key, which Safari can otherwise clear after a week unused.",
        steps: [
          `Tap the <strong>Share</strong> button ${SHARE_GLYPH} — bottom of the screen in Safari, top-right on iPad.`,
          `Scroll down and tap <strong>Add to Home Screen</strong> ${PLUS_GLYPH}.`,
          "Tap <strong>Add</strong>. Tiro is now on your home screen like any other app.",
        ],
      };
    }

    if (IS_IOS) {
      return {
        lede:
          "Only Safari can add an app to the iPhone home screen — every other iOS browser " +
          "is missing that row in the share menu, whatever it is built on.",
        steps: [
          "Open this page in <strong>Safari</strong>.",
          `Tap <strong>Share</strong> ${SHARE_GLYPH}, then <strong>Add to Home Screen</strong>.`,
          "Come back here and it will be on your home screen.",
        ],
      };
    }

    if (IS_FIREFOX) {
      return {
        lede:
          "Firefox on the desktop does not install web apps. Tiro works perfectly in the tab — " +
          "or use Chrome, Edge or Safari to get an icon of its own.",
        steps: [
          "Keep using it here: everything works in a normal tab.",
          "On Windows, the <strong>Tiro for Windows</strong> download is the better answer — it types into other apps.",
        ],
      };
    }

    if (/safari/i.test(UA) && !/chrome|chromium|edg/i.test(UA)) {
      return {
        lede: "Safari on the Mac installs web apps from the File menu.",
        steps: [
          "<strong>File → Add to Dock…</strong> in Safari's menu bar.",
          "Name it and click <strong>Add</strong>.",
          "On a Mac, though, the native <strong>Tiro for Mac</strong> app is the better one — it types into any app.",
        ],
      };
    }

    return {
      lede: "Your browser can install Tiro as its own app.",
      steps: [
        `Open the browser menu ${MENU_GLYPH} and look for <strong>Install Tiro</strong> or <strong>Add to Home screen</strong>.`,
        "If you cannot find it, the app works exactly the same in a normal tab.",
      ],
    };
  }
}
