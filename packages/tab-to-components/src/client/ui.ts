/**
 * The overlay UI: a hover outline + source label, the component chain menu and
 * transient toasts.
 *
 * Everything lives inside a single open shadow root attached to a
 * `<div data-ttc-ui>` so app CSS can never leak in and our CSS can never leak
 * out. The host is `position: fixed` with the largest z-index we can use and
 * has `pointer-events: none`; only the menu re-enables pointer events.
 */

import type { ChainEntry } from "./chain";
import { formatMarker, formatNameLabel } from "./marker";

/** Attribute on the light-DOM host element that owns the shadow root. */
export const UI_ATTRIBUTE = "data-ttc-ui";
/** Highest practical z-index (2^31 - 1). */
export const UI_Z_INDEX = "2147483647";

const FONT_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const STYLE_TEXT = `
.ttc-outline {
  position: fixed;
  display: none;
  box-sizing: border-box;
  border: 2px solid #7aa2ff;
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(8, 10, 16, 0.55), 0 0 0 4px rgba(122, 162, 255, 0.16);
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
  border: 1px solid rgba(122, 162, 255, 0.38);
  background: rgba(16, 17, 22, 0.97);
  color: #e7e9f0;
  font: 11px/1.35 ${FONT_STACK};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  z-index: 3;
}
.ttc-label-name {
  color: #9db8ff;
  font-weight: 600;
  flex: 0 0 auto;
}
.ttc-label-source {
  color: #9aa0ae;
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
  border: 1px solid rgba(122, 162, 255, 0.4);
  background: rgba(16, 17, 22, 0.98);
  color: #e7e9f0;
  font: 11px/1.4 ${FONT_STACK};
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.6);
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
  background: rgba(122, 162, 255, 0.2);
}
.ttc-menu-name {
  flex: 0 0 auto;
  color: #9db8ff;
  font-weight: 600;
}
.ttc-menu-source {
  overflow: hidden;
  text-overflow: ellipsis;
  color: #9aa0ae;
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
  border: 1px solid rgba(122, 162, 255, 0.4);
  background: rgba(16, 17, 22, 0.98);
  color: #e7e9f0;
  font: 11px/1.4 ${FONT_STACK};
  text-align: center;
  overflow-wrap: anywhere;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  z-index: 5;
}
.ttc-toast[data-kind="error"] {
  border-color: rgba(255, 120, 120, 0.55);
  color: #ffd7d7;
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

export interface MenuOptions {
  /** Called when a row is activated (click or Enter). */
  onPick: (entry: ChainEntry, index: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Owns every overlay node. Create once per `install()` and `destroy()` it on
 * uninstall.
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
  private menuEntries: ChainEntry[] = [];
  private menuIndex = 0;
  private menuIsOpen = false;
  private onPick: ((entry: ChainEntry, index: number) => void) | null = null;
  private destroyed = false;

  constructor(doc: Document) {
    this.host = doc.createElement("div");
    this.host.setAttribute(UI_ATTRIBUTE, "");
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

  /** Open the component chain menu at viewport coordinates (x, y). */
  showMenu(entries: ChainEntry[], x: number, y: number, options: MenuOptions): void {
    if (this.destroyed || entries.length === 0) return;

    this.hideHover();
    this.menuEntries = [...entries];
    this.menuIndex = 0;
    this.onPick = options.onPick;
    this.menu.textContent = "";

    this.menuEntries.forEach((entry, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ttc-menu-item";
      row.setAttribute("role", "menuitem");

      const name = document.createElement("span");
      name.className = "ttc-menu-name";
      name.textContent = formatNameLabel(entry.name);

      const source = document.createElement("span");
      source.className = "ttc-menu-source";
      source.textContent = formatMarker(entry.marker);

      // Whitespace-only flex children are ignored visually but keep
      // textContent equal to `<Name />  file:line:column`.
      row.append(name, document.createTextNode("  "), source);
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
    const count = this.menuEntries.length;
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

  /** Activate (open) a menu row. */
  activateMenuIndex(index: number): void {
    const entry = this.menuEntries[index];
    if (!entry) return;
    const handler = this.onPick;
    this.closeMenu();
    handler?.(entry, index);
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
        this.setMenuIndex(this.menuEntries.length - 1);
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
    this.menuEntries = [];
    this.menuIndex = 0;
    this.onPick = null;
    this.menu.textContent = "";
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
    this.hideToast();
    this.destroyed = true;
    this.host.remove();
  }
}
