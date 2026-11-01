/**
 * Extension service worker (Manifest V3).
 *
 * On install/update it makes sure a normalized settings object exists in
 * `chrome.storage.local`, so every other context can read a complete one.
 *
 * "Open in IDE" no longer goes through the service worker: the extension
 * delegates it to the tab-to-components Vite plugin's dev-server endpoint, so
 * there is no editor URL to hand to the operating system from here.
 */

import { createDefaultSettings, SETTINGS_KEY } from "./lib/settings"

/** Write defaults when storage has no settings yet (first install). */
async function ensureDefaultSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY)
    if (stored[SETTINGS_KEY] === undefined) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: createDefaultSettings() })
    }
  } catch {
    // A storage failure must not break the service worker; every page falls
    // back to in-memory defaults through the settings store.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultSettings()
})
