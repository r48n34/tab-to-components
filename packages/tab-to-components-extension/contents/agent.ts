/**
 * MAIN-world agent.
 *
 * Runs in the page's JavaScript world so it can read React fiber internals, and
 * it is the only side that decides whether a modifier + click is suppressed:
 * the fiber walk is synchronous, so the page's own handlers can be stopped
 * without waiting for the isolated-world inspector.
 *
 * The agent owns:
 *  - modifier arming and hover detection (`mousemove` → fiber chain),
 *  - capture-phase click / context-menu interception,
 *  - posting plain-JSON events to the inspector over `window.postMessage`.
 *
 * The inspector pushes its configuration (enabled, keyboard, menu) and owns
 * the overlay, clipboard, storage and editor launches.
 */

import type { PlasmoCSConfig } from "plasmo";

import {
  buildRawChain,
  detectReactKind,
  findFiberInDocument,
  getFiberForElement,
  type FiberLike,
} from "../lib/agent/fiber";
import { elementFromTarget, isModifierHeld } from "../lib/agent/modifiers";
import {
  createRequestIdFactory,
  PROTOCOL_VERSION,
  parseInspectorMessage,
  type AgentConfig,
  type AgentMessage,
  type RawEntry,
} from "../lib/protocol";

/**
 * Plasmo reads the `config` export statically with the TypeScript AST, which
 * cannot evaluate imported constants or spreads. The list therefore has to be a
 * local literal; `test/content-config.test.ts` keeps it in sync with
 * LOCAL_DEV_MATCHES in lib/origin.ts.
 */
const MATCHES = [
  "http://localhost/*",
  "https://localhost/*",
  "http://127.0.0.1/*",
  "https://127.0.0.1/*",
  "http://[::1]/*",
  "https://[::1]/*",
];

export const config: PlasmoCSConfig = {
  matches: MATCHES,
  all_frames: true,
  run_at: "document_start",
  world: "MAIN",
};

interface AgentGlobals {
  __TTC_AGENT__?: { dispose(): void };
}

type ListenerTarget = Window;

interface RegisteredListener {
  target: ListenerTarget;
  type: string;
  listener: EventListener;
  options: boolean | AddEventListenerOptions | undefined;
}

const nextRequestId = createRequestIdFactory();

function post(message: AgentMessage): void {
  try {
    window.postMessage(message, "*");
  } catch {
    // The page may have replaced postMessage; nothing useful to do.
  }
}

function installAgent(): (() => void) | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  let config: AgentConfig | null = null;
  let active = false;
  let armed = false;
  let menuOpen = false;
  let suppressNextClick = false;
  let hoverRaf: number | null = null;
  let pendingTarget: Element | null = null;
  let pendingX = 0;
  let pendingY = 0;
  let lastHoverHadContent = false;

  const activeListeners: RegisteredListener[] = [];
  const permanentListeners: RegisteredListener[] = [];

  function listen(
    bucket: RegisteredListener[],
    target: ListenerTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    bucket.push({ target, type, listener, options });
  }

  function removeAll(bucket: RegisteredListener[]): void {
    for (const registration of bucket) {
      try {
        registration.target.removeEventListener(
          registration.type,
          registration.listener,
          registration.options,
        );
      } catch {
        // Detached windows may throw; nothing useful to do.
      }
    }
    bucket.length = 0;
  }

  function currentStatus(): { hasReact: boolean; reactKind: "18" | "19" | "unknown" } {
    let fiber: FiberLike | null = null;
    try {
      fiber = findFiberInDocument(document);
    } catch {
      fiber = null;
    }
    return { hasReact: fiber !== null, reactKind: detectReactKind(fiber) };
  }

  function postReady(): void {
    const status = currentStatus();
    post({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-agent",
      type: "ready",
      requestId: nextRequestId(),
      ...status,
    });
  }

  function postStatus(requestId: number): void {
    const status = currentStatus();
    post({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-agent",
      type: "status",
      requestId,
      ...status,
    });
  }

  function postDisarm(reason: "keyup" | "blur" | "scroll" | "escape" | "disable"): void {
    post({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-agent",
      type: "disarm",
      requestId: nextRequestId(),
      reason,
    });
  }

  function postHoverNone(): void {
    if (!lastHoverHadContent) return;
    lastHoverHadContent = false;
    post({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-agent",
      type: "hover-none",
      requestId: nextRequestId(),
    });
  }

  function cancelHover(): void {
    if (hoverRaf !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(hoverRaf);
      hoverRaf = null;
    }
    pendingTarget = null;
  }

  function disarm(reason: "keyup" | "blur" | "scroll" | "escape" | "disable"): void {
    const wasArmed = armed || pendingTarget !== null || lastHoverHadContent;
    armed = false;
    cancelHover();
    if (wasArmed) postDisarm(reason);
    postHoverNone();
  }

  function isOverlayTarget(element: Element | null): boolean {
    if (element === null) return false;
    try {
      return element.closest("[data-ttc-ui]") !== null;
    } catch {
      return false;
    }
  }

  function chainFor(element: Element | null): RawEntry[] {
    if (element === null) return [];
    const fiber = getFiberForElement(element);
    if (fiber === null) return [];
    try {
      return buildRawChain(fiber, location.origin);
    } catch {
      return [];
    }
  }

  function renderHover(): void {
    if (!armed || menuOpen || pendingTarget === null) {
      postHoverNone();
      return;
    }
    const target = pendingTarget;
    if (!target.isConnected) {
      postHoverNone();
      return;
    }
    const chain = chainFor(target);
    if (chain.length === 0) {
      postHoverNone();
      return;
    }
    const rect = target.getBoundingClientRect();
    lastHoverHadContent = true;
    post({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-agent",
      type: "hover",
      requestId: nextRequestId(),
      chain,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      x: pendingX,
      y: pendingY,
    });
  }

  function scheduleHover(): void {
    if (hoverRaf !== null) return;
    if (typeof requestAnimationFrame !== "function") {
      renderHover();
      return;
    }
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = null;
      renderHover();
    });
  }

  function onKeyDown(rawEvent: Event): void {
    if (config === null || !config.enabled) return;
    if (menuOpen) return; // the inspector owns menu keyboard navigation
    const event = rawEvent as KeyboardEvent;
    if (event.key === "Escape") {
      disarm("escape");
      return;
    }
    if (isModifierHeld(event, config.keyboard)) {
      armed = true;
    }
  }

  function onKeyUp(rawEvent: Event): void {
    if (config === null || !config.enabled) return;
    const event = rawEvent as KeyboardEvent;
    if (armed && !isModifierHeld(event, config.keyboard)) {
      disarm("keyup");
    }
  }

  function onWindowBlur(): void {
    if (config === null || !config.enabled) return;
    if (armed || menuOpen) disarm("blur");
  }

  function onMouseMove(rawEvent: Event): void {
    if (config === null || !config.enabled || menuOpen) return;
    const event = rawEvent as MouseEvent;
    if (!isModifierHeld(event, config.keyboard)) {
      if (armed || lastHoverHadContent) disarm("keyup");
      return;
    }
    armed = true;
    const target = elementFromTarget(event.target);
    if (target === null || isOverlayTarget(target)) {
      pendingTarget = null;
      postHoverNone();
      return;
    }
    pendingTarget = target;
    pendingX = event.clientX;
    pendingY = event.clientY;
    scheduleHover();
  }

  function onMouseDown(rawEvent: Event): void {
    if (config === null || !config.enabled) return;
    const event = rawEvent as MouseEvent;
    if (menuOpen) {
      if (isOverlayTarget(elementFromTarget(event.target))) return;
      if (event.button === 0) {
        event.preventDefault();
        event.stopPropagation();
        suppressNextClick = true;
        post({
          __ttc: PROTOCOL_VERSION,
          source: "ttc-agent",
          type: "dismiss",
          requestId: nextRequestId(),
          reason: "outside",
        });
      }
      return;
    }
    if (event.button !== 0) return;
    if (!isModifierHeld(event, config.keyboard)) return;
    // Suppress the page's activation only when there is something to inspect.
    if (chainFor(elementFromTarget(event.target)).length === 0) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onClick(rawEvent: Event): void {
    if (config === null || !config.enabled) return;
    const event = rawEvent as MouseEvent;
    if (suppressNextClick) {
      suppressNextClick = false;
      if (!menuOpen) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (menuOpen) {
      if (isOverlayTarget(elementFromTarget(event.target))) return;
      post({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "dismiss",
        requestId: nextRequestId(),
        reason: "outside",
      });
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.button !== 0) return;
    if (!isModifierHeld(event, config.keyboard)) return;
    const target = elementFromTarget(event.target);
    const chain = chainFor(target);
    if (chain.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    armed = false;
    cancelHover();
    post({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-agent",
      type: "activate",
      requestId: nextRequestId(),
      chain,
      x: event.clientX,
      y: event.clientY,
      button: event.button,
    });
  }

  function onContextMenu(rawEvent: Event): void {
    if (config === null || !config.enabled || !config.menu || menuOpen) return;
    const event = rawEvent as MouseEvent;
    if (!isModifierHeld(event, config.keyboard)) return;
    const chain = chainFor(elementFromTarget(event.target));
    if (chain.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    armed = false;
    cancelHover();
    post({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-agent",
      type: "chain-menu",
      requestId: nextRequestId(),
      chain,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function onScroll(): void {
    if (config === null || !config.enabled) return;
    if (!armed && !menuOpen && !lastHoverHadContent) return;
    disarm("scroll");
  }

  function onMessage(rawEvent: Event): void {
    const event = rawEvent as MessageEvent;
    if (event.source !== window) return;
    const message = parseInspectorMessage(event.data);
    if (message === null) return;
    switch (message.type) {
      case "config": {
        const nextConfig = message.config;
        config = nextConfig;
        if (!nextConfig.enabled) {
          disarm("disable");
          menuOpen = false;
          setActive(false);
        } else {
          setActive(true);
        }
        return;
      }
      case "probe":
        postStatus(message.requestId);
        return;
      case "menu-state":
        menuOpen = message.open;
        if (menuOpen) {
          cancelHover();
          postHoverNone();
        }
        return;
      default:
        return;
    }
  }

  function setActive(next: boolean): void {
    if (next === active) return;
    active = next;
    if (!next) {
      removeAll(activeListeners);
      return;
    }
    const capture: AddEventListenerOptions = { capture: true };
    const passiveCapture: AddEventListenerOptions = { capture: true, passive: true };
    listen(activeListeners, window, "keydown", onKeyDown, capture);
    listen(activeListeners, window, "keyup", onKeyUp, capture);
    listen(activeListeners, window, "blur", onWindowBlur);
    listen(activeListeners, window, "mousemove", onMouseMove, passiveCapture);
    listen(activeListeners, window, "mousedown", onMouseDown, capture);
    listen(activeListeners, window, "click", onClick, capture);
    listen(activeListeners, window, "contextmenu", onContextMenu, capture);
    listen(activeListeners, window, "scroll", onScroll, passiveCapture);
  }

  // Always-on channel: the inspector configures the agent from here.
  listen(permanentListeners, window, "message", onMessage);

  // Announce readiness; the inspector answers with a `config` message. This
  // also covers the case where the inspector was not running yet on boot.
  postReady();

  function dispose(): void {
    removeAll(activeListeners);
    removeAll(permanentListeners);
    armed = false;
    menuOpen = false;
    pendingTarget = null;
  }

  return dispose;
}

const scope = globalThis as unknown as AgentGlobals;
scope.__TTC_AGENT__?.dispose();
const dispose = installAgent();
if (dispose !== null) {
  scope.__TTC_AGENT__ = { dispose };
}
