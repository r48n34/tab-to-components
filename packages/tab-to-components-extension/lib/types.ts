/**
 * Shared option types for the extension UI and the settings schema.
 *
 * These mirror the published Vite plugin's client config so the extension's
 * behavior (modifier keys, open modes, click actions, themes) stays familiar.
 */

/** Modifier keys the inspector understands. */
export type ModifierKey = "alt" | "ctrl" | "meta" | "shift";

/** What a modifier + left click does. */
export type OpenMode = "component" | "element" | "menu";

/** Color theme of the overlay UI. */
export type ThemeMode = "dark" | "light";

/**
 * One row of the modifier + left-click action picker.
 *
 * - `open`: hand the source location to the configured IDE.
 * - `copy-file`: copy the bare file name (`MyBox.tsx`).
 * - `copy-path`: copy the project-relative path (`app/components/MyBox.tsx`).
 * - `copy-full-path`: copy the absolute path (`D:/proj/app/components/MyBox.tsx`).
 * - `copy-location`: copy `path:line:column`.
 */
export type ClickAction =
  | "open"
  | "copy-file"
  | "copy-path"
  | "copy-full-path"
  | "copy-location";

export const MODIFIER_KEYS: readonly ModifierKey[] = [
  "alt",
  "ctrl",
  "meta",
  "shift",
];

export const OPEN_MODES: readonly OpenMode[] = ["component", "element", "menu"];

export const THEME_MODES: readonly ThemeMode[] = ["dark", "light"];

export const CLICK_ACTIONS: readonly ClickAction[] = [
  "open",
  "copy-file",
  "copy-path",
  "copy-full-path",
  "copy-location",
];

/** Actions shown by default: open the editor, copy the file name or full path. */
export const DEFAULT_CLICK_ACTIONS: readonly ClickAction[] = [
  "open",
  "copy-file",
  "copy-full-path",
];

export function isModifierKey(value: unknown): value is ModifierKey {
  return (
    typeof value === "string" &&
    (MODIFIER_KEYS as readonly string[]).includes(value)
  );
}

export function isClickAction(value: unknown): value is ClickAction {
  return (
    typeof value === "string" &&
    (CLICK_ACTIONS as readonly string[]).includes(value)
  );
}
