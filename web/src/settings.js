// Settings and key storage. In a browser everything lives in localStorage on
// this device only. The key never touches a server (load-bearing decision,
// see ROADMAP.md non-goals). Inside the Windows shell the API key is instead
// held by the host in DPAPI, brokered over the bridge; localStorage there is
// only a cache the host refreshes at startup.

import { bridge } from "./bridge.js";

const KEY_APIKEY = "tiro.apiKey";
const KEY_SETTINGS = "tiro.settings";

const DEFAULTS = {
  micWarm: true,        // keep the mic open while idle so pre-roll works
  desktopHotkey: false, // hold-to-talk key while the tab is focused (browser only)
  hotkeyCode: "AltRight",
  seenSetup: false,
};

export function getApiKey() {
  return localStorage.getItem(KEY_APIKEY) || "";
}

export async function setApiKey(key) {
  if (key) localStorage.setItem(KEY_APIKEY, key);
  else localStorage.removeItem(KEY_APIKEY);
  if (bridge.isShell) await bridge.storeKey(key); // DPAPI, current-user scope
}

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY_SETTINGS) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setSetting(name, value) {
  const s = getSettings();
  s[name] = value;
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
  if (bridge.isShell && name === "hotkeyCode") bridge.setHotkey(value);
  return s;
}

export function clearAllSettings() {
  localStorage.removeItem(KEY_APIKEY);
  localStorage.removeItem(KEY_SETTINGS);
}
