/**
 * The full configuration the tab-to-components Vite plugin exposes on the page
 * as `globalThis.__TTC_CONFIG__`.
 *
 * `lib/plugin-editor.ts` only needs the endpoint details; this module also reads
 * the plugin's overlay options so the extension can mirror them when the user
 * picks the plugin as the settings source. The value is page-controlled, so it
 * is validated with the same normalizers as the stored extension settings.
 */

import { parsePluginInfo, type PluginInfo } from "./plugin-editor";
import { normalizeCssColor } from "./color";
import {
  DEFAULT_SETTINGS,
  normalizeClickActions,
  normalizeCrosshair,
  normalizeCrosshairPointKey,
  normalizeCrosshairUnits,
  normalizeKeyboard,
  normalizeOpen,
  normalizeTheme,
  type Settings,
} from "./settings";
import type {
  ClickAction,
  CrosshairMode,
  CrosshairUnit,
  ModifierKey,
  OpenMode,
  ThemeMode,
} from "./types";

export interface PluginConfig extends PluginInfo {
  keyboard: ModifierKey[];
  open: OpenMode;
  clickActions: ClickAction[];
  menu: boolean;
  theme: ThemeMode;
  crosshair: CrosshairMode;
  crosshairUnit: CrosshairUnit[];
  crosshairLineColor?: string;
  crosshairTextColor?: string;
  crosshairPointKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validate a page-controlled plugin config, or `null` when it is not usable. */
export function parsePluginConfig(value: unknown): PluginConfig | null {
  const info = parsePluginInfo(value);
  if (info === null || !isRecord(value)) return null;
  return {
    ...info,
    keyboard: normalizeKeyboard(value.keyboard),
    open: normalizeOpen(value.open),
    clickActions: normalizeClickActions(value.clickActions),
    menu: typeof value.menu === "boolean" ? value.menu : DEFAULT_SETTINGS.menu,
    theme: normalizeTheme(value.theme),
    crosshair: normalizeCrosshair(value.crosshair),
    crosshairUnit: normalizeCrosshairUnits(value.crosshairUnit),
    ...(normalizeCssColor(value.crosshairLineColor) === undefined
      ? {}
      : { crosshairLineColor: normalizeCssColor(value.crosshairLineColor) }),
    ...(normalizeCssColor(value.crosshairTextColor) === undefined
      ? {}
      : { crosshairTextColor: normalizeCssColor(value.crosshairTextColor) }),
    crosshairPointKey: normalizeCrosshairPointKey(value.crosshairPointKey),
  };
}

/** Read `__TTC_CONFIG__` from the page scope (MAIN world or the page object). */
export function readPluginConfig(scope: unknown): PluginConfig | null {
  if (!isRecord(scope)) return null;
  return parsePluginConfig(scope.__TTC_CONFIG__);
}

/**
 * Overlay the plugin's options on the extension settings.
 *
 * Scope, origin enablement, project roots and the master switch stay local to
 * the extension: only the options the plugin also owns are borrowed.
 */
export function applyPluginSettings(settings: Settings, plugin: PluginConfig): Settings {
  return {
    ...settings,
    keyboard: [...plugin.keyboard],
    open: plugin.open,
    clickActions: [...plugin.clickActions],
    menu: plugin.menu,
    theme: plugin.theme,
    crosshair: plugin.crosshair,
    crosshairUnit: [...plugin.crosshairUnit],
    crosshairLineColor: plugin.crosshairLineColor,
    crosshairTextColor: plugin.crosshairTextColor,
    crosshairPointKey: plugin.crosshairPointKey,
  };
}
