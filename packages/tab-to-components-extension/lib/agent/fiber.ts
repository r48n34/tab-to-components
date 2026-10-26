/**
 * React fiber discovery and raw-chain extraction (MAIN world only).
 *
 * The extension never imports React: in development React attaches fiber
 * objects to host DOM nodes under a random-suffixed own property
 * (`__reactFiber$…`, legacy `__reactInternalInstance$…`). Walking `fiber.return`
 * from the clicked host element outwards gives every JSX site on the path.
 *
 * Each fiber contributes whatever source evidence its React version exposes:
 * `data-ttc` props from the optional Vite plugin, React 18 `_debugSource`, or a
 * React 19 `_debugStack` collapsed to its first application frame.
 */

import {
  MAX_CHAIN_ENTRIES,
  type RawDebugSource,
  type RawEntry,
  type RawStackFrame,
  type ReactKind,
} from "../protocol";
import { pickAppFrame, stackStringOf } from "../source/stack";

/** Property prefixes React uses to stash the fiber on a host DOM node. */
export const FIBER_KEY_PREFIXES = [
  "__reactFiber$",
  "__reactInternalInstance$",
] as const;

/** Guard against pathological/cyclic fibers. */
export const MAX_CHAIN_DEPTH = 1000;

/** How many DOM elements a page-level probe scans for a fiber. */
export const MAX_PROBE_ELEMENTS = 400;

/** Structural subset of a React fiber. We never construct these, only read them. */
export interface FiberLike {
  type?: unknown;
  elementType?: unknown;
  tag?: number;
  memoizedProps?: Record<string, unknown> | null;
  pendingProps?: Record<string, unknown> | null;
  return?: FiberLike | null;
  _debugSource?: unknown;
  _debugStack?: unknown;
  _debugOwner?: FiberLike | null;
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** Find the React fiber attached to a host DOM node. */
export function getFiberForElement(
  node: Element | null | undefined,
): FiberLike | null {
  if (!node || typeof node !== "object") return null;
  const candidates = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(candidates)) {
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

/** Read the Vite plugin's `data-ttc` marker off a fiber, if present. */
export function getFiberMarker(fiber: FiberLike): string | null {
  const raw = getFiberProps(fiber)?.["data-ttc"];
  return typeof raw === "string" && raw !== "" ? raw : null;
}

/** Read the Vite plugin's `data-ttc-name` display-name hint. */
export function getFiberMarkerName(fiber: FiberLike): string {
  const raw = getFiberProps(fiber)?.["data-ttc-name"];
  return typeof raw === "string" ? raw.trim() : "";
}

/** Read and validate React 18's `_debugSource`. */
export function getDebugSource(fiber: FiberLike): RawDebugSource | null {
  const raw = fiber._debugSource;
  if (!isRecord(raw)) return null;
  const fileName = raw["fileName"];
  const lineNumber = raw["lineNumber"];
  const columnNumber = raw["columnNumber"];
  if (typeof fileName !== "string" || fileName === "") return null;
  if (!isPositiveInteger(lineNumber) || !isPositiveInteger(columnNumber)) {
    return null;
  }
  return { fileName, lineNumber, columnNumber };
}

/** Read React 19's `_debugStack` as a stack string. */
export function getDebugStack(fiber: FiberLike): string | null {
  return stackStringOf(fiber._debugStack);
}

/** Which React source mechanism this fiber exposes. */
export function detectReactKind(fiber: FiberLike | null): ReactKind {
  if (!fiber) return "unknown";
  if (getDebugSource(fiber) !== null) return "18";
  if (getDebugStack(fiber) !== null) return "19";
  return "unknown";
}

interface NamedType {
  displayName?: unknown;
  name?: unknown;
  $$typeof?: unknown;
}

function nameOf(type: unknown): string {
  if (typeof type === "string") return type;
  if (typeof type !== "function" && !isRecord(type)) return "";
  const named = type as NamedType;
  const displayName =
    typeof named.displayName === "string" ? named.displayName.trim() : "";
  if (displayName !== "") return displayName;
  const name = typeof named.name === "string" ? named.name.trim() : "";
  return name;
}

/**
 * Unwrap one layer of `memo` / `forwardRef` / `React.lazy` without importing
 * React: memo-ish wrappers expose `type` (or `_payload` for lazy), forwardRef
 * wrappers expose `render`.
 */
function unwrapType(type: unknown): unknown {
  if (!isRecord(type)) return undefined;
  const render = type["render"];
  if (typeof render === "function" || isRecord(render)) return render;
  const payload = type["_payload"];
  if (isRecord(payload) && payload["_result"] !== undefined) {
    return payload["_result"];
  }
  const inner = type["type"];
  if (inner !== undefined && inner !== type) return inner;
  return undefined;
}

/**
 * Name a fiber and decide whether it is a host element or a component.
 * Handles `memo`, `forwardRef`, lazy, class components and `displayName`,
 * falling back to the `data-ttc-name` attribute injected on the JSX site.
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

  const name =
    nameOf(rawType) || nameOf(resolved) || getFiberMarkerName(fiber);
  return { name: name !== "" ? name : ANONYMOUS_NAME, isHost: false };
}

/**
 * Walk the fiber tree upwards and return every JSX site with usable evidence,
 * ordered from the clicked host element outwards.
 */
export function buildRawChain(
  fiber: FiberLike | null,
  pageOrigin: string | null,
): RawEntry[] {
  const chain: RawEntry[] = [];
  if (fiber === null) return chain;

  const seen = new Set<FiberLike>();
  let current: FiberLike | null = fiber;
  let depth = 0;
  while (
    current !== null &&
    depth < MAX_CHAIN_DEPTH &&
    chain.length < MAX_CHAIN_ENTRIES
  ) {
    depth += 1;
    if (seen.has(current)) break;
    seen.add(current);

    const marker = getFiberMarker(current);
    const nameHint = getFiberMarkerName(current);
    const debugSource = getDebugSource(current);
    const stack = getDebugStack(current);
    const stackFrame: RawStackFrame | null =
      stack !== null ? pickAppFrame(stack, pageOrigin) : null;

    if (marker !== null || debugSource !== null || stackFrame !== null) {
      const info = describeFiber(current);
      const entry: RawEntry = { name: info.name, isHost: info.isHost };
      if (marker !== null) entry.marker = marker;
      if (nameHint !== "") entry.nameHint = nameHint;
      if (debugSource !== null) entry.debugSource = debugSource;
      if (stackFrame !== null) entry.stackFrame = stackFrame;
      chain.push(entry);
    }

    current = current.return ?? null;
  }
  return chain;
}

/** Find the first element in the document whose fiber is reachable. */
export function findFiberInDocument(
  doc: Document,
  limit = MAX_PROBE_ELEMENTS,
): FiberLike | null {
  const elements = doc.querySelectorAll("*");
  const max = Math.min(elements.length, limit);
  for (let index = 0; index < max; index += 1) {
    const fiber = getFiberForElement(elements[index] ?? null);
    if (fiber !== null) return fiber;
  }
  return null;
}
