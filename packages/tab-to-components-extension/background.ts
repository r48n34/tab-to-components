/**
 * Extension service worker (Manifest V3).
 *
 * Two responsibilities:
 *
 * 1. On install/update, make sure a normalized settings object exists in
 *    `chrome.storage.local`, so every other context can read a complete one.
 * 2. Hand editor URLs to the operating system when a content script cannot
 *    (an anchor click to a custom scheme may be blocked by the page CSP). The
 *    URL is validated here, in the privileged context, before it is opened.
 */

import { isAllowedEditorUrl } from "./lib/editor"
import {
  RUNTIME_OPEN_EXTERNAL_MESSAGE,
  type OpenExternalResponse,
} from "./lib/runtime"
import { createDefaultSettings, SETTINGS_KEY } from "./lib/settings"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Shape check for the `ttc:open-external` message; anything else is ignored. */
function isOpenExternalRequest(
  value: unknown,
): value is { type: typeof RUNTIME_OPEN_EXTERNAL_MESSAGE; url: string } {
  return (
    isRecord(value) &&
    value.type === RUNTIME_OPEN_EXTERNAL_MESSAGE &&
    typeof value.url === "string"
  )
}

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

async function openExternal(url: string): Promise<OpenExternalResponse> {
  if (!isAllowedEditorUrl(url)) {
    return { ok: false, error: "Refused to open an unsupported URL." }
  }
  try {
    await chrome.tabs.create({ url })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message !== ""
          ? error.message
          : "Could not open the editor.",
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultSettings()
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isOpenExternalRequest(message)) return false
  // Returning true keeps the message channel open for the async response.
  void openExternal(message.url)
    .then(sendResponse)
    .catch(() => {
      // The sender may close the channel before the reply arrives.
    })
  return true
})
