/**
 * `chrome.runtime` messages between the popup/options pages, the isolated
 * content script and the background service worker.
 *
 * These are separate from the page-world protocol (`lib/protocol.ts`) because
 * they travel through extension APIs and are only accepted from extension
 * pages / content scripts.
 */

import type { ReactKind } from "./protocol";

/** Popup → inspector: is the inspector running and what does it see? */
export const RUNTIME_STATUS_MESSAGE = "ttc:status";

/** Content script → background: hand an IDE URL to the OS when an anchor click
 * cannot do it (the background has no page CSP and no user-gesture limits of
 * its own, so the URL is validated before it is opened). */
export const RUNTIME_OPEN_EXTERNAL_MESSAGE = "ttc:open-external";

export interface RuntimeStatusRequest {
  type: typeof RUNTIME_STATUS_MESSAGE;
}

export interface RuntimeStatusResponse {
  ok: boolean;
  /** Whether the page has a React fiber the inspector can read. */
  hasReact: boolean;
  reactKind: ReactKind;
  /** A Vite-plugin overlay was found in the page. */
  pluginOverlay: boolean;
  /** Whether the overlay is currently enabled for this origin. */
  enabled: boolean;
  origin: string | null;
}

/** Ask the background to hand an IDE URL to the OS (anchor failures). */
export interface OpenExternalRequest {
  type: typeof RUNTIME_OPEN_EXTERNAL_MESSAGE;
  url: string;
}

export interface OpenExternalResponse {
  ok: boolean;
  error?: string;
}
