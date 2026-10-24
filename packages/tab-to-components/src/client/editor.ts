/**
 * Opening a source location in the developer's editor.
 *
 * This talks to Vite's built-in `/__open-in-editor` endpoint (which wraps
 * `launch-editor`). The endpoint answers 200 on success; anything else is
 * surfaced to the caller so it can show a toast the developer can copy from.
 */

import type { ClientConfig } from "./config";
import { formatMarker, type SourceMarker } from "./marker";

/** A concrete editor request: the URL to hit plus the path it refers to. */
export interface EditorTarget {
  /** URL relative to the page, including Vite `base`. */
  url: string;
  /** `root/file:line:column` exactly as sent to the editor server. */
  fullPath: string;
}

/** The config fields needed to build an editor URL. */
export type EditorUrlConfig = Pick<ClientConfig, "root" | "base" | "editorEndpoint">;

/** Either a bare marker or anything carrying one (e.g. a chain entry). */
export type EditorUrlInput = SourceMarker | { marker: SourceMarker };

/** A minimal `fetch` shape so tests can inject a stub without a full Response. */
export type FetchLike = (input: string) => Promise<unknown>;

export interface OpenInEditorOptions {
  /** Override the global `fetch` (tests, or exotic environments). */
  fetchImpl?: FetchLike;
  /** Called instead of throwing whenever the editor could not be opened. */
  onError?: (message: string, target: EditorTarget) => void;
}

function markerOf(input: EditorUrlInput): SourceMarker {
  if (input !== null && typeof input === "object" && "marker" in input) {
    const marker = (input as { marker?: unknown }).marker;
    if (marker !== null && typeof marker === "object") return marker as SourceMarker;
  }
  return input as SourceMarker;
}

function joinRootPath(root: string, file: string): string {
  const normalizedRoot = root.replace(/\\/g, "/");
  const relative = file.replace(/^\/+/, "");
  if (normalizedRoot === "" || normalizedRoot === "/") return `/${relative}`;
  return `${normalizedRoot.replace(/\/+$/, "")}/${relative}`;
}

/** `root + "/" + relPath + ":" + line + ":" + column` exactly as sent to Vite. */
export function resolveEditorPath(
  entry: EditorUrlInput,
  config: EditorUrlConfig,
): string {
  const marker = markerOf(entry);
  return `${joinRootPath(config.root, marker.file)}:${marker.line}:${marker.column}`;
}

/**
 * Build the GET URL for Vite's built-in open-in-editor endpoint:
 *
 *   base + editorEndpoint + "?file=" + encodeURIComponent(root + "/" + relPath + ":line:column")
 *
 * No extra query parameters: the e2e harness asserts on this exact string.
 */
export function buildEditorUrl(entry: EditorUrlInput, config: EditorUrlConfig): string {
  const base = config.base.endsWith("/") ? config.base : `${config.base}/`;
  const endpoint = config.editorEndpoint.replace(/^\/+/, "");
  return `${base}${endpoint}?file=${encodeURIComponent(resolveEditorPath(entry, config))}`;
}

/**
 * Compose the request sent to Vite's open-in-editor endpoint. Kept as a
 * `(config, marker)` helper for the overlay's own call sites.
 */
export function resolveEditorTarget(
  config: ClientConfig,
  marker: SourceMarker,
): EditorTarget {
  return {
    url: buildEditorUrl(marker, config),
    fullPath: resolveEditorPath(marker, config),
  };
}

function isOkResponse(response: unknown): boolean {
  if (typeof response !== "object" || response === null) return false;
  const record = response as { ok?: unknown; status?: unknown };
  if (typeof record.ok === "boolean") return record.ok;
  if (typeof record.status === "number") return record.status >= 200 && record.status < 300;
  // Unknown opaque response: assume the request went through.
  return true;
}

function getFetch(options: OpenInEditorOptions): FetchLike | null {
  if (options.fetchImpl) return options.fetchImpl;
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate !== "function") return null;
  return candidate.bind(globalThis) as FetchLike;
}

/**
 * Ask Vite to open the source location. Never throws and never rejects:
 * failures are reported through `options.onError` and resolve to `false`.
 */
export async function openInEditor(
  config: ClientConfig,
  marker: SourceMarker,
  options: OpenInEditorOptions = {},
): Promise<boolean> {
  const target = resolveEditorTarget(config, marker);
  const fetchImpl = getFetch(options);

  if (!fetchImpl) {
    options.onError?.(
      `Could not open editor (fetch unavailable). Copy: ${target.fullPath}`,
      target,
    );
    return false;
  }

  try {
    const response = await fetchImpl(target.url);
    if (isOkResponse(response)) return true;
    options.onError?.(`Could not open editor. Copy: ${target.fullPath}`, target);
    return false;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    options.onError?.(
      `Could not open editor (${reason || "request failed"}). Copy: ${target.fullPath}`,
      target,
    );
    return false;
  }
}

/** Convenience helper used by the toast message. */
export function formatEditorTarget(marker: SourceMarker): string {
  return formatMarker(marker);
}
