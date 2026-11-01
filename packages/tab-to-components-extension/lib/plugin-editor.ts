/**
 * Open-in-IDE delegation to the tab-to-components Vite plugin.
 *
 * The extension used to launch editor URL schemes (`vscode://file/...`) itself.
 * That handoff depends on the browser, the operating system and every
 * registered protocol, and in practice it fails in too many setups. The Vite
 * plugin already runs a dev-server endpoint that launches the editor on the
 * machine that runs the dev server, with path containment and rate limiting.
 *
 * When the plugin is installed it injects `globalThis.__TTC_CONFIG__` into the
 * page. The MAIN-world agent reads the three fields it needs from there, builds
 * a same-origin request and reports the result back to the inspector. Without
 * the plugin there is no editor to talk to, so the "Open in IDE" action is
 * hidden instead of doing nothing.
 */

import {
  isSafeAbsolutePath,
  isSafeRelativeFile,
  MAX_PATH_LENGTH,
  MAX_POSITION,
  normalizeSlashes,
  type SourceLocation,
} from "./source/location";

/** The parts of `globalThis.__TTC_CONFIG__` needed for editor requests. */
export interface PluginInfo {
  /** Dev-server base with a leading and trailing slash (`/` or `/app/`). */
  base: string;
  /** Endpoint below the base, without a leading slash (`__ttc/open-in-editor`). */
  editorEndpoint: string;
  /** Absolute plugin root, forward slashes (`D:/projects/app`). */
  root: string;
}

export const MAX_PLUGIN_BASE = 256;
export const MAX_PLUGIN_ENDPOINT = 256;
/** Longest `path:line:column` value accepted from either side. */
export const MAX_EDITOR_TARGET = 2048;

/** Toast shown whenever the editor action is unavailable. */
export const OPEN_EDITOR_REQUIRES_PLUGIN =
  "Open in IDE needs the tab-to-components Vite plugin on this page.";

const BASE_PATTERN = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const ENDPOINT_PATTERN = /^[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validate a dev-server base such as `/` or `/app/`. */
export function normalizePluginBase(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value === "") return null;
  if (value.length > MAX_PLUGIN_BASE) return null;
  if (value === "/") return "/";
  if (!value.startsWith("/") || !value.endsWith("/")) return null;
  if (!BASE_PATTERN.test(value)) return null;
  if (value.includes("//")) return null;
  if (value.split("/").includes("..")) return null;
  return value;
}

/** Validate and normalize the editor endpoint (`__ttc/open-in-editor`). */
export function normalizePluginEndpoint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const endpoint = value.trim().replace(/^\/+/, "");
  if (endpoint === "" || endpoint.length > MAX_PLUGIN_ENDPOINT) return null;
  if (!ENDPOINT_PATTERN.test(endpoint)) return null;
  if (endpoint.includes("//") || endpoint.includes("..")) return null;
  return endpoint;
}

/** Validate the absolute project root injected by the plugin. */
export function normalizePluginRoot(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const root = normalizeSlashes(value.trim()).replace(/\/+$/, "");
  if (root === "") return "/";
  if (root.length > MAX_PATH_LENGTH) return null;
  if (!isSafeAbsolutePath(root)) return null;
  return root;
}

/** Validate a full `__TTC_CONFIG__`-shaped object. */
export function parsePluginInfo(value: unknown): PluginInfo | null {
  if (!isRecord(value)) return null;
  const base = normalizePluginBase(value.base);
  const editorEndpoint = normalizePluginEndpoint(value.editorEndpoint);
  const root = normalizePluginRoot(value.root);
  if (base === null || editorEndpoint === null || root === null) return null;
  return { base, editorEndpoint, root };
}

/** Read the plugin configuration the page may have been given. */
export function readPluginInfo(scope: unknown): PluginInfo | null {
  if (!isRecord(scope)) return null;
  return parsePluginInfo(scope.__TTC_CONFIG__);
}

function isPosition(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_POSITION
  );
}

function joinRoot(root: string, relative: string): string {
  return `${root.replace(/\/+$/, "")}/${relative}`;
}

/**
 * Build the `path:line:column` value the plugin endpoint expects.
 *
 * Absolute paths are used as-is (the plugin verifies containment); otherwise
 * the project-relative path is joined onto the plugin root, which is what the
 * plugin's own client does.
 */
export function formatEditorTarget(
  location: Pick<SourceLocation, "file" | "relativeFile" | "absoluteFile" | "line" | "column">,
  pluginRoot: string | null,
): string | null {
  if (!isPosition(location.line) || !isPosition(location.column)) return null;

  let file: string | null = null;
  if (typeof location.absoluteFile === "string" && isSafeAbsolutePath(location.absoluteFile)) {
    file = normalizeSlashes(location.absoluteFile);
  } else if (
    typeof location.relativeFile === "string" &&
    isSafeRelativeFile(location.relativeFile) &&
    pluginRoot !== null
  ) {
    file = joinRoot(pluginRoot, location.relativeFile);
  }
  if (file === null) return null;

  const target = `${file}:${location.line}:${location.column}`;
  return target.length <= MAX_EDITOR_TARGET ? target : null;
}

/** Build the same-origin request path for one editor target. */
export function buildOpenEditorRequest(info: PluginInfo, target: string): string {
  return `${info.base}${info.editorEndpoint}?file=${encodeURIComponent(target)}`;
}

/** Human-readable reason for a rejected request, using the endpoint's status. */
export function pluginOpenFailureMessage(status: number): string {
  if (status === 400) {
    return "The Vite plugin could not open that file. It must exist inside the plugin's project root.";
  }
  if (status === 403) {
    return "The Vite dev server refused this page. Check the plugin's origin and editor settings.";
  }
  if (status === 405) {
    return "The Vite plugin rejected the request method.";
  }
  return `The Vite plugin could not open the file (HTTP ${status}).`;
}
