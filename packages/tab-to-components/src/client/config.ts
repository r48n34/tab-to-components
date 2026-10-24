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
  /** Whether modifier + right click shows the component chain menu. Default true. */
  menu: boolean;
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
  menu: true,
  editorEndpoint: "__open-in-editor",
};

const MODIFIER_KEYS: readonly ModifierKey[] = ["alt", "ctrl", "meta", "shift"];
const OPEN_MODES: readonly OpenMode[] = ["component", "element", "menu"];

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
    menu: source.menu === undefined ? DEFAULT_CONFIG.menu : Boolean(source.menu),
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
