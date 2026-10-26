/**
 * The actions offered by the modifier + left-click picker.
 *
 * Ported from the Vite plugin's `src/client/actions.ts`, but the input is a
 * resolved entry: the extension can recover a source location from React debug
 * metadata, and a location may carry only a project-relative path, only an
 * absolute path, or both. The configured project root is optional, so
 * `copy-full-path` can fail to produce an absolute path; the action picker
 * shows a short hint instead and the action is reported as unavailable.
 */

import {
  displayFileOf,
  fileNameOf,
  formatLocation,
  resolveAbsoluteLocation,
  type SourceLocation,
} from "./source/location";
import type { ResolvedEntry } from "./source/types";
import type { ClickAction } from "./types";

/** Detail shown when an entry has no source location to offer. */
export const NO_LOCATION_DETAIL = "(no source location)";
/** Detail shown for `copy-full-path` when no absolute path can be produced. */
export const SET_PROJECT_ROOT_DETAIL = "(set a project root)";

/** Primary label rendered in the action picker. */
export function sourceActionLabel(action: ClickAction): string {
  switch (action) {
    case "open":
      return "Open in IDE";
    case "copy-file":
      return "Copy file name";
    case "copy-path":
      return "Copy relative path";
    case "copy-full-path":
      return "Copy full path";
    case "copy-location":
      return "Copy file:line:column";
  }
}

/** The relative path a copy action would use, when one is known. */
function relativePathOf(location: SourceLocation): string {
  return location.relativeFile ?? location.file;
}

/**
 * Secondary, right-aligned detail rendered in the action picker: the exact text
 * the action would copy. When no value can be produced a short parenthesized
 * hint is shown instead (missing location / missing project root).
 */
export function sourceActionDetail(
  action: ClickAction,
  entry: ResolvedEntry,
  root: string | null,
): string {
  const location = entry.location;
  if (location === null) return NO_LOCATION_DETAIL;
  switch (action) {
    case "copy-file":
      return fileNameOf(displayFileOf(location));
    case "copy-path":
      return relativePathOf(location);
    case "copy-full-path":
      return resolveAbsoluteLocation(location, root) ?? SET_PROJECT_ROOT_DETAIL;
    case "open":
    case "copy-location":
      return formatLocation(location);
  }
}

/** What a copy action writes, or null for the editor action. */
export interface SourceActionCopy {
  /** Exact clipboard text. */
  text: string;
  /** Confirmation toast, e.g. `Copied file name: Button.tsx`. */
  toast: string;
}

/**
 * Resolve a copy action to its clipboard text and confirmation message.
 * Returns null for `"open"` (handled by the editor client) and whenever there
 * is nothing to copy (no location, or no absolute path for `copy-full-path`).
 */
export function sourceActionCopy(
  action: ClickAction,
  entry: ResolvedEntry,
  root: string | null,
): SourceActionCopy | null {
  const location = entry.location;
  if (location === null) return null;
  switch (action) {
    case "open":
      return null;
    case "copy-file": {
      const text = fileNameOf(displayFileOf(location));
      return { text, toast: `Copied file name: ${text}` };
    }
    case "copy-path": {
      const text = relativePathOf(location);
      return { text, toast: `Copied path: ${text}` };
    }
    case "copy-full-path": {
      const text = resolveAbsoluteLocation(location, root);
      if (text === null) return null;
      return { text, toast: `Copied full path: ${text}` };
    }
    case "copy-location": {
      const text = formatLocation(location);
      return { text, toast: `Copied location: ${text}` };
    }
  }
}

/**
 * Whether an action can run for `entry`.
 *
 * Every copy action needs a source location; `open` and `copy-full-path` also
 * need a resolvable absolute path (a known absolute file, or a configured
 * project root plus a relative file).
 */
export function sourceActionAvailable(
  action: ClickAction,
  entry: ResolvedEntry,
  root: string | null,
): boolean {
  const location = entry.location;
  if (location === null) return false;
  if (action === "open" || action === "copy-full-path") {
    return resolveAbsoluteLocation(location, root) !== null;
  }
  return true;
}
