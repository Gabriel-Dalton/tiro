// Sending a finished transcript somewhere.
//
// `navigator.share()` is one line and hands you every app on the phone, which
// is why it used to be the whole of this button. Two things that cost:
//
//   Most browsers do not have it. Firefox everywhere, and Chromium on Linux and
//   on much of the desktop, have no `navigator.share` at all, so the button was
//   hidden outright and those users had no way to send a transcript anywhere.
//
//   Where it does exist, what opens is the OS grid: recently-used apps first,
//   AirDrop, and then the three things people actually do with a transcript
//   (mail it to themselves, message it, keep the file) somewhere below the
//   fold, in a different position every time because the grid reorders itself.
//
// So the button opens this sheet instead: those three as one tap each, built on
// URL schemes every platform honours, and a row that hands off to the OS sheet
// where there is one, for the apps we cannot know about. Nothing here needs a
// network or a server; a transcript never leaves the device except into the app
// the user picks.

import { focusables, trapTab } from "./sheet.js";
import { bridge } from "./bridge.js";

const UA = navigator.userAgent;
const IS_IOS = /iphone|ipod|ipad/i.test(UA) || (/mac/i.test(UA) && navigator.maxTouchPoints > 1);
const IS_ANDROID = /android/i.test(UA);
const IS_PHONE = IS_IOS || IS_ANDROID;

// Inside the Windows shell a `mailto:` is not ours to open. WebView2 is the
// app's entire window, the host allows exactly one URL out of it (the release
// page, checked in MainForm.OnWebMessage) and refuses the rest by design, so a
// scheme row there would either do nothing or navigate the app away from
// itself. The shell's answer to "send this somewhere" is the paste it already
// does; what it still gains from this sheet is the file.
const CAN_OPEN_SCHEMES = !bridge.isShell;

// Where a `mailto:` or `sms:` body gets quietly lossy. The limit is the
// platform's, it is not the same on any two of them, and what they do past it
// is truncate without telling anyone. Past this length the full text goes to
// the clipboard as well and we say so, so a short draft is something the user
// can repair rather than a loss they find out about later.
const URI_TEXT_CAP = 1200;

/** Local time, not UTC: the file is named after the moment the person remembers. */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export class ShareSheet {
  /**
   * @param {object} els  { sheet, panel, preview, targets, closeButton }
   * @param {(text: string, tone?: string, ms?: number) => void} notice
   */
  constructor(els, notice) {
    this.els = els;
    this.notice = notice;
    this.text = "";
    this._returnTo = null;
  }

  /** Wire it up. Safe to call once, at boot. */
  start() {
    const { sheet, panel, closeButton } = this.els;
    closeButton.addEventListener("click", () => this.close());
    sheet.addEventListener("click", (e) => { if (e.target === sheet) this.close(); });
    window.addEventListener("keydown", (e) => {
      if (sheet.hidden) return;
      if (e.key === "Escape") this.close();
      else trapTab(panel, e);
    });
  }

  open(text) {
    if (!text) return;
    this.text = text;
    const { sheet, panel, preview, targets } = this.els;

    // The transcript in the face it was dictated in, so what you are about to
    // send is something you can check rather than take on trust.
    preview.textContent = text;

    targets.textContent = "";
    for (const t of this._targets()) {
      if (t.when === false) continue;
      targets.appendChild(this._row(t));
    }

    // Where to put focus back when this closes. A modal that drops you at the
    // top of the document has cost you your place on the page.
    this._returnTo = document.activeElement;
    sheet.hidden = false;
    (focusables(panel)[0] || panel).focus();
  }

  close() {
    const { sheet } = this.els;
    // Guarded, because this is also called when a new take starts: moving focus
    // back to the Share button while someone is holding Space on the talk
    // button would blur it, and a blur mid-hold ends the take.
    if (sheet.hidden) return;
    sheet.hidden = true;
    if (this._returnTo && this._returnTo.isConnected) this._returnTo.focus();
    this._returnTo = null;
  }

  // ---------------------------------------------------------------- targets

  _targets() {
    return [
      {
        icon: "i-mail",
        name: "Email",
        hint: "A new message with the transcript in it",
        when: CAN_OPEN_SCHEMES,
        run: (text) => this._openScheme(
          `mailto:?subject=${encodeURIComponent("Transcript")}&body=${encodeURIComponent(text)}`, text),
      },
      {
        icon: "i-message",
        name: "Messages",
        hint: "A new text, ready to address",
        when: IS_PHONE && CAN_OPEN_SCHEMES,
        // iOS wants `sms:&body=`, everything else `sms:?body=`. Get it wrong and
        // Messages opens on an empty draft, which reads as Tiro losing the text.
        run: (text) => this._openScheme(`sms:${IS_IOS ? "&" : "?"}body=${encodeURIComponent(text)}`, text),
      },
      {
        icon: "i-download",
        name: "Save as a text file",
        hint: IS_IOS ? "Into your Files app" : "A .txt in your downloads",
        run: (text) => this._download(text),
      },
      {
        icon: "i-share",
        name: "Other apps",
        hint: "Your device's own share sheet",
        when: !!navigator.share,
        run: (text) => {
          // Still inside the click, which is what the API requires. A cancelled
          // share rejects, and cancelling is a decision, not an error.
          navigator.share({ text }).catch(() => {});
          this.close();
        },
      },
    ];
  }

  _row(t) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "share-target";
    // fixed strings from this module, no user input
    b.innerHTML =
      `<span class="share-icon"><svg aria-hidden="true" focusable="false"><use href="#${t.icon}"/></svg></span>` +
      `<span class="share-lines"><span class="share-name">${t.name}</span>` +
      `<span class="hint">${t.hint}</span></span>`;
    b.addEventListener("click", () => t.run(this.text));
    return b;
  }

  /** `location.href` rather than `window.open`: an external scheme handled by
   * another app does not navigate this page, and a popup blocker has no say. */
  _openScheme(uri, text) {
    if (text.length > URI_TEXT_CAP) {
      navigator.clipboard.writeText(text).then(
        () => this.notice("Long transcript. It is on your clipboard too, in case the draft comes up short", "warn", 6000),
        () => {}
      );
    }
    this.close();
    location.href = uri;
  }

  _download(text) {
    const name = `tiro-${stamp()}.txt`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking straight away cancels a download that has only just started in
    // some browsers, and the failure looks like nothing happened at all.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    this.close();
    this.notice(`Saving ${name}`, "ok", 2600);
  }
}
