/**
 * Dev-server source-map resolution for React 19.
 *
 * React 19 ignores the JSX source argument and instead captures the call stack
 * at element creation (`fiber._debugStack`). The first application frame points
 * at the compiled `_jsxDEV(...)` call; mapping that generated position through
 * the module's source map returns the original JSX site — exactly the location
 * the Vite plugin would have injected as `data-ttc`.
 *
 * Vite serves each transformed module with an inline base64 source map whose
 * `file` is the absolute original path and whose `sources` are server-relative.
 * External maps (webpack/Next-style `//# sourceMappingURL=foo.js.map`) are
 * supported as a best effort.
 */

import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

import type { RawStackFrame } from "../protocol";
import {
  alignModulePath,
  createLocation,
  fileNameOf,
  fileUrlToPath,
  isSafeRelativeFile,
  joinRoot,
  normalizeAbsolutePath,
  normalizeSlashes,
  projectRootFrom,
  stripRoot,
  type SourceLocation,
} from "./location";

export interface RawSourceMap {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null> | null;
  names?: string[];
  mappings: string;
}

export interface SourceMapResolverOptions {
  /** Origin of the inspected frame; only same-origin modules are fetched. */
  pageOrigin: string;
  /** Configured absolute project root for the origin, when known. */
  projectRoot: string | null;
  /** Vite `base` (defaults to `/`); stripped from server-relative paths. */
  base?: string;
  /** Overridable for tests. */
  fetchText?: (url: string) => Promise<string | null>;
  /** Upper bound for cached modules; oldest entries are evicted. */
  maxCacheEntries?: number;
}

export interface SourceMapResolver {
  resolveFrame(frame: RawStackFrame): Promise<SourceLocation | null>;
  clear(): void;
}

export const MAX_MODULE_CHARS = 5_000_000;
export const MAX_MAP_CHARS = 20_000_000;
export const FETCH_TIMEOUT_MS = 3_000;

const SOURCE_MAPPING_URL_RE = /\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/gm;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Same-origin http(s) URL check; never fetch anything else. */
export function isSameOriginHttpUrl(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url, origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.origin === origin;
  } catch {
    return false;
  }
}

/** The last `sourceMappingURL` comment in a module, or `null`. */
export function extractSourceMapUrl(code: string): string | null {
  let match: RegExpExecArray | null;
  let last: string | null = null;
  SOURCE_MAPPING_URL_RE.lastIndex = 0;
  while ((match = SOURCE_MAPPING_URL_RE.exec(code)) !== null) {
    last = match[1] ?? null;
  }
  return last;
}

function decodeBase64Utf8(payload: string): string | null {
  const cleaned = payload.replace(/\s+/g, "");
  if (cleaned === "") return null;
  try {
    if (typeof atob === "function") {
      const binary = atob(cleaned);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      if (typeof TextDecoder === "function") {
        return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      }
      return binary;
    }
    const buffer = (globalThis as { Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } } })
      .Buffer;
    if (buffer) return buffer.from(cleaned, "base64").toString("utf8");
  } catch {
    return null;
  }
  return null;
}

/**
 * Decode a `data:` URL carrying JSON. Supports both base64 and
 * percent-encoded payloads, with or without a charset in the metadata.
 */
export function decodeDataUrl(url: string): string | null {
  if (!url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma === -1) return null;
  const metadata = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  if (/;base64/i.test(metadata)) return decodeBase64Utf8(payload);
  try {
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Absolute original paths dev servers embed in the *code* they serve, for the
 * bundlers/plugins verified so far:
 *
 *   Babel (@vitejs/plugin-react):  var _jsxFileName = "C:/proj/src/App.tsx";
 *   react-refresh:                 RefreshRuntime.register(type, "C:/proj/src/App.tsx" + ' ' + id)
 *   esbuild (jsxDEV source arg):   { fileName: "C:/proj/src/App.tsx", lineNumber: 4, … }
 *
 * This matters because the inline dev source map does not always carry the
 * absolute path (`file` is often absent and `sources` are server-relative), so
 * without this a React 19 location would have no path the editor can open.
 */
const EMBEDDED_FILE_NAME_PATTERNS: readonly RegExp[] = [
  /_jsxFileName\s*=\s*("(?:[^"\\]|\\.)*")/g,
  /\bfileName\s*:\s*("(?:[^"\\]|\\.)*")/g,
  /RefreshRuntime\.register\(\s*[^,]+,\s*("(?:[^"\\]|\\.)*")/g,
  /\$RefreshReg\$\(\s*[^,]+,\s*("(?:[^"\\]|\\.)*")/g,
];

/** Decode a JS double/single-quoted string literal body into plain text. */
function decodeStringLiteral(literal: string): string | null {
  if (literal.length < 2) return null;
  const quote = literal[0];
  const last = literal[literal.length - 1];
  if ((quote !== '"' && quote !== "'") || last !== quote) return null;
  const body = literal.slice(1, -1);
  if (body === "") return null;
  return body.replace(
    /\\(u[0-9a-fA-F]{4}|["'\\/bfnrt])/g,
    (_match, escape: string) => {
      if (escape.length === 5 && escape[0] === "u") {
        return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
      }
      switch (escape) {
        case "b":
          return "\b";
        case "f":
          return "\f";
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        default:
          return escape;
      }
    },
  );
}

/**
 * Recover the absolute original path a transformed dev module was compiled
 * from. `expectedFileName` (a base name such as `App.tsx`) keeps unrelated
 * strings from being mistaken for the module itself.
 */
export function absoluteModuleFileFromCode(
  code: string,
  expectedFileName: string | null = null,
): string | null {
  if (typeof code !== "string" || code === "") return null;
  for (const pattern of EMBEDDED_FILE_NAME_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      const literal = match[1];
      if (literal === undefined) continue;
      const decoded = decodeStringLiteral(literal);
      if (decoded === null) continue;
      const absolute = normalizeAbsolutePath(decoded);
      if (absolute === null) continue;
      if (expectedFileName !== null && expectedFileName !== "") {
        const base = absolute.slice(absolute.lastIndexOf("/") + 1);
        if (base.toLowerCase() !== expectedFileName.toLowerCase()) continue;
      }
      return absolute;
    }
  }
  return null;
}

/** Parse and validate a raw source-map JSON payload. */
export function parseSourceMap(text: string): RawSourceMap | null {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_MAP_CHARS) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== 3) return null;
    if (typeof parsed.mappings !== "string") return null;
    if (!Array.isArray(parsed.sources)) return null;
    const sources = parsed.sources.filter(
      (source): source is string => typeof source === "string",
    );
    if (sources.length === 0) return null;
    const map: RawSourceMap = {
      version: 3,
      sources,
      mappings: parsed.mappings,
    };
    if (typeof parsed.file === "string") map.file = parsed.file;
    if (typeof parsed.sourceRoot === "string") map.sourceRoot = parsed.sourceRoot;
    if (Array.isArray(parsed.names)) map.names = parsed.names as string[];
    return map;
  } catch {
    return null;
  }
}

interface SourcePaths {
  relativeFile: string | null;
  absoluteFile: string | null;
}

const EMPTY_PATHS: SourcePaths = { relativeFile: null, absoluteFile: null };

/** `/app/src/App.tsx` + base `/app/` → `src/App.tsx`. */
function serverPathToRelative(pathname: string, base: string): string | null {
  if (pathname.startsWith("/@fs/")) return null;
  let path = pathname;
  const normalizedBase = base === "" ? "/" : base.endsWith("/") ? base : `${base}/`;
  if (normalizedBase !== "/" && path.startsWith(normalizedBase)) {
    path = path.slice(normalizedBase.length);
  }
  path = path.replace(/^\/+/, "");
  return isSafeRelativeFile(path) ? path : null;
}

/**
 * Turn a source-map `sources` entry into filesystem paths.
 *
 * Handles Vite `/@fs/…` URLs, absolute `file://` URLs, webpack namespaces
 * (`webpack://app/./src/App.tsx`) and plain server-relative paths.
 */
export function pathsFromSource(
  source: string,
  moduleUrl: string,
  base: string,
): SourcePaths {
  const cleaned = source.trim();
  if (cleaned === "") return EMPTY_PATHS;

  if (cleaned.startsWith("/@fs/")) {
    const absolute = normalizeAbsolutePath(
      safeDecode(cleaned.slice("/@fs/".length)),
    );
    return { relativeFile: null, absoluteFile: absolute };
  }
  if (cleaned.startsWith("file://")) {
    const absolute = normalizeAbsolutePath(fileUrlToPath(cleaned) ?? "");
    return { relativeFile: null, absoluteFile: absolute };
  }
  if (cleaned.startsWith("webpack://")) {
    const rest = cleaned.slice("webpack://".length);
    const marker = rest.lastIndexOf("/./");
    const withoutNamespace =
      marker >= 0 ? rest.slice(marker + 3) : rest.replace(/^[^/]*\//, "");
    const decoded = safeDecode(withoutNamespace).replace(/^\/+/, "");
    return {
      relativeFile: isSafeRelativeFile(decoded) ? decoded : null,
      absoluteFile: null,
    };
  }
  if (SCHEME_RE.test(cleaned) && !/^https?:/i.test(cleaned)) {
    // Unknown scheme (e.g. `webpack-internal:`, `data:`): not usable.
    return EMPTY_PATHS;
  }

  let pathname: string | null = null;
  if (cleaned.startsWith("/")) {
    pathname = cleaned;
  } else {
    try {
      pathname = new URL(cleaned, moduleUrl).pathname;
    } catch {
      pathname = null;
    }
  }
  if (pathname === null) return EMPTY_PATHS;

  const relativeFile = serverPathToRelative(safeDecode(pathname), base);
  return { relativeFile, absoluteFile: null };
}

/** `root + relative` for templates/paths that need an absolute file. */
function deriveAbsoluteFile(
  relativeFile: string | null,
  root: string | null,
): string | null {
  if (relativeFile === null || root === null) return null;
  return joinRoot(root, relativeFile);
}

interface LoadedModule {
  tracer: TraceMap;
  map: RawSourceMap;
  moduleUrl: string;
  /** Absolute original file recovered from the module's own code, if any. */
  absoluteFile: string | null;
}

function isAbsoluteMapFile(value: string | undefined): string | null {
  if (value === undefined) return null;
  return normalizeAbsolutePath(value);
}

/**
 * A map's `file` field is authoritative for the original absolute path when
 * the map describes a single source (Vite's per-module maps do). For multi
 * source maps the field may describe a bundle instead, so only trust it when
 * the mapped source's base name matches.
 */
function absoluteFileFromMap(
  map: RawSourceMap,
  source: string,
  fallback: string | null,
  distrustMapFile = false,
): string | null {
  if (fallback !== null) return fallback;
  if (distrustMapFile) return null;
  const mapFile = isAbsoluteMapFile(map.file);
  if (mapFile === null) return null;
  const sourceBase = source.slice(Math.max(source.lastIndexOf("/"), source.lastIndexOf("\\")) + 1);
  const fileBase = mapFile.slice(mapFile.lastIndexOf("/") + 1);
  if (
    map.sources.length === 1 ||
    (sourceBase !== "" && sourceBase.toLowerCase() === fileBase.toLowerCase())
  ) {
    return mapFile;
  }
  return null;
}

/** The dev-server URL path of a module (`/src/App.tsx?t=1` → `/src/App.tsx`). */
function modulePathnameOf(moduleUrl: string): string | null {
  try {
    return new URL(moduleUrl).pathname;
  } catch {
    return null;
  }
}

/**
 * Whether a map `file` value is the server URL path (`/src/App.tsx` or
 * `/cats/src/App.tsx`) rather than a filesystem path. Dev servers have emitted
 * both; a server path must never reach an editor URL, where VS Code would
 * resolve it against the drive root instead of the project.
 */
function isServerRelativeMapPath(
  value: string,
  modulePathname: string | null,
  moduleRelative: string | null,
  basePrefix: string,
): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (modulePathname !== null && value === modulePathname) return true;
  if (moduleRelative === null) return false;
  if (value === `/${moduleRelative}`) return true;
  const normalizedBase = basePrefix.endsWith("/") ? basePrefix : `${basePrefix}/`;
  return value === `${normalizedBase}${moduleRelative}`;
}

function defaultFetchText(url: string): Promise<string | null> {
  const pending = fetch(url, { credentials: "same-origin" }).then(async (response) => {
    if (!response.ok) return null;
    const text = await response.text();
    return text.length > MAX_MODULE_CHARS ? null : text;
  });
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    return Promise.race([
      pending.finally(() => clearTimeout(timer)),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), FETCH_TIMEOUT_MS + 250);
      }),
    ]).catch(() => null);
  }
  return pending.catch(() => null);
}

/**
 * Create a resolver that maps React 19 stack frames through dev-server source
 * maps. Fetches and parsed maps are cached per module URL (Vite's `?t=` query
 * busts the cache after HMR).
 */
export function createSourceMapResolver(
  options: SourceMapResolverOptions,
): SourceMapResolver {
  const {
    pageOrigin,
    projectRoot,
    base = "/",
    fetchText = defaultFetchText,
    maxCacheEntries = 128,
  } = options;
  const cache = new Map<string, Promise<LoadedModule | null>>();

  function loadModule(moduleUrl: string): Promise<LoadedModule | null> {
    const cached = cache.get(moduleUrl);
    if (cached !== undefined) return cached;
    const pending = (async (): Promise<LoadedModule | null> => {
      try {
        const code = await fetchText(moduleUrl);
        if (code === null) return null;
        const modulePath = modulePathnameOf(moduleUrl);
        const absoluteFile =
          modulePath === null
            ? null
            : absoluteModuleFileFromCode(code, fileNameOf(safeDecode(modulePath)));
        const mapUrl = extractSourceMapUrl(code);
        if (mapUrl === null) return null;

        let mapText: string | null;
        if (mapUrl.startsWith("data:")) {
          mapText = decodeDataUrl(mapUrl);
        } else {
          let absoluteMapUrl: string;
          try {
            absoluteMapUrl = new URL(mapUrl, moduleUrl).href;
          } catch {
            return null;
          }
          if (!isSameOriginHttpUrl(absoluteMapUrl, pageOrigin)) return null;
          mapText = await fetchText(absoluteMapUrl);
        }
        if (mapText === null) return null;
        const map = parseSourceMap(mapText);
        if (map === null) return null;
        return {
          tracer: new TraceMap(
            map as unknown as ConstructorParameters<typeof TraceMap>[0],
          ),
          map,
          moduleUrl,
          absoluteFile,
        };
      } catch {
        return null;
      }
    })();
    cache.set(moduleUrl, pending);
    if (cache.size > maxCacheEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return pending;
  }

  async function resolveFrame(frame: RawStackFrame): Promise<SourceLocation | null> {
    if (!isSameOriginHttpUrl(frame.url, pageOrigin)) return null;
    const moduleUrl = (() => {
      try {
        const parsed = new URL(frame.url, pageOrigin);
        parsed.hash = "";
        return parsed.href;
      } catch {
        return frame.url;
      }
    })();

    const loaded = await loadModule(moduleUrl);
    if (loaded === null) return null;

    let position: { source: string | null; line: number | null; column: number | null };
    try {
      position = originalPositionFor(loaded.tracer, {
        line: frame.line,
        column: Math.max(0, frame.column - 1),
      });
    } catch {
      return null;
    }
    if (position.source === null || position.line === null) return null;

    const modulePathname = modulePathnameOf(moduleUrl);
    const decodedPathname = modulePathname === null ? null : safeDecode(modulePathname);
    // Aligning the served URL with the module's real absolute path recovers
    // both the project-relative path and a non-root dev-server base
    // (`/cats/app/routes/home.tsx` on disk at `C:/proj/app/routes/home.tsx`),
    // which the configured `base` may not reflect. `/@fs/` URLs already carry
    // the absolute path, so they are left to the normal path parsing.
    const alignment =
      decodedPathname !== null && !decodedPathname.startsWith("/@fs/")
        ? alignModulePath(decodedPathname, loaded.absoluteFile)
        : null;
    const effectiveBase = alignment?.basePrefix ?? base;
    const paths = pathsFromSource(position.source, moduleUrl, effectiveBase);
    // The project root can be recovered from the module's own absolute path
    // even when the source map carries neither `file` nor absolute `sources`,
    // as is the case for Vite dev servers. Every mapped location can then be
    // made absolute.
    const moduleRelative =
      alignment?.relativeFile ??
      (decodedPathname === null
        ? null
        : serverPathToRelative(decodedPathname, effectiveBase));
    const inferredRoot = projectRootFrom(loaded.absoluteFile, moduleRelative);
    const relativeFile =
      paths.relativeFile ??
      (projectRoot && paths.absoluteFile
        ? stripRoot(paths.absoluteFile, projectRoot)
        : null);
    const mapFile = isAbsoluteMapFile(loaded.map.file);
    const distrustMapFile =
      mapFile !== null &&
      isServerRelativeMapPath(
        mapFile,
        modulePathname,
        moduleRelative,
        effectiveBase,
      );
    const absoluteFile =
      absoluteFileFromMap(loaded.map, position.source, paths.absoluteFile, distrustMapFile) ??
      deriveAbsoluteFile(relativeFile, projectRoot ?? inferredRoot);
    const effectiveRelative =
      relativeFile ??
      (absoluteFile !== null
        ? stripRoot(absoluteFile, projectRoot ?? inferredRoot)
        : null);

    return createLocation({
      relativeFile: effectiveRelative,
      absoluteFile,
      line: position.line,
      column: (position.column ?? 0) + 1,
      source: "source-map",
    });
  }

  return {
    resolveFrame,
    clear() {
      cache.clear();
    },
  };
}

/** Exposed for diagnostics/tests: normalized map path helpers. */
export function normalizeMapPath(value: string): string {
  return normalizeSlashes(value);
}
