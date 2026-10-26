/**
 * Extension settings: schema, defaults, normalization and chrome.storage I/O.
 *
 * The schema deliberately mirrors the Vite plugin's options so the two tools
 * behave the same way. Anything read from storage is untrusted (old versions,
 * hand-edited values, another extension's leftovers), so every field is
 * validated and falls back to a safe default.
 */

import {
  DEFAULT_EDITOR_SETTING,
  isEditorPresetId,
  MAX_EDITOR_TEMPLATE_LENGTH,
  type EditorPresetId,
  type EditorSetting,
} from "./editor";
import { normalizeOrigin } from "./origin";
import {
  DEFAULT_CLICK_ACTIONS,
  isClickAction,
  isModifierKey,
  MODIFIER_KEYS,
  OPEN_MODES,
  THEME_MODES,
  type ClickAction,
  type ModifierKey,
  type OpenMode,
  type ThemeMode,
} from "./types";
import {
  isSafeAbsolutePath,
  normalizeSlashes,
  MAX_PATH_LENGTH,
} from "./source/location";

export const SETTINGS_KEY = "ttc:settings:v1";
export const SETTINGS_VERSION = 1;

export interface Settings {
  version: 1;
  /** Master switch for the overlay. */
  enabled: boolean;
  /** Origins where the developer explicitly turned the overlay off. */
  disabledOrigins: string[];
  keyboard: ModifierKey[];
  open: OpenMode;
  clickActions: ClickAction[];
  menu: boolean;
  theme: ThemeMode;
  /** Run even when the Vite plugin's own overlay is on the page (off by default). */
  showWhenVitePluginActive: boolean;
  editor: EditorSetting;
  /** Origin → absolute project root, used when a location has no absolute path. */
  projectRoots: Record<string, string>;
  /** Verbose console logging for troubleshooting. */
  debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  enabled: true,
  disabledOrigins: [],
  keyboard: ["alt"],
  open: "component",
  clickActions: [...DEFAULT_CLICK_ACTIONS],
  menu: true,
  theme: "dark",
  showWhenVitePluginActive: false,
  editor: { ...DEFAULT_EDITOR_SETTING },
  projectRoots: {},
  debug: false,
};

const MAX_ORIGINS = 128;
const MAX_PROJECT_ROOTS = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeKeyboard(value: unknown): ModifierKey[] {
  const source = Array.isArray(value) ? value : [];
  const keys: ModifierKey[] = [];
  for (const key of source) {
    if (isModifierKey(key) && !keys.includes(key)) keys.push(key);
  }
  return keys.length > 0 ? keys : [...DEFAULT_SETTINGS.keyboard];
}

function normalizeOrigins(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  const origins: string[] = [];
  for (const item of source) {
    if (typeof item !== "string") continue;
    const origin = normalizeOrigin(item);
    if (origin !== null && !origins.includes(origin)) origins.push(origin);
    if (origins.length >= MAX_ORIGINS) break;
  }
  return origins;
}

function normalizeClickActions(value: unknown): ClickAction[] {
  const source = Array.isArray(value) ? value : [];
  const actions: ClickAction[] = [];
  for (const item of source) {
    if (isClickAction(item) && !actions.includes(item)) actions.push(item);
  }
  return actions.length > 0 ? actions : [...DEFAULT_CLICK_ACTIONS];
}

function normalizeOpen(value: unknown): OpenMode {
  return typeof value === "string" && (OPEN_MODES as readonly string[]).includes(value)
    ? (value as OpenMode)
    : DEFAULT_SETTINGS.open;
}

function normalizeTheme(value: unknown): ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value)
    ? (value as ThemeMode)
    : DEFAULT_SETTINGS.theme;
}

function normalizeEditor(value: unknown): EditorSetting {
  if (!isRecord(value)) return { ...DEFAULT_EDITOR_SETTING };
  const preset: EditorPresetId = isEditorPresetId(value.preset)
    ? value.preset
    : DEFAULT_EDITOR_SETTING.preset;
  if (preset !== "custom") return { preset, template: "" };
  const rawTemplate = typeof value.template === "string" ? value.template.trim() : "";
  if (rawTemplate === "") return { ...DEFAULT_EDITOR_SETTING };
  return {
    preset: "custom",
    template: rawTemplate.slice(0, MAX_EDITOR_TEMPLATE_LENGTH),
  };
}

function normalizeProjectRoots(value: unknown): Record<string, string> {
  const roots: Record<string, string> = {};
  if (!isRecord(value)) return roots;
  for (const [rawOrigin, rawRoot] of Object.entries(value)) {
    if (typeof rawRoot !== "string") continue;
    const origin = normalizeOrigin(rawOrigin);
    if (origin === null) continue;
    const normalized = normalizeSlashes(rawRoot.trim()).replace(/\/+$/, "");
    if (!isSafeAbsolutePath(normalized) || normalized.length > MAX_PATH_LENGTH) {
      continue;
    }
    roots[origin] = normalized;
    if (Object.keys(roots).length >= MAX_PROJECT_ROOTS) break;
  }
  return roots;
}

/** Merge arbitrary stored data into a valid, fully-populated settings object. */
export function normalizeSettings(input: unknown): Settings {
  const source = isRecord(input) ? input : {};
  return {
    version: SETTINGS_VERSION,
    enabled:
      typeof source.enabled === "boolean" ? source.enabled : DEFAULT_SETTINGS.enabled,
    disabledOrigins: normalizeOrigins(source.disabledOrigins),
    keyboard: normalizeKeyboard(source.keyboard),
    open: normalizeOpen(source.open),
    clickActions: normalizeClickActions(source.clickActions),
    menu: typeof source.menu === "boolean" ? source.menu : DEFAULT_SETTINGS.menu,
    theme: normalizeTheme(source.theme),
    showWhenVitePluginActive:
      typeof source.showWhenVitePluginActive === "boolean"
        ? source.showWhenVitePluginActive
        : DEFAULT_SETTINGS.showWhenVitePluginActive,
    editor: normalizeEditor(source.editor),
    projectRoots: normalizeProjectRoots(source.projectRoots),
    debug: typeof source.debug === "boolean" ? source.debug : DEFAULT_SETTINGS.debug,
  };
}

/** Whether the overlay should stay off for `origin`. */
export function isOriginDisabled(settings: Settings, origin: string | null): boolean {
  if (!settings.enabled) return true;
  if (origin === null) return false;
  return settings.disabledOrigins.includes(origin);
}

/** The configured absolute project root for `origin`, if any. */
export function projectRootFor(settings: Settings, origin: string | null): string | null {
  if (origin === null) return null;
  return settings.projectRoots[origin] ?? null;
}

/** Return a copy of `settings` with `origin` enabled or disabled. */
export function setOriginDisabled(
  settings: Settings,
  origin: string,
  disabled: boolean,
): Settings {
  const normalized = normalizeOrigin(origin);
  if (normalized === null) return settings;
  const origins = settings.disabledOrigins.filter((item) => item !== normalized);
  if (disabled) origins.push(normalized);
  return { ...settings, disabledOrigins: origins };
}

/** The default settings written on first install. */
export function createDefaultSettings(): Settings {
  return normalizeSettings(undefined);
}

/* ------------------------------------------------------------------------- */
/* chrome.storage access                                                      */
/* ------------------------------------------------------------------------- */

export type StorageListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  areaName: string,
) => void;

export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface StorageChangedLike {
  addListener(listener: StorageListener): void;
  removeListener(listener: StorageListener): void;
}

/** The subset of `chrome.storage` used by the extension. */
export interface ChromeStorageLike {
  local: StorageAreaLike;
  onChanged: StorageChangedLike;
}

export interface SettingsStore {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
  watch(listener: (settings: Settings) => void): () => void;
}

/** In-memory store used when chrome.storage is unavailable (tests, previews). */
export function createMemorySettingsStore(initial?: unknown): SettingsStore {
  let settings = normalizeSettings(initial);
  const listeners = new Set<(settings: Settings) => void>();
  return {
    async load() {
      return settings;
    },
    async save(next) {
      settings = normalizeSettings(next);
      for (const listener of listeners) listener(settings);
    },
    watch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createChromeSettingsStore(
  api: ChromeStorageLike = (globalThis as unknown as { chrome?: { storage?: ChromeStorageLike } })
    .chrome?.storage as ChromeStorageLike,
): SettingsStore {
  if (!api || !api.local || !api.onChanged) return createMemorySettingsStore();
  return {
    async load() {
      const result = await api.local.get(SETTINGS_KEY);
      return normalizeSettings(result[SETTINGS_KEY]);
    },
    async save(settings) {
      await api.local.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
    },
    watch(listener) {
      const handler: StorageListener = (changes, areaName) => {
        if (areaName !== "local" || !(SETTINGS_KEY in changes)) return;
        listener(normalizeSettings(changes[SETTINGS_KEY]?.newValue));
      };
      api.onChanged.addListener(handler);
      return () => api.onChanged.removeListener(handler);
    },
  };
}

export { MODIFIER_KEYS };
