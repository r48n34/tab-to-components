/**
 * The actions offered by the modifier + left-click picker.
 *
 * Alt+click used to open the source immediately. It now opens a tiny action
 * sheet (by default `["open", "copy-file", "copy-full-path"]`), so the
 * developer can either jump to the editor or copy the source file name / full
 * path for a bug report or a chat message. Configuring a single action skips
 * the sheet and runs it directly.
 */

import type { ClickAction } from "./config";
import {
  fileNameOf,
  formatMarker,
  resolveFullPath,
  type SourceMarker,
} from "./marker";

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

/**
 * Secondary, right-aligned detail rendered in the action picker. `root` is the
 * injected Vite project root, used by `copy-full-path`.
 */
export function sourceActionDetail(
  action: ClickAction,
  marker: SourceMarker,
  root: string,
): string {
  switch (action) {
    case "copy-file":
      return fileNameOf(marker);
    case "copy-path":
      return marker.file;
    case "copy-full-path":
      return resolveFullPath(marker, root);
    case "open":
    case "copy-location":
      return formatMarker(marker);
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
 * Returns null for `"open"`, which is handled by the editor client.
 * `root` turns `copy-full-path` into an absolute path.
 */
export function sourceActionCopy(
  action: ClickAction,
  marker: SourceMarker,
  root: string,
): SourceActionCopy | null {
  switch (action) {
    case "open":
      return null;
    case "copy-file": {
      const text = fileNameOf(marker);
      return { text, toast: `Copied file name: ${text}` };
    }
    case "copy-path":
      return { text: marker.file, toast: `Copied path: ${marker.file}` };
    case "copy-full-path": {
      const text = resolveFullPath(marker, root);
      return { text, toast: `Copied full path: ${text}` };
    }
    case "copy-location": {
      const text = formatMarker(marker);
      return { text, toast: `Copied location: ${text}` };
    }
  }
}
