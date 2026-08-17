// What a modal sheet has to do besides look like one. Both sheets in the app
// (install, share) use this, so the behaviour cannot drift between them: the
// second one was written by copying the first, and a copy is where a keyboard
// trap quietly stops matching the dialog that has the focus.

/** Every control inside `panel` that is actually on screen and reachable. */
export function focusables(panel) {
  const all = panel.querySelectorAll(
    'button:not([hidden]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  return [...all].filter((el) => el.offsetParent !== null);
}

/** Tab must not walk out of an `aria-modal` dialog into the page behind it: the
 * page is inert to a screen reader, so a keyboard user would be moving through
 * controls that are, as far as the announcement goes, not there. */
export function trapTab(panel, e) {
  if (e.key !== "Tab") return;
  const list = focusables(panel);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  const on = document.activeElement;
  if (e.shiftKey && (on === first || on === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && on === last) {
    e.preventDefault();
    first.focus();
  }
}

/** True while any sheet is up. Escape means "close this" then, and the handlers
 * further down the page (dismiss the toast, discard the take) have to stand
 * down rather than firing on the same key press. */
export function sheetIsOpen() {
  return !!document.querySelector(".sheet:not([hidden])");
}
