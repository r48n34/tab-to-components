/**
 * Browser-side configuration for the click-to-components overlay.
 *
 * The Vite plugin serves the bundled client behind a virtual module whose
 * `load()` hook prepends a prelude assigning `globalThis.__TTC_CONFIG__`.
 * The client reads that global on boot; tests may also pass a partial config
 * straight to `install()`.
 */

/** Modifier keys the overlay understands. */
export type ModifierKey = "alt" | "ctrl" | "meta" | "shift";

/** What a modifier + left click does. */
export type OpenMode = "component" | "element" | "menu";

/**
 * Color theme of the overlay UI.
 *
 * - `dark` (default): the original blue-on-black overlay.
 * - `light`: a blue-on-white overlay for light apps and screenshots.
 */
export type ThemeMode = "dark" | "light";

/**
 * One row of the modifier + left-click action picker.
 *
 * - `open`: ask the dev server to open the source location in the editor.
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

/** Actions shown by default: open the editor, copy the file name or full path. */
export const DEFAULT_CLICK_ACTIONS: readonly ClickAction[] = [
  "open",
  "copy-file",
  "copy-full-path",
];

/** Shape of `globalThis.__TTC_CONFIG__`, injected by the plugin. */
export interface ClientConfig {
  /** Plugin version, informational only. */
  version: string;
  /** Absolute path to the project root, forward slashes, no trailing slash. */
  root: string;
  /** Vite base: always starts and ends with "/", e.g. "/" or "/app/". */
  base: string;
  /** Modifier keys that must all be held to arm the overlay. Default ["alt"]. */
  keyboard: ModifierKey[];
  /** What a modifier + left click opens. Default "component". */
  open: OpenMode;
  /**
   * Actions offered by the modifier + left-click picker, in order. A single
   * action skips the picker and runs immediately. Default
   * `["open", "copy-file", "copy-full-path"]`.
   */
  clickActions: ClickAction[];
  /** Whether modifier + right click shows the component chain menu. Default true. */
  menu: boolean;
  /** Color theme of the overlay. Default "dark". */
  theme: ThemeMode;
  /** Endpoint path relative to `base`. Default "__open-in-editor". */
  editorEndpoint: string;
}

/** Safe defaults, used for any field the caller leaves out. */
export const DEFAULT_CONFIG: ClientConfig = {
  version: "0.0.0",
  root: "",
  base: "/",
  keyboard: ["alt"],
  open: "component",
  clickActions: [...DEFAULT_CLICK_ACTIONS],
  menu: true,
  theme: "dark",
  editorEndpoint: "__open-in-editor",
};

const MODIFIER_KEYS: readonly ModifierKey[] = ["alt", "ctrl", "meta", "shift"];
const OPEN_MODES: readonly OpenMode[] = ["component", "element", "menu"];
const THEMES: readonly ThemeMode[] = ["dark", "light"];
const CLICK_ACTIONS: readonly ClickAction[] = [
  "open",
  "copy-file",
  "copy-path",
  "copy-full-path",
  "copy-location",
];

function normalizeRoot(root: string): string {
  const slashed = root.replace(/\\/g, "/");
  if (slashed === "/" || slashed === "") return slashed;
  return slashed.replace(/\/+$/, "");
}

function normalizeBase(base: string): string {
  const trimmed = base.trim();
  let value = trimmed === "" ? "/" : trimmed;
  if (!value.startsWith("/")) value = `/${value}`;
  if (!value.endsWith("/")) value = `${value}/`;
  return value;
}

function normalizeKeyboard(keyboard: readonly unknown[] | undefined): ModifierKey[] {
  if (!Array.isArray(keyboard)) return [...DEFAULT_CONFIG.keyboard];
  const normalized: ModifierKey[] = [];
  for (const key of keyboard) {
    if (typeof key !== "string") continue;
    const lower = key.toLowerCase() as ModifierKey;
    if (MODIFIER_KEYS.includes(lower) && !normalized.includes(lower)) {
      normalized.push(lower);
    }
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_CONFIG.keyboard];
}

function normalizeOpen(open: unknown): OpenMode {
  return typeof open === "string" && OPEN_MODES.includes(open as OpenMode)
    ? (open as OpenMode)
    : DEFAULT_CONFIG.open;
}

function normalizeTheme(theme: unknown): ThemeMode {
  return typeof theme === "string" && THEMES.includes(theme as ThemeMode)
    ? (theme as ThemeMode)
    : DEFAULT_CONFIG.theme;
}

function normalizeClickActions(
  actions: readonly unknown[] | string | undefined,
): ClickAction[] {
  const raw = typeof actions === "string" ? [actions] : actions;
  if (!Array.isArray(raw)) return [...DEFAULT_CLICK_ACTIONS];
  const normalized: ClickAction[] = [];
  for (const action of raw) {
    if (typeof action !== "string") continue;
    const candidate = action as ClickAction;
    if (!CLICK_ACTIONS.includes(candidate) || normalized.includes(candidate)) {
      continue;
    }
    normalized.push(candidate);
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_CLICK_ACTIONS];
}

function normalizeEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== "string" || endpoint.trim() === "") {
    return DEFAULT_CONFIG.editorEndpoint;
  }
  return endpoint.trim().replace(/^\/+/, "");
}

/**
 * Merge a (possibly partial) config with the defaults and normalize every
 * field so downstream code can rely on the invariants documented above.
 */
export function resolveConfig(input?: Partial<ClientConfig> | null): ClientConfig {
  const source: Partial<ClientConfig> = input ?? {};
  return {
    version: typeof source.version === "string" ? source.version : DEFAULT_CONFIG.version,
    root: normalizeRoot(typeof source.root === "string" ? source.root : DEFAULT_CONFIG.root),
    base: normalizeBase(typeof source.base === "string" ? source.base : DEFAULT_CONFIG.base),
    keyboard: normalizeKeyboard(source.keyboard),
    open: normalizeOpen(source.open),
    clickActions: normalizeClickActions(source.clickActions),
    menu: source.menu === undefined ? DEFAULT_CONFIG.menu : Boolean(source.menu),
    theme: normalizeTheme(source.theme),
    editorEndpoint: normalizeEndpoint(source.editorEndpoint),
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __TTC_CONFIG__: ClientConfig | undefined;
  // eslint-disable-next-line no-var
  var __TTC_INSTALLED__: boolean | undefined;
  /** Set to true once `install()` finished attaching its listeners (e2e hook). */
  // eslint-disable-next-line no-var
  var __TTC_READY__: boolean | undefined;
  /** Plugin version from the injected config (e2e / diagnostics hook). */
  // eslint-disable-next-line no-var
  var __TTC_VERSION__: string | undefined;
}
