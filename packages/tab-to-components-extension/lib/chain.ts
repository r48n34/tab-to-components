/**
 * Component-chain helpers: which row of the chain a click should act on.
 *
 * The extension's MAIN-world agent returns the fiber chain (nearest host
 * element first) as raw entries; the inspector resolves each one into a
 * `ResolvedEntry`. These helpers are the pure lookups the plugin performs over
 * its marker chain, adapted to entries whose location may be missing.
 */

import type { ResolvedEntry } from "./source/types";
import type { OpenMode } from "./types";

/** The nearest non-host entry (the component whose JSX site rendered a node). */
export function nearestComponentEntry(
  chain: readonly ResolvedEntry[],
): ResolvedEntry | null {
  return chain.find((entry) => !entry.isHost) ?? null;
}

/**
 * Pick the entry a modifier + left click should act on for the given mode.
 *
 * - `"component"` prefers the nearest component and falls back to the clicked
 *   host element.
 * - `"element"` always uses the clicked host element itself.
 * - `"menu"` opens the chain picker, so the first (deepest) entry is the
 *   starting row.
 */
export function pickPrimaryEntry(
  chain: readonly ResolvedEntry[],
  open: OpenMode,
): ResolvedEntry | null {
  const first = chain[0] ?? null;
  if (first === null) return null;
  if (open === "element" || open === "menu") return first;
  return nearestComponentEntry(chain) ?? first;
}

/** Whether any entry in the chain resolved to a source location. */
export function hasSourceLocation(chain: readonly ResolvedEntry[]): boolean {
  return chain.some((entry) => entry.location !== null);
}
