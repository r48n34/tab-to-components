/**
 * Contracts shared by the inspector's source-resolution pipeline.
 *
 * A `RawEntry` comes from the MAIN-world agent; resolving it turns whatever
 * React/bundler evidence is available into a `SourceLocation` the UI can show
 * and the actions can copy/open.
 */

import type { RawEntry } from "../protocol";
import type { SourceLocation } from "./location";

/** A fiber-chain row with its source location, when one could be resolved. */
export interface ResolvedEntry {
  /** `button` for host elements, `Button` for components. */
  name: string;
  /** True when the entry belongs to a DOM tag rather than a component. */
  isHost: boolean;
  /** `null` when no layer could produce a location (production React, no map, …). */
  location: SourceLocation | null;
}

/** Resolves raw agent entries into displayable/copyable locations. */
export interface SourceResolver {
  resolve(entry: RawEntry): Promise<ResolvedEntry>;
  resolveChain(entries: readonly RawEntry[]): Promise<ResolvedEntry[]>;
}

/** Context a resolver needs from the current page. */
export interface SourceResolverOptions {
  /** The frame's origin, used to prefer same-origin stack frames and maps. */
  pageOrigin: string;
  /** Absolute project root configured for this origin (fallback path source). */
  projectRoot: string | null;
  /** Vite `base` (defaults to `/`); stripped from server-relative paths. */
  base?: string;
  /** Allows tests and the content script to inject an instrumented fetch. */
  fetchText?: (url: string) => Promise<string | null>;
}
