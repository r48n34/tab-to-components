/**
 * Layered source resolution.
 *
 * For every fiber in the clicked chain the agent reports whatever evidence it
 * could gather. This module turns that evidence into a `SourceLocation` by
 * trying, in order:
 *
 *   1. `data-ttc` markers injected by the Vite plugin (only when installed) —
 *      exact project-relative path and position, no source map needed;
 *   2. React 18 `_debugSource` — exact original position plus an absolute path;
 *   3. React 19 `_debugStack` mapped through the dev server's source map.
 *
 * The layers are merged when possible: a marker supplies the relative path
 * while `_debugSource`/a source map supplies the absolute path for "Copy full
 * path" and editor URLs.
 */

import { parseMarker } from "./location";
import type { RawEntry } from "../protocol";
import { locationFromDebugSource } from "./react18";
import {
  createSourceMapResolver,
  type SourceMapResolver,
} from "./sourcemap";
import type {
  ResolvedEntry,
  SourceResolver,
  SourceResolverOptions,
} from "./types";
import {
  createLocation,
  isSafeRelativeFile,
  joinRoot,
  normalizeSlashes,
  type SourceLocation,
  type LocationSource,
} from "./location";

interface ResolutionLayers {
  marker: { file: string; line: number; column: number } | null;
  debugSource: SourceLocation | null;
  mapped: SourceLocation | null;
}

function choosePosition(
  layers: ResolutionLayers,
): { line: number; column: number; source: LocationSource } | null {
  if (layers.marker !== null) {
    return {
      line: layers.marker.line,
      column: layers.marker.column,
      source: "marker",
    };
  }
  if (layers.debugSource !== null) {
    return {
      line: layers.debugSource.line,
      column: layers.debugSource.column,
      source: "debug-source",
    };
  }
  if (layers.mapped !== null) {
    return {
      line: layers.mapped.line,
      column: layers.mapped.column,
      source: "source-map",
    };
  }
  return null;
}

function chooseRelativeFile(layers: ResolutionLayers): string | null {
  const candidates: Array<string | null> = [
    layers.marker?.file ?? null,
    layers.mapped?.relativeFile ?? null,
    layers.debugSource?.relativeFile ?? null,
  ];
  for (const candidate of candidates) {
    if (candidate !== null && isSafeRelativeFile(candidate)) {
      return normalizeSlashes(candidate);
    }
  }
  return null;
}

function chooseAbsoluteFile(
  layers: ResolutionLayers,
  projectRoot: string | null,
  relativeFile: string | null,
): string | null {
  if (layers.debugSource?.absoluteFile) return layers.debugSource.absoluteFile;
  if (layers.mapped?.absoluteFile) return layers.mapped.absoluteFile;
  if (projectRoot !== null && relativeFile !== null) {
    return joinRoot(projectRoot, relativeFile);
  }
  return null;
}

function locationFromLayers(
  layers: ResolutionLayers,
  projectRoot: string | null,
): SourceLocation | null {
  const position = choosePosition(layers);
  if (position === null) return null;
  const relativeFile = chooseRelativeFile(layers);
  const absoluteFile = chooseAbsoluteFile(layers, projectRoot, relativeFile);
  return createLocation({
    relativeFile,
    absoluteFile,
    line: position.line,
    column: position.column,
    source: position.source,
  });
}

/**
 * Create the resolver used by the inspector. Source-map fetches are cached per
 * module; pass `fetchText` to instrument them in tests.
 */
export function createSourceResolver(
  options: SourceResolverOptions,
): SourceResolver {
  const { pageOrigin, projectRoot, fetchText, base = "/" } = options;
  let mapResolver: SourceMapResolver | null = null;

  function maps(): SourceMapResolver {
    if (mapResolver === null) {
      mapResolver = createSourceMapResolver({
        pageOrigin,
        projectRoot,
        base,
        ...(fetchText ? { fetchText } : {}),
      });
    }
    return mapResolver;
  }

  async function resolve(entry: RawEntry): Promise<ResolvedEntry> {
    const marker = entry.marker ? parseMarker(entry.marker) : null;
    const debugSource = entry.debugSource
      ? locationFromDebugSource(entry.debugSource, { projectRoot })
      : null;
    const mapped =
      entry.stackFrame !== undefined
        ? await maps().resolveFrame(entry.stackFrame)
        : null;

    const location = locationFromLayers(
      { marker, debugSource, mapped },
      projectRoot,
    );

    return {
      name: entry.name,
      isHost: entry.isHost,
      location,
    };
  }

  return {
    resolve,
    async resolveChain(entries: readonly RawEntry[]): Promise<ResolvedEntry[]> {
      return Promise.all(entries.map((entry) => resolve(entry)));
    },
  };
}
