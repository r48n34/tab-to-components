/**
 * The overlay UI: a hover outline + source label, the component chain menu and
 * transient toasts.
 *
 * Everything lives inside a single open shadow root attached to a
 * `<div data-ttc-ui>` so app CSS can never leak in and our CSS can never leak
 * out. The host is `position: fixed` with the largest z-index we can use and
 * has `pointer-events: none`; only the menu re-enables pointer events.
 *
 * Ported from the Vite plugin's `src/client/ui.ts`. The DOM contract is kept
 * identical, and the host additionally carries `data-ttc-ext` so the extension
 * can tell its own overlay from the Vite plugin's when both are on the page.
 */

import { formatNameLabel } from "../source/location";
import type { CrosshairMode, CrosshairUnit, ThemeMode } from "../types";
import { createMenuIcon, type MenuIconName } from "./icons";

/** Attribute on the light-DOM host element that owns the shadow root. */
export const UI_ATTRIBUTE = "data-ttc-ui";
/** Attribute on the host element carrying the overlay theme: `dark` or `light`. */
export const THEME_ATTRIBUTE = "data-ttc-theme";
/** Marker attribute telling the extension's overlay apart from the Vite plugin's. */
export const EXT_ATTRIBUTE = "data-ttc-ext";
/** Attribute carrying the active crosshair mode. */
export const CROSSHAIR_ATTRIBUTE = "data-ttc-crosshair";
/** Attribute carrying the space-separated crosshair readout units. */
export const CROSSHAIR_UNIT_ATTRIBUTE = "data-ttc-crosshair-unit";
/** Highest practical z-index (2^31 - 1). */
export const UI_Z_INDEX = "2147483647";

/** Selector for the Vite plugin's overlay host (the extension's is excluded). */
export const FOREIGN_PLUGIN_OVERLAY_SELECTOR = `[${UI_ATTRIBUTE}]:not([${EXT_ATTRIBUTE}])`;

const PLUGIN_OVERLAY_STYLE_ID = "ttc-ext-hide-plugin-overlay";

/**
 * Hide the Vite plugin's own overlay while the extension provides the UI.
 *
 * Used when the developer asked the extension to run even though the plugin's
 * overlay is on the page: the plugin would otherwise draw a second outline /
 * menu for the same element. A single `!important` style sheet covers hosts
 * that are added later, and the plugin's own inline `display` cannot beat it.
 * Never touches the extension's host (it carries `data-ttc-ext`).
 */
export function setForeignPluginOverlayHidden(doc: Document, hidden: boolean): void {
  const existing = doc.getElementById(PLUGIN_OVERLAY_STYLE_ID);
  if (!hidden) {
    existing?.remove();
    return;
  }
  if (existing !== null) return;
  const style = doc.createElement("style");
  style.id = PLUGIN_OVERLAY_STYLE_ID;
  style.textContent = `${FOREIGN_PLUGIN_OVERLAY_SELECTOR} { display: none !important; }`;
  (doc.head ?? doc.documentElement).append(style);
}

const FONT_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/*
 * The palette is a set of custom properties so the whole overlay (outline,
 * label, menu and toast) switches with one attribute on the shadow host.
 * Dark is the original blue-on-black design and is also the default when the
 * attribute is missing; light darkens the blue accents for contrast on white.
 */
const STYLE_TEXT = `
:host {
  --ttc-accent: #7aa2ff;
  --ttc-accent-text: #9db8ff;
  --ttc-border: rgba(122, 162, 255, 0.4);
  --ttc-border-label: rgba(122, 162, 255, 0.38);
  --ttc-surface: rgba(16, 17, 22, 0.98);
  --ttc-surface-label: rgba(16, 17, 22, 0.97);
  --ttc-text: #e7e9f0;
  --ttc-muted: #9aa0ae;
  --ttc-outline-ring: rgba(8, 10, 16, 0.55);
  --ttc-outline-glow: rgba(122, 162, 255, 0.16);
  --ttc-active: rgba(122, 162, 255, 0.2);
  --ttc-shadow-label: rgba(0, 0, 0, 0.4);
  --ttc-shadow-menu: rgba(0, 0, 0, 0.55);
  --ttc-shadow-menu-edge: rgba(0, 0, 0, 0.6);
  --ttc-shadow-toast: rgba(0, 0, 0, 0.5);
  --ttc-error-border: rgba(255, 120, 120, 0.55);
  --ttc-error-text: #ffd7d7;
  --ttc-crosshair-line: rgba(231, 233, 240, 0.55);
  --ttc-crosshair-tag-bg: #e7e9f0;
  --ttc-crosshair-tag-text: #0e1016;
  --ttc-color-scheme: dark;
}
:host([data-ttc-theme="light"]) {
  --ttc-accent: #2f5bd7;
  --ttc-accent-text: #2456c7;
  --ttc-border: rgba(47, 91, 215, 0.35);
  --ttc-border-label: rgba(47, 91, 215, 0.32);
  --ttc-surface: rgba(255, 255, 255, 0.98);
  --ttc-surface-label: rgba(255, 255, 255, 0.97);
  --ttc-text: #1b2130;
  --ttc-muted: #5b6472;
  --ttc-outline-ring: rgba(15, 23, 42, 0.16);
  --ttc-outline-glow: rgba(47, 91, 215, 0.14);
  --ttc-active: rgba(47, 91, 215, 0.12);
  --ttc-shadow-label: rgba(15, 23, 42, 0.16);
  --ttc-shadow-menu: rgba(15, 23, 42, 0.18);
  --ttc-shadow-menu-edge: rgba(15, 23, 42, 0.08);
  --ttc-shadow-toast: rgba(15, 23, 42, 0.16);
  --ttc-error-border: rgba(190, 35, 35, 0.45);
  --ttc-error-text: #b42318;
  --ttc-crosshair-line: rgba(27, 33, 48, 0.35);
  --ttc-crosshair-tag-bg: #1b2130;
  --ttc-crosshair-tag-text: #f7f8fb;
  --ttc-color-scheme: light;
}
.ttc-outline {
  position: fixed;
  display: none;
  box-sizing: border-box;
  border: 2px solid var(--ttc-accent);
  border-radius: 3px;
  box-shadow: 0 0 0 1px var(--ttc-outline-ring), 0 0 0 4px var(--ttc-outline-glow);
  pointer-events: none;
  z-index: 2;
  will-change: left, top, width, height;
}
.ttc-label {
  position: fixed;
  display: none;
  align-items: baseline;
  gap: 8px;
  max-width: min(640px, calc(100vw - 24px));
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--ttc-border-label);
  background: var(--ttc-surface-label);
  color: var(--ttc-text);
  font: 11px/1.35 ${FONT_STACK};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 8px 24px var(--ttc-shadow-label);
  pointer-events: none;
  z-index: 3;
}
.ttc-label-name {
  color: var(--ttc-accent-text);
  font-weight: 600;
  flex: 0 0 auto;
}
.ttc-label-source {
  color: var(--ttc-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}
.ttc-menu {
  position: fixed;
  display: none;
  box-sizing: border-box;
  min-width: 220px;
  max-width: min(720px, calc(100vw - 16px));
  max-height: min(60vh, 420px);
  overflow: auto;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--ttc-border);
  background: var(--ttc-surface);
  color: var(--ttc-text);
  font: 11px/1.4 ${FONT_STACK};
  /* Set through a custom property: the host's inline all: initial reset wins
     over a :host color-scheme declaration. This only affects the menu's
     scrollbars. */
  color-scheme: var(--ttc-color-scheme);
  box-shadow: 0 16px 48px var(--ttc-shadow-menu), 0 0 0 1px var(--ttc-shadow-menu-edge);
  pointer-events: auto;
  z-index: 4;
  outline: none;
}
.ttc-menu-item {
  display: flex;
  align-items: baseline;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
}
.ttc-menu-item[data-active] {
  background: var(--ttc-active);
}
.ttc-menu-icon {
  flex: 0 0 auto;
  align-self: center;
  width: 14px;
  height: 14px;
  color: var(--ttc-muted);
}
.ttc-menu-item[data-active] .ttc-menu-icon {
  color: var(--ttc-accent-text);
}
.ttc-menu-name {
  flex: 0 0 auto;
  color: var(--ttc-accent-text);
  font-weight: 600;
}
.ttc-menu-source {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ttc-muted);
}
.ttc-toast {
  position: fixed;
  display: none;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  box-sizing: border-box;
  max-width: min(720px, calc(100vw - 32px));
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--ttc-border);
  background: var(--ttc-surface);
  color: var(--ttc-text);
  font: 11px/1.4 ${FONT_STACK};
  text-align: center;
  overflow-wrap: anywhere;
  box-shadow: 0 12px 32px var(--ttc-shadow-toast);
  pointer-events: none;
  z-index: 5;
}
.ttc-toast[data-kind="error"] {
  border-color: var(--ttc-error-border);
  color: var(--ttc-error-text);
}
/* Cursor crosshair ruler: one vertical and one horizontal 1px line plus a
   coordinate pill at the top and on the left. It sits below the outline and
   labels (z-index 1) and never receives pointer events. */
.ttc-crosshair {
  position: fixed;
  inset: 0;
  display: none;
  pointer-events: none;
  z-index: 1;
}
.ttc-crosshair-v {
  position: fixed;
  top: 0;
  width: 1px;
  height: 100%;
  background: var(--ttc-crosshair-line);
}
.ttc-crosshair-h {
  position: fixed;
  left: 0;
  height: 1px;
  width: 100%;
  background: var(--ttc-crosshair-line);
}
.ttc-crosshair-tag {
  position: fixed;
  box-sizing: border-box;
  min-width: 44px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--ttc-crosshair-tag-bg);
  color: var(--ttc-crosshair-tag-text);
  font: 11px/1.35 ${FONT_STACK};
  font-variant-numeric: tabular-nums;
  text-align: center;
  white-space: nowrap;
  box-shadow: 0 2px 8px var(--ttc-shadow-label);
  pointer-events: none;
}
.ttc-crosshair-tag-x {
  top: 4px;
  transform: translateX(-50%);
}
.ttc-crosshair-tag-y {
  left: 4px;
  transform: translateY(-50%);
}
.ttc-crosshair-segment {
  position: fixed;
  height: 2px;
  background: var(--ttc-crosshair-line);
  transform-origin: 0 50%;
  pointer-events: none;
}
.ttc-crosshair-point {
  position: fixed;
  box-sizing: border-box;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--ttc-crosshair-tag-text);
  background: var(--ttc-crosshair-line);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 1px var(--ttc-shadow-label);
  pointer-events: none;
}
.ttc-crosshair-distance {
  position: fixed;
  box-sizing: border-box;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--ttc-crosshair-tag-bg);
  color: var(--ttc-crosshair-tag-text);
  font: 11px/1.35 ${FONT_STACK};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transform: translate(-50%, -50%);
  box-shadow: 0 2px 8px var(--ttc-shadow-label);
  pointer-events: none;
}
`;

/** What the hover label needs on each animation frame. */
export interface HoverPresentation {
  /** Viewport-relative rect of the element to outline. */
  rect: { left: number; top: number; width: number; height: number };
  /** `button`, `Button`, … */
  name: string;
  /** `file:line:column`, or "" when no marker is available. */
  source: string;
  /** Cursor x in viewport coordinates. */
  x: number;
  /** Cursor y in viewport coordinates. */
  y: number;
}

export interface ToastOptions {
  /** Error toasts stay a little longer and turn red. */
  error?: boolean;
  /** Milliseconds before the toast hides. Defaults to 1500. */
  duration?: number;
}

/** One row of the overlay's floating menu (chain picker or action picker). */
export interface MenuItem {
  /** Primary label: `<Button />` for chain rows, `Open in IDE` for actions. */
  label: string;
  /** Secondary detail: the source marker or the text a copy action writes. */
  detail: string;
  /** Optional `data-action` value exposing the row kind to tests. */
  action?: string;
  /** Optional icon rendered before the label (decorative, see `icons.ts`). */
  icon?: MenuIconName;
  /** Run when the row is clicked or activated with Enter/Space. */
  onActivate: () => void;
}

export interface MenuOptions {
  /** `"chain"` (right click) or `"actions"` (left click), exposed in the DOM. */
  kind?: "chain" | "actions";
  /** Accessible label for the menu element. */
  ariaLabel?: string;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Optional colors for the crosshair ruler; unset values use the theme. */
export interface CrosshairColors {
  /** CSS color of the ruler lines and the coordinate pill background. */
  line?: string;
  /** CSS color of the coordinate pill text. */
  text?: string;
}

/** One measurement point placed by the crosshair point key. */
interface CrosshairPoint {
  x: number;
  y: number;
}

/** Nodes created for the crosshair ruler (hidden until a pointer arrives). */
interface CrosshairNodes {
  box: HTMLDivElement;
  vertical: HTMLDivElement;
  horizontal: HTMLDivElement;
  tagX: HTMLDivElement;
  tagY: HTMLDivElement;
  /** Holds points, connecting segments and distance labels. */
  points: HTMLDivElement;
}

/** Half of the pill's 44px minimum width, for edge clamping. */
const TAG_HALF_WIDTH = 22;
/** Half of the pill's 20px line box, for edge clamping. */
const TAG_HALF_HEIGHT = 10;
/** Gap kept between a pill and the viewport edge. */
const TAG_EDGE = 4;
/** Perpendicular offset of a segment's distance label from the line. */
const DISTANCE_OFFSET = 14;

/** CSS reference pixel: browsers define 1in as exactly 96px. */
const PX_PER_INCH = 96;
const PX_PER_CM = PX_PER_INCH / 2.54;
const PX_PER_MM = PX_PER_CM / 10;
const FALLBACK_ROOT_FONT_SIZE = 16;
/** Separator between the units shown in one pill. */
const UNIT_SEPARATOR = " · ";

/** Fixed-decimal number without trailing zeros (`7.90` → `7.9`, `80.00` → `80`). */
function trimNumber(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

/** Format a viewport CSS-pixel coordinate in the configured readout unit. */
export function formatCrosshairValue(
  value: number,
  unit: CrosshairUnit,
  rootFontSize = FALLBACK_ROOT_FONT_SIZE,
): string {
  switch (unit) {
    case "cm":
      return `${trimNumber(value / PX_PER_CM, 2)}cm`;
    case "mm":
      return `${trimNumber(value / PX_PER_MM, 2)}mm`;
    case "in":
      return `${trimNumber(value / PX_PER_INCH, 2)}in`;
    case "rem":
      return `${trimNumber(value / (rootFontSize || FALLBACK_ROOT_FONT_SIZE), 2)}rem`;
    case "px":
    default:
      return `${Math.round(value)}px`;
  }
}

/**
 * Owns every overlay node. Create once per inspector install and `destroy()`
 * it on uninstall.
 */
export class Overlay {
  private readonly host: HTMLDivElement;
  private readonly outline: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly labelName: HTMLSpanElement;
  private readonly labelSource: HTMLSpanElement;
  private readonly menu: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private menuItems: MenuItem[] = [];
  private menuIndex = 0;
  private menuIsOpen = false;
  private destroyed = false;
  private readonly doc: Document;
  private crosshairMode: CrosshairMode = false;
  private crosshairUnits: readonly CrosshairUnit[] = ["px"];
  private readonly crosshairNodes: CrosshairNodes;
  private readonly crosshairPoints: CrosshairPoint[] = [];

  constructor(
    doc: Document,
    theme: ThemeMode = "dark",
    crosshair: CrosshairMode = false,
    crosshairUnits: readonly CrosshairUnit[] = ["px"],
    crosshairColors: CrosshairColors = {},
  ) {
    this.doc = doc;
    this.crosshairMode = crosshair;
    this.crosshairUnits = crosshairUnits;
    this.host = doc.createElement("div");
    this.host.setAttribute(UI_ATTRIBUTE, "");
    this.host.setAttribute(EXT_ATTRIBUTE, "");
    this.host.setAttribute(THEME_ATTRIBUTE, theme);
    this.host.style.cssText = [
      "all: initial",
      "position: fixed",
      "inset: 0",
      `z-index: ${UI_Z_INDEX}`,
      "display: block",
      "pointer-events: none",
      "margin: 0",
      "padding: 0",
      "border: 0",
      "background: none",
    ].join("; ");
    this.applyCrosshairColors(crosshairColors);

    const shadow = this.host.attachShadow({ mode: "open" });

    const style = doc.createElement("style");
    style.textContent = STYLE_TEXT;
    shadow.append(style);

    this.outline = doc.createElement("div");
    this.outline.className = "ttc-outline";
    shadow.append(this.outline);

    this.label = doc.createElement("div");
    this.label.className = "ttc-label";
    this.labelName = doc.createElement("span");
    this.labelName.className = "ttc-label-name";
    this.labelSource = doc.createElement("span");
    this.labelSource.className = "ttc-label-source";
    // A plain-text gap keeps the shadow root's textContent identical to
    // `formatEntryLabel` output for tooling / e2e assertions.
    this.label.append(
      this.labelName,
      doc.createTextNode("  "),
      this.labelSource,
    );
    shadow.append(this.label);

    this.menu = doc.createElement("div");
    this.menu.className = "ttc-menu";
    this.menu.setAttribute("role", "menu");
    this.menu.tabIndex = -1;
    shadow.append(this.menu);

    this.toast = doc.createElement("div");
    this.toast.className = "ttc-toast";
    this.toast.setAttribute("role", "status");
    this.toast.setAttribute("aria-live", "polite");
    shadow.append(this.toast);

    const box = doc.createElement("div");
    box.className = "ttc-crosshair";
    box.setAttribute("aria-hidden", "true");
    const vertical = doc.createElement("div");
    vertical.className = "ttc-crosshair-v";
    const horizontal = doc.createElement("div");
    horizontal.className = "ttc-crosshair-h";
    const tagX = doc.createElement("div");
    tagX.className = "ttc-crosshair-tag ttc-crosshair-tag-x";
    const tagY = doc.createElement("div");
    tagY.className = "ttc-crosshair-tag ttc-crosshair-tag-y";
    const points = doc.createElement("div");
    points.className = "ttc-crosshair-points";
    box.append(vertical, horizontal, tagX, tagY, points);
    shadow.append(box);
    this.crosshairNodes = { box, vertical, horizontal, tagX, tagY, points };
    this.applyCrosshairMode(crosshair, crosshairUnits);

    const parent = doc.body ?? doc.documentElement;
    parent?.append(this.host);
  }

  /** The `[data-ttc-ui]` host element (exposed for tests / diagnostics). */
  get hostElement(): HTMLDivElement {
    return this.host;
  }

  /** The shadow root holding the overlay. */
  get root(): ShadowRoot {
    return this.host.shadowRoot as ShadowRoot;
  }

  get isMenuOpen(): boolean {
    return this.menuIsOpen;
  }

  get isConnected(): boolean {
    return !this.destroyed && this.host.isConnected;
  }

  private show(el: HTMLElement, display: "block" | "flex" = "block"): void {
    el.style.display = display;
  }

  private hide(el: HTMLElement): void {
    el.style.display = "none";
  }

  /** Apply custom ruler colors; omitted colors fall back to the theme tokens. */
  private applyCrosshairColors(colors: CrosshairColors): void {
    if (colors.line === undefined) {
      this.host.style.removeProperty("--ttc-crosshair-line");
      this.host.style.removeProperty("--ttc-crosshair-tag-bg");
    } else {
      this.host.style.setProperty("--ttc-crosshair-line", colors.line);
      this.host.style.setProperty("--ttc-crosshair-tag-bg", colors.line);
    }
    if (colors.text === undefined) {
      this.host.style.removeProperty("--ttc-crosshair-tag-text");
    } else {
      this.host.style.setProperty("--ttc-crosshair-tag-text", colors.text);
    }
  }

  private applyCrosshairMode(
    mode: CrosshairMode,
    units: readonly CrosshairUnit[],
  ): void {
    const nodes = this.crosshairNodes;
    this.hide(nodes.box);
    if (mode === false) {
      this.host.removeAttribute(CROSSHAIR_ATTRIBUTE);
      this.host.removeAttribute(CROSSHAIR_UNIT_ATTRIBUTE);
      return;
    }
    this.host.setAttribute(CROSSHAIR_ATTRIBUTE, mode);
    this.host.setAttribute(CROSSHAIR_UNIT_ATTRIBUTE, units.join(" "));
    this.show(nodes.vertical);
    this.show(nodes.horizontal);
    this.show(nodes.tagX);
    this.show(nodes.tagY);
    if (mode === "x") {
      this.hide(nodes.horizontal);
      this.hide(nodes.tagY);
    } else if (mode === "y") {
      this.hide(nodes.vertical);
      this.hide(nodes.tagX);
    }
  }

  /** Update ruler mode, units and colors without recreating the overlay. */
  configureCrosshair(
    mode: CrosshairMode,
    units: readonly CrosshairUnit[],
    colors: CrosshairColors = {},
  ): void {
    if (this.destroyed) return;
    this.crosshairMode = mode;
    this.crosshairUnits = units;
    this.applyCrosshairColors(colors);
    this.applyCrosshairMode(mode, units);
    if (mode === false) this.clearCrosshairPoints();
  }

  /** Outline `rect` and place the `<Name /> file:line:column` label by the cursor. */
  presentHover(state: HoverPresentation): void {
    if (this.destroyed || this.menuIsOpen) return;

    this.outline.style.left = `${Math.round(state.rect.left)}px`;
    this.outline.style.top = `${Math.round(state.rect.top)}px`;
    this.outline.style.width = `${Math.round(state.rect.width)}px`;
    this.outline.style.height = `${Math.round(state.rect.height)}px`;
    this.show(this.outline);

    this.labelName.textContent = formatNameLabel(state.name);
    this.labelSource.textContent = state.source;
    this.labelSource.style.display = state.source === "" ? "none" : "";
    // flex (not block) so the CSS `gap`/`align-items` and the ellipsis on the
    // path actually apply.
    this.show(this.label, "flex");
    const offset = 16;
    const margin = 8;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    const width = this.label.offsetWidth || 0;
    const height = this.label.offsetHeight || 0;
    const maxLeft = viewportWidth > 0 ? Math.max(margin, viewportWidth - width - margin) : state.x;
    const maxTop = viewportHeight > 0 ? Math.max(margin, viewportHeight - height - margin) : state.y;

    const left = clamp(state.x + offset, margin, maxLeft);
    const top = clamp(state.y + offset, margin, maxTop);
    this.label.style.left = `${left}px`;
    this.label.style.top = `${top}px`;
  }

  /** Hide the hover outline and label. */
  hideHover(): void {
    if (this.destroyed) return;
    this.hide(this.outline);
    this.hide(this.label);
  }

  /**
   * Move the crosshair ruler to viewport coordinates (x, y). Positions are
   * rounded to whole CSS pixels, the pills show every configured unit, and
   * they clamp to the viewport edges.
   */
  setCrosshair(x: number, y: number): void {
    if (this.destroyed || this.crosshairMode === false || this.menuIsOpen) return;
    const nodes = this.crosshairNodes;
    const view = this.doc.defaultView;
    const width = view?.innerWidth ?? 0;
    const height = view?.innerHeight ?? 0;
    const left = Math.round(x);
    const top = Math.round(y);
    const rootFontSize = this.crosshairRootFontSize();

    this.show(nodes.box);
    nodes.vertical.style.left = `${left}px`;
    nodes.horizontal.style.top = `${top}px`;

    nodes.tagX.textContent = this.crosshairReadout(left, rootFontSize);
    // Measure the pill after setting the text: physical units are longer than
    // a pixel count, so a fixed half-width would clip them at the edge.
    const halfWidth = (nodes.tagX.offsetWidth || TAG_HALF_WIDTH * 2) / 2;
    nodes.tagX.style.left = `${clamp(
      left,
      halfWidth + TAG_EDGE,
      width - halfWidth - TAG_EDGE,
    )}px`;
    nodes.tagY.textContent = this.crosshairReadout(top, rootFontSize);
    const halfHeight = (nodes.tagY.offsetHeight || TAG_HALF_HEIGHT * 2) / 2;
    nodes.tagY.style.top = `${clamp(
      top,
      halfHeight + TAG_EDGE,
      height - halfHeight - TAG_EDGE,
    )}px`;
  }

  /**
   * Drop a measurement point at viewport coordinates (x, y). The new point is
   * connected to the previous point only, and that segment is labelled with
   * its length in every configured unit.
   */
  addCrosshairPoint(x: number, y: number): void {
    if (this.destroyed || this.crosshairMode === false || this.menuIsOpen) return;
    const nodes = this.crosshairNodes;
    const point: CrosshairPoint = { x: Math.round(x), y: Math.round(y) };
    const previous = this.crosshairPoints[this.crosshairPoints.length - 1];
    this.crosshairPoints.push(point);

    if (previous !== undefined) {
      this.appendCrosshairSegment(previous, point, nodes.points);
    }
    const dot = this.doc.createElement("div");
    dot.className = "ttc-crosshair-point";
    dot.style.left = `${point.x}px`;
    dot.style.top = `${point.y}px`;
    nodes.points.append(dot);
    this.show(nodes.box);
  }

  /** Remove every measurement point, segment and distance label. */
  clearCrosshairPoints(): void {
    this.crosshairPoints.length = 0;
    this.crosshairNodes.points.textContent = "";
  }

  /** Hide the crosshair ruler and its points; the next pointer move shows it. */
  hideCrosshair(): void {
    this.hide(this.crosshairNodes.box);
  }

  private crosshairRootFontSize(): number {
    if (!this.crosshairUnits.includes("rem")) return FALLBACK_ROOT_FONT_SIZE;
    const view = this.doc.defaultView;
    return (
      Number.parseFloat(
        view?.getComputedStyle(this.doc.documentElement).fontSize ?? "",
      ) || FALLBACK_ROOT_FONT_SIZE
    );
  }

  private crosshairReadout(value: number, rootFontSize: number): string {
    return this.crosshairUnits
      .map((unit) => formatCrosshairValue(value, unit, rootFontSize))
      .join(UNIT_SEPARATOR);
  }

  private appendCrosshairSegment(
    start: CrosshairPoint,
    end: CrosshairPoint,
    layer: HTMLDivElement,
  ): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const angle = length === 0 ? 0 : Math.atan2(dy, dx);
    const view = this.doc.defaultView;
    const width = view?.innerWidth ?? 0;
    const height = view?.innerHeight ?? 0;

    const line = this.doc.createElement("div");
    line.className = "ttc-crosshair-segment";
    line.style.left = `${start.x}px`;
    line.style.top = `${start.y}px`;
    line.style.width = `${length}px`;
    line.style.transform = `rotate(${angle}rad)`;
    layer.append(line);

    const label = this.doc.createElement("div");
    label.className = "ttc-crosshair-distance";
    label.textContent = this.crosshairReadout(
      length,
      this.crosshairRootFontSize(),
    );
    layer.append(label);

    const halfWidth = (label.offsetWidth || TAG_HALF_WIDTH * 2) / 2;
    const halfHeight = (label.offsetHeight || TAG_HALF_HEIGHT * 2) / 2;
    // Offset the label perpendicular to the segment so it does not cover it.
    const normalX = length === 0 ? 0 : -dy / length;
    const normalY = length === 0 ? 1 : dx / length;
    const labelX = (start.x + end.x) / 2 + normalX * DISTANCE_OFFSET;
    const labelY = (start.y + end.y) / 2 + normalY * DISTANCE_OFFSET;
    label.style.left = `${clamp(
      labelX,
      halfWidth + TAG_EDGE,
      width - halfWidth - TAG_EDGE,
    )}px`;
    label.style.top = `${clamp(
      labelY,
      halfHeight + TAG_EDGE,
      height - halfHeight - TAG_EDGE,
    )}px`;
  }

  /** Show a transient message near the bottom center of the viewport. */
  showToast(message: string, options: ToastOptions = {}): void {
    if (this.destroyed) return;
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.toast.textContent = message;
    if (options.error) {
      this.toast.setAttribute("data-kind", "error");
    } else {
      this.toast.removeAttribute("data-kind");
    }
    this.show(this.toast);
    const duration = options.duration ?? 1500;
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      if (!this.destroyed) this.hide(this.toast);
    }, duration);
  }

  /** Hide the toast immediately and cancel its timer. */
  hideToast(): void {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (!this.destroyed) this.hide(this.toast);
  }

  /**
   * Open the floating menu at viewport coordinates (x, y). The same element
   * serves the component-chain picker (modifier+right-click) and the source
   * action picker (modifier+left-click); `options.kind` is exposed as
   * `data-ttc-menu`.
   */
  showMenu(
    items: MenuItem[],
    x: number,
    y: number,
    options: MenuOptions = {},
  ): void {
    if (this.destroyed || items.length === 0) return;

    this.hideHover();
    this.hideCrosshair();
    this.menuItems = [...items];
    this.menuIndex = 0;
    this.menu.textContent = "";
    this.menu.setAttribute("data-ttc-menu", options.kind ?? "chain");
    if (options.ariaLabel) this.menu.setAttribute("aria-label", options.ariaLabel);
    else this.menu.removeAttribute("aria-label");

    this.menuItems.forEach((item, index) => {
      const row = this.host.ownerDocument.createElement("button");
      row.type = "button";
      row.className = "ttc-menu-item";
      row.setAttribute("role", "menuitem");
      if (item.action !== undefined) row.setAttribute("data-action", item.action);

      // The icon is decorative and has no text content, so it does not change
      // the row's `textContent` contract (`Open in IDE  file:line:column`).
      if (item.icon !== undefined) {
        row.append(createMenuIcon(this.host.ownerDocument, item.icon));
      }

      const label = this.host.ownerDocument.createElement("span");
      label.className = "ttc-menu-name";
      label.textContent = item.label;

      const detail = this.host.ownerDocument.createElement("span");
      detail.className = "ttc-menu-source";
      detail.textContent = item.detail;

      // Whitespace-only flex children are ignored visually but keep
      // textContent equal to `<Name />  file:line:column` (chain) or
      // `Open in IDE  file:line:column` (actions).
      row.append(
        label,
        this.host.ownerDocument.createTextNode("  "),
        detail,
      );
      row.addEventListener("mouseenter", () => this.setMenuIndex(index));
      // Keep the app from seeing menu interactions, but let the click through
      // to the row listener below.
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.activateMenuIndex(index);
      });
      this.menu.append(row);
    });

    this.show(this.menu);
    this.menuIsOpen = true;
    this.setMenuIndex(0);
    this.placeMenu(x, y);

    try {
      this.menu.focus({ preventScroll: true });
    } catch {
      // Focus is a nice-to-have (keyboard events are captured on window).
    }
  }

  private placeMenu(x: number, y: number): void {
    const margin = 8;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    const width = this.menu.offsetWidth || 0;
    const height = this.menu.offsetHeight || 0;
    const maxLeft =
      viewportWidth > 0 ? Math.max(margin, viewportWidth - width - margin) : Math.max(x, margin);
    const maxTop =
      viewportHeight > 0 ? Math.max(margin, viewportHeight - height - margin) : Math.max(y, margin);
    this.menu.style.left = `${clamp(x, margin, maxLeft)}px`;
    this.menu.style.top = `${clamp(y, margin, maxTop)}px`;
  }

  /** Highlight a menu row (wraps around). */
  setMenuIndex(index: number): void {
    const count = this.menuItems.length;
    if (count === 0) return;
    this.menuIndex = ((index % count) + count) % count;
    const rows = Array.from(this.menu.children);
    rows.forEach((row, rowIndex) => {
      if (rowIndex === this.menuIndex) row.setAttribute("data-active", "");
      else row.removeAttribute("data-active");
    });
  }

  /** Index of the currently highlighted row. */
  get activeMenuIndex(): number {
    return this.menuIndex;
  }

  /** Activate a menu row (run its action after closing the menu). */
  activateMenuIndex(index: number): void {
    const item = this.menuItems[index];
    if (!item) return;
    this.closeMenu();
    item.onActivate();
  }

  /** Move the highlight by `delta` rows. */
  moveMenuIndex(delta: number): void {
    this.setMenuIndex(this.menuIndex + delta);
  }

  /**
   * Handle a keydown while the menu is open. Returns true when the event was
   * consumed (the caller should preventDefault/stopPropagation).
   */
  handleMenuKey(event: KeyboardEvent): boolean {
    if (!this.menuIsOpen) return false;
    switch (event.key) {
      case "ArrowDown":
        this.moveMenuIndex(1);
        return true;
      case "ArrowUp":
        this.moveMenuIndex(-1);
        return true;
      case "Home":
        this.setMenuIndex(0);
        return true;
      case "End":
        this.setMenuIndex(this.menuItems.length - 1);
        return true;
      case "Enter":
      case " ":
        this.activateMenuIndex(this.menuIndex);
        return true;
      case "Escape":
        this.closeMenu();
        return true;
      default:
        return false;
    }
  }

  /** Close the menu without activating a row. */
  closeMenu(): void {
    if (!this.menuIsOpen) return;
    this.menuIsOpen = false;
    this.menuItems = [];
    this.menuIndex = 0;
    this.menu.textContent = "";
    this.menu.removeAttribute("aria-label");
    this.hide(this.menu);
  }

  /** Whether a DOM event happened inside the overlay menu. */
  containsEvent(event: Event): boolean {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (path.includes(this.menu)) return true;
    const target = event.target as Node | null;
    if (!target) return false;
    // Outside a shadow root, events on menu content are retargeted to the host.
    if (target === this.host) return true;
    return typeof this.menu.contains === "function" && this.menu.contains(target);
  }

  /** Remove every node and timer. Safe to call twice. */
  destroy(): void {
    if (this.destroyed) return;
    this.closeMenu();
    this.hideHover();
    this.clearCrosshairPoints();
    this.hideCrosshair();
    this.hideToast();
    this.destroyed = true;
    this.host.remove();
  }
}
