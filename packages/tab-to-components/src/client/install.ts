/**
 * Installs the overlay: wires modifier detection, hover tracking and the
 * capture-phase click/contextmenu handlers onto the page.
 *
 * `install()` is idempotent — installing again tears the previous instance
 * down first, even if the module happened to be evaluated twice (the dispose
 * handle is parked on `globalThis`).
 */

import {
  sourceActionCopy,
  sourceActionDetail,
  sourceActionIcon,
  sourceActionLabel,
} from "./actions";
import {
  getComponentChain,
  pickPrimaryEntry,
  type ChainEntry,
} from "./chain";
import { copyText } from "./clipboard";
import type { ClickAction, ClientConfig, ModifierKey } from "./config";
import { resolveConfig } from "./config";
import { openInEditor } from "./editor";
import { formatMarker, formatNameLabel } from "./marker";
import { Overlay, type MenuItem } from "./ui";

/** Subset of a mouse/keyboard event needed to test modifier state. */
export interface ModifierState {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Internal globals shared across duplicate module instances. */
interface TtcRuntimeGlobals {
  __TTC_CONFIG__?: ClientConfig | undefined;
  __TTC_INSTALLED__?: boolean | undefined;
  __TTC_READY__?: boolean | undefined;
  __TTC_VERSION__?: string | undefined;
  __TTC_DISPOSE__?: (() => void) | undefined;
}

type RuntimeScope = typeof globalThis & TtcRuntimeGlobals;

function runtimeScope(): RuntimeScope {
  return globalThis as RuntimeScope;
}

/** True when every configured modifier is currently held. */
export function isModifierHeld(
  event: ModifierState,
  keyboard: readonly ModifierKey[],
): boolean {
  if (keyboard.length === 0) return false;
  return keyboard.every((key) => {
    switch (key) {
      case "alt":
        return event.altKey;
      case "ctrl":
        return event.ctrlKey;
      case "meta":
        return event.metaKey;
      case "shift":
        return event.shiftKey;
      default:
        return false;
    }
  });
}

function asElement(value: EventTarget | null): Element | null {
  if (value === null || typeof value !== "object") return null;
  return (value as Node).nodeType === 1 ? (value as Element) : null;
}

/** Tear down a previously installed overlay, if any. */
function disposeInstalled(): void {
  const scope = runtimeScope();
  const dispose = scope.__TTC_DISPOSE__;
  if (typeof dispose === "function") {
    try {
      dispose();
    } catch {
      // Never let a broken previous instance prevent a fresh install.
    }
  }
  scope.__TTC_DISPOSE__ = undefined;
  scope.__TTC_INSTALLED__ = false;
  scope.__TTC_READY__ = false;
}

/** Remove the overlay and all of its listeners. Safe to call when not installed. */
export function uninstall(): void {
  disposeInstalled();
}

type ListenerTarget = Window | Document;

interface RegisteredListener {
  target: ListenerTarget;
  type: string;
  listener: EventListener;
  options: boolean | AddEventListenerOptions | undefined;
}

/**
 * Install the overlay for `config` (merged over `globalThis.__TTC_CONFIG__`
 * and the defaults). Returns a cleanup function; also runs automatically from
 * the client entry module when the plugin's config prelude has run.
 */
export function install(userConfig?: Partial<ClientConfig> | null): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  disposeInstalled();

  const scope = runtimeScope();
  const config = resolveConfig({
    ...(scope.__TTC_CONFIG__ ?? {}),
    ...(userConfig ?? {}),
  });

  const overlay = new Overlay(document, config.theme);
  const listeners: RegisteredListener[] = [];

  let armed = false;
  let suppressNextClick = false;
  let hoverRaf: number | null = null;
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingTarget: Element | null = null;
  let pendingX = 0;
  let pendingY = 0;

  function listen(
    target: ListenerTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    listeners.push({ target, type, listener, options });
  }

  function cancelHover(): void {
    if (hoverRaf !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(hoverRaf);
      hoverRaf = null;
    }
    if (hoverTimeout !== null) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
  }

  function scheduleHover(): void {
    if (hoverRaf !== null || hoverTimeout !== null) return;
    if (typeof requestAnimationFrame === "function") {
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = null;
        renderHover();
      });
    } else {
      hoverTimeout = setTimeout(() => {
        hoverTimeout = null;
        renderHover();
      }, 16);
    }
  }

  function disarm(): void {
    armed = false;
    pendingTarget = null;
    cancelHover();
    overlay.hideHover();
  }

  function entryFor(element: Element): ChainEntry | null {
    return pickPrimaryEntry(getComponentChain(element), config.open);
  }

  function outlineFor(element: Element): Element {
    const marked = typeof element.closest === "function" ? element.closest("[data-ttc]") : null;
    return marked ?? element;
  }

  function renderHover(): void {
    if (!armed || pendingTarget === null) {
      overlay.hideHover();
      return;
    }
    const target = pendingTarget;
    if (!target.isConnected) {
      overlay.hideHover();
      return;
    }
    const outline = outlineFor(target);
    const entry = entryFor(target);
    const rect = outline.getBoundingClientRect();
    const tagName = typeof outline.tagName === "string" ? outline.tagName.toLowerCase() : "element";
    overlay.presentHover({
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      name: entry?.name ?? tagName,
      source: entry ? formatMarker(entry.marker) : "",
      x: pendingX,
      y: pendingY,
    });
  }

  function openEntry(entry: ChainEntry): void {
    void openInEditor(config, entry.marker, {
      onError: (message) => overlay.showToast(message, { error: true, duration: 4000 }),
    }).then((opened) => {
      if (!opened) return;
      overlay.showToast(
        `Opened ${formatNameLabel(entry.name)} ${formatMarker(entry.marker)}`,
      );
    });
  }

  function copyEntryValue(action: ClickAction, entry: ChainEntry): void {
    const copy = sourceActionCopy(action, entry.marker, config.root);
    if (copy === null) return;
    void copyText(copy.text).then((copied) => {
      if (copied) {
        overlay.showToast(copy.toast);
        return;
      }
      overlay.showToast(`Could not copy. Copy manually: ${copy.text}`, {
        error: true,
        duration: 4000,
      });
    });
  }

  function runAction(action: ClickAction, entry: ChainEntry): void {
    if (action === "open") {
      openEntry(entry);
      return;
    }
    copyEntryValue(action, entry);
  }

  /** Build the rows of the modifier + left-click action picker. */
  function actionItems(entry: ChainEntry): MenuItem[] {
    return config.clickActions.map((action) => ({
      label: sourceActionLabel(action),
      detail: sourceActionDetail(action, entry.marker, config.root),
      icon: sourceActionIcon(action),
      action,
      onActivate: () => runAction(action, entry),
    }));
  }

  /**
   * Configuring a single action keeps the pre-picker behavior: Alt+click runs
   * it immediately. Two or more actions open the picker at the cursor.
   */
  function chooseAction(entry: ChainEntry, x: number, y: number): void {
    const actions = config.clickActions;
    const first = actions[0];
    if (first === undefined) return;
    if (actions.length === 1) {
      runAction(first, entry);
      return;
    }
    disarm();
    overlay.showMenu(actionItems(entry), x, y, {
      kind: "actions",
      ariaLabel: "Source actions",
    });
  }

  function showChainMenu(target: Element, x: number, y: number): void {
    const chain = getComponentChain(target);
    if (chain.length === 0) return;
    disarm();
    overlay.showMenu(
      chain.map((entry) => ({
        label: formatNameLabel(entry.name),
        detail: formatMarker(entry.marker),
        icon: "component",
        onActivate: () => openEntry(entry),
      })),
      x,
      y,
      { kind: "chain", ariaLabel: "Component chain" },
    );
  }

  const onKeyDown: EventListener = (rawEvent) => {
    const event = rawEvent as KeyboardEvent;
    if (overlay.handleMenuKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Escape always disarms, even while the modifier is still held.
    if (event.key === "Escape") {
      disarm();
      return;
    }
    if (isModifierHeld(event, config.keyboard)) {
      armed = true;
      return;
    }
  };

  const onKeyUp: EventListener = (rawEvent) => {
    const event = rawEvent as KeyboardEvent;
    if (!isModifierHeld(event, config.keyboard)) disarm();
  };

  const onWindowBlur: EventListener = () => {
    disarm();
  };

  const onMouseMove: EventListener = (rawEvent) => {
    const event = rawEvent as MouseEvent;
    if (!isModifierHeld(event, config.keyboard)) {
      disarm();
      return;
    }
    armed = true;
    if (overlay.isMenuOpen) return;
    const target = asElement(event.target);
    if (target === null) {
      pendingTarget = null;
      cancelHover();
      overlay.hideHover();
      return;
    }
    pendingTarget = target;
    pendingX = event.clientX;
    pendingY = event.clientY;
    scheduleHover();
  };

  const onMouseDown: EventListener = (rawEvent) => {
    const event = rawEvent as MouseEvent;
    if (overlay.isMenuOpen) {
      if (overlay.containsEvent(event)) return;
      overlay.closeMenu();
      // The click that follows this mousedown only dismisses the menu. Only a
      // primary-button press produces a `click`, so arming the flag for other
      // buttons would swallow the next real click instead.
      if (event.button === 0) suppressNextClick = true;
      return;
    }
    if (!isModifierHeld(event, config.keyboard)) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onClick: EventListener = (rawEvent) => {
    const event = rawEvent as MouseEvent;
    if (suppressNextClick) {
      suppressNextClick = false;
      if (!overlay.isMenuOpen) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    // Clicks inside the menu are handled by the row listeners in the shadow root.
    if (overlay.isMenuOpen) return;
    if (!isModifierHeld(event, config.keyboard)) return;
    if (event.button !== 0) return;

    const target = asElement(event.target);
    // Suppress the app's activation even when the target has no marker: the
    // developer asked for the overlay, not for the app's button/link.
    event.preventDefault();
    event.stopPropagation();
    if (target === null) return;

    if (config.open === "menu") {
      showChainMenu(target, event.clientX, event.clientY);
      return;
    }
    const entry = entryFor(target);
    if (entry !== null) chooseAction(entry, event.clientX, event.clientY);
  };

  const onContextMenu: EventListener = (rawEvent) => {
    const event = rawEvent as MouseEvent;
    if (!config.menu) return;
    if (!isModifierHeld(event, config.keyboard)) return;
    const target = asElement(event.target);
    event.preventDefault();
    event.stopPropagation();
    if (target === null) return;
    showChainMenu(target, event.clientX, event.clientY);
  };

  const onMouseOut: EventListener = (rawEvent) => {
    const event = rawEvent as MouseEvent;
    if (event.relatedTarget === null) {
      pendingTarget = null;
      cancelHover();
      overlay.hideHover();
    }
  };

  const onScroll: EventListener = () => {
    if (overlay.isMenuOpen) overlay.closeMenu();
    pendingTarget = null;
    cancelHover();
    overlay.hideHover();
  };

  const activeOptions: AddEventListenerOptions = { capture: true };
  const passiveOptions: AddEventListenerOptions = { capture: true, passive: true };

  listen(window, "keydown", onKeyDown, activeOptions);
  listen(window, "keyup", onKeyUp, activeOptions);
  listen(window, "blur", onWindowBlur);
  listen(window, "mousemove", onMouseMove, passiveOptions);
  listen(window, "mouseout", onMouseOut, passiveOptions);
  listen(window, "mousedown", onMouseDown, activeOptions);
  listen(window, "click", onClick, activeOptions);
  listen(window, "contextmenu", onContextMenu, activeOptions);
  listen(window, "scroll", onScroll, passiveOptions);

  function cleanup(): void {
    for (const registration of listeners) {
      try {
        registration.target.removeEventListener(
          registration.type,
          registration.listener,
          registration.options,
        );
      } catch {
        // Detached windows may throw; there is nothing useful to do here.
      }
    }
    listeners.length = 0;
    armed = false;
    pendingTarget = null;
    cancelHover();
    overlay.destroy();
    // Only mutate the shared flags when this instance is still the installed
    // one (a stale cleanup must not clobber a newer install).
    if (scope.__TTC_DISPOSE__ === cleanup) {
      scope.__TTC_DISPOSE__ = undefined;
      scope.__TTC_INSTALLED__ = false;
      scope.__TTC_READY__ = false;
    }
  }

  scope.__TTC_DISPOSE__ = cleanup;
  scope.__TTC_INSTALLED__ = true;
  scope.__TTC_VERSION__ = config.version;
  // E2E hook: listeners are attached and the overlay renders nothing into the
  // app DOM until the developer arms it.
  scope.__TTC_READY__ = true;
  return cleanup;
}
