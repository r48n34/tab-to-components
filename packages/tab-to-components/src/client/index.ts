/**
 * Client entry for the click-to-components overlay.
 *
 * The Vite plugin serves this module behind a virtual id whose `load()` hook
 * prepends `globalThis.__TTC_CONFIG__ = { ... };`. Importing this module is
 * side-effectful: when the config global is present (i.e. in the browser) the
 * overlay installs itself immediately.
 */

import type { ClientConfig } from "./config";
import { install } from "./install";

export type { ChainEntry } from "./chain";
export { entryFromElement, getComponentChain, nearestComponentEntry, pickPrimaryEntry } from "./chain";
export type { ClientConfig, ModifierKey, OpenMode } from "./config";
export { DEFAULT_CONFIG, resolveConfig } from "./config";
export type { EditorTarget, EditorUrlConfig, EditorUrlInput, FetchLike, OpenInEditorOptions } from "./editor";
export {
  buildEditorUrl,
  formatEditorTarget,
  openInEditor,
  resolveEditorPath,
  resolveEditorTarget,
} from "./editor";
export type { FiberElementInfo, FiberLike } from "./fiber";
export {
  FIBER_KEY_PREFIXES,
  describeFiber,
  getFiberForElement,
  getFiberMarker,
  getFiberMarkerName,
  getFiberProps,
} from "./fiber";
export type { ModifierState } from "./install";
export { install, isModifierHeld, uninstall } from "./install";
export type { LabelInput, SourceMarker } from "./marker";
export { formatEntryLabel, formatMarker, formatNameLabel, parseMarker } from "./marker";

interface TtcEntryGlobals {
  __TTC_CONFIG__?: ClientConfig | undefined;
  __TTC_INSTALLED__?: boolean | undefined;
}

const bootGlobals = globalThis as typeof globalThis & TtcEntryGlobals;

if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  bootGlobals.__TTC_CONFIG__ !== undefined
) {
  install(bootGlobals.__TTC_CONFIG__);
}
