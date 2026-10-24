/**
 * Builds the component chain: every marked fiber from the clicked host element
 * outwards. This is what the right-click menu lists and what `open: "component"`
 * uses to find the nearest component JSX site.
 */

import type { OpenMode } from "./config";
import { describeFiber, getFiberForElement, getFiberMarker, type FiberLike } from "./fiber";
import { parseMarker, type SourceMarker } from "./marker";

/** One row of the chain / one possible "jump to source" target. */
export interface ChainEntry {
  /** `button` for host elements, `Button` for components. */
  name: string;
  /** True when the entry belongs to a DOM tag rather than a component. */
  isHost: boolean;
  /** Parsed `data-ttc` location of that JSX site. */
  marker: SourceMarker;
}

/** Guard against pathological/cyclic fibers. */
const MAX_CHAIN_DEPTH = 1000;

/** Build a chain entry from a DOM element carrying a `data-ttc` attribute. */
export function entryFromElement(element: Element | null | undefined): ChainEntry | null {
  if (!element || typeof element.closest !== "function") return null;
  const marked = element.closest("[data-ttc]");
  if (!marked) return null;
  const marker = parseMarker(marked.getAttribute("data-ttc"));
  if (!marker) return null;
  const tagName = marked.tagName;
  return {
    name: typeof tagName === "string" ? tagName.toLowerCase() : "unknown",
    isHost: true,
    marker,
  };
}

/**
 * Walk the fiber tree upwards from `node` and return every marked JSX site, in
 * order from the clicked host element outwards. Unmarked fibers are skipped.
 *
 * Falls back to the nearest `[data-ttc]` DOM ancestor when the node has no
 * fiber at all (non-React DOM) or when no props marker could be found.
 */
export function getComponentChain(node: Element | null | undefined): ChainEntry[] {
  const chain: ChainEntry[] = [];
  if (!node) return chain;

  const fiber = getFiberForElement(node);
  if (!fiber) {
    const fallback = entryFromElement(node);
    if (fallback) chain.push(fallback);
    return chain;
  }

  const seen = new Set<FiberLike>();
  let current: FiberLike | null = fiber;
  let depth = 0;
  while (current !== null && depth < MAX_CHAIN_DEPTH) {
    depth += 1;
    if (seen.has(current)) break;
    seen.add(current);
    const marker = getFiberMarker(current);
    if (marker) {
      const info = describeFiber(current);
      chain.push({ name: info.name, isHost: info.isHost, marker });
    }
    current = current.return ?? null;
  }

  if (chain.length === 0) {
    const fallback = entryFromElement(node);
    if (fallback) chain.push(fallback);
  }
  return chain;
}

/** The nearest non-host entry (the component whose JSX site rendered a node). */
export function nearestComponentEntry(chain: ChainEntry[]): ChainEntry | null {
  return chain.find((entry) => !entry.isHost) ?? null;
}

/**
 * Pick the entry a modifier + left click should open for the given mode.
 * `"component"` prefers the nearest component and falls back to the clicked
 * host element; `"element"` always opens the clicked host element itself.
 */
export function pickPrimaryEntry(chain: ChainEntry[], open: OpenMode): ChainEntry | null {
  const first = chain[0] ?? null;
  if (first === null) return null;
  if (open === "element") return first;
  return nearestComponentEntry(chain) ?? first;
}
