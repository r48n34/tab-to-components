/**
 * React fiber discovery and naming.
 *
 * The overlay runs in the app's page and must not import React: in development
 * React attaches fiber objects to host DOM nodes under a random-suffixed own
 * property (`__reactFiber$…`; legacy React used `__reactInternalInstance$…`).
 * Walking `fiber.return` gives us the JSX sites from the clicked host element
 * outwards, and each marked fiber's `memoizedProps` carries the injected
 * `data-ttc` / `data-ttc-name` attributes.
 */

import { parseMarker, type SourceMarker } from "./marker";

/** Property prefixes React uses to stash the fiber on a host DOM node. */
export const FIBER_KEY_PREFIXES = ["__reactFiber$", "__reactInternalInstance$"] as const;

/**
 * Structural subset of a React fiber. We never construct these, only read them.
 */
export interface FiberLike {
  type: unknown;
  elementType?: unknown;
  memoizedProps?: Record<string, unknown> | null;
  pendingProps?: Record<string, unknown> | null;
  return?: FiberLike | null;
}

/** What a fiber renders: a host tag or a named component. */
export interface FiberElementInfo {
  /** `button` for host elements, `Button` for components. */
  name: string;
  /** True when `fiber.type` is a DOM tag string. */
  isHost: boolean;
}

const ANONYMOUS_NAME = "Anonymous";
const MAX_UNWRAP_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Find the React fiber attached to a host DOM node, or `null` when the node is
 * not managed by React.
 */
export function getFiberForElement(node: Element | null | undefined): FiberLike | null {
  if (!node || typeof node !== "object") return null;
  const candidates = node as unknown as Record<string, unknown>;
  const keys = Object.keys(candidates);
  for (const key of keys) {
    if (!FIBER_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    const fiber = candidates[key];
    if (isRecord(fiber)) return fiber as unknown as FiberLike;
  }
  return null;
}

/** `memoizedProps`, falling back to `pendingProps`. */
export function getFiberProps(
  fiber: FiberLike | null | undefined,
): Record<string, unknown> | null {
  if (!fiber) return null;
  const props = fiber.memoizedProps ?? fiber.pendingProps;
  return isRecord(props) ? props : null;
}

/** Read the injected `data-ttc` source marker off a fiber, if any. */
export function getFiberMarker(fiber: FiberLike | null | undefined): SourceMarker | null {
  const props = getFiberProps(fiber);
  if (!props) return null;
  const raw = props["data-ttc"];
  return typeof raw === "string" ? parseMarker(raw) : null;
}

/** Read the injected `data-ttc-name` display-name fallback off a fiber. */
export function getFiberMarkerName(fiber: FiberLike | null | undefined): string {
  const props = getFiberProps(fiber);
  if (!props) return "";
  const raw = props["data-ttc-name"];
  return typeof raw === "string" ? raw : "";
}

interface NamedType {
  displayName?: unknown;
  name?: unknown;
}

function nameOf(type: unknown): string {
  if (typeof type === "string") return type;
  if (typeof type !== "function") return "";
  const named = type as NamedType;
  const displayName = typeof named.displayName === "string" ? named.displayName.trim() : "";
  if (displayName !== "") return displayName;
  const name = typeof named.name === "string" ? named.name.trim() : "";
  return name;
}

/**
 * Unwrap one layer of `memo` / `forwardRef` / `React.lazy` without importing
 * React: memo-ish wrappers expose a `type` (or `_payload` for lazy), forwardRef
 * wrappers expose `render`.
 */
function unwrapType(type: unknown): unknown {
  if (!isRecord(type)) return undefined;
  const render = type["render"];
  if (typeof render === "function" || isRecord(render)) return render;
  const payload = type["_payload"];
  if (isRecord(payload) && payload["_result"] !== undefined) return payload["_result"];
  const inner = type["type"];
  if (inner !== undefined && inner !== type) return inner;
  return undefined;
}

/**
 * Name a fiber and decide whether it is a host element or a component.
 * Handles `memo`, `forwardRef`, class components and `displayName`, falling
 * back to the `data-ttc-name` attribute injected on the JSX site.
 */
export function describeFiber(fiber: FiberLike): FiberElementInfo {
  const rawType = fiber.type;
  if (typeof rawType === "string") return { name: rawType, isHost: true };

  let resolved: unknown = rawType;
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth += 1) {
    if (!isRecord(resolved)) break;
    const next = unwrapType(resolved);
    if (next === undefined) break;
    resolved = next;
    if (typeof resolved === "string") return { name: resolved, isHost: true };
  }

  const name = nameOf(rawType) || nameOf(resolved) || getFiberMarkerName(fiber);
  return { name: name !== "" ? name : ANONYMOUS_NAME, isHost: false };
}
