/**
 * The actions offered by the modifier + left-click picker.
 *
 * Alt+click used to open the source immediately. It now opens a tiny action
 * sheet (by default `["open", "copy-file", "copy-full-path"]`), so the
 * developer can either jump to the editor or copy the source file name / full
 * path for a bug report or a chat message. Configuring a single action skips
 * the sheet and runs it directly.
 */

import { IDE_LABELS, type ClickAction, type EditorIde } from "./config";
import type { MenuIconName } from "./icons";
import {
  fileNameOf,
  formatMarker,
  resolveFullPath,
  type SourceMarker,
} from "./marker";

export { IDE_LABELS };

/** IDE a per-IDE open action launches, or `null` for `open` and the copy actions. */
export function sourceActionIde(action: ClickAction): EditorIde | null {
  switch (action) {
    case "open-code":
      return "code";
    case "open-cursor":
      return "cursor";
    case "open-webstorm":
      return "webstorm";
    case "open-trae":
      return "trae";
    default:
      return null;
  }
}

/**
 * Icon rendered before the primary label in the action picker. Each action
 * points at what it acts on: the editor, the file, a relative/full path or the
 * `file:line:column` location.
 */
export function sourceActionIcon(action: ClickAction): MenuIconName {
  switch (action) {
    case "open":
      return "open";
    case "open-code":
      return "open-code";
    case "open-cursor":
      return "open-cursor";
    case "open-webstorm":
      return "open-webstorm";
    case "open-trae":
      return "open-trae";
    case "copy-file":
      return "copy-file";
    case "copy-path":
      return "copy-path";
    case "copy-full-path":
      return "copy-full-path";
    case "copy-location":
      return "copy-location";
  }
}

/** Primary label rendered in the action picker. */
export function sourceActionLabel(action: ClickAction): string {
  switch (action) {
    case "open":
      return "Open in IDE";
    case "open-code":
      return `Open in ${IDE_LABELS.code}`;
    case "open-cursor":
      return `Open in ${IDE_LABELS.cursor}`;
    case "open-webstorm":
      return `Open in ${IDE_LABELS.webstorm}`;
    case "open-trae":
      return `Open in ${IDE_LABELS.trae}`;
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
    case "open-code":
    case "open-cursor":
    case "open-webstorm":
    case "open-trae":
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
 * Returns null for every `open*` action, which the editor client handles.
 * `root` turns `copy-full-path` into an absolute path.
 */
export function sourceActionCopy(
  action: ClickAction,
  marker: SourceMarker,
  root: string,
): SourceActionCopy | null {
  switch (action) {
    case "open":
    case "open-code":
    case "open-cursor":
    case "open-webstorm":
    case "open-trae":
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
