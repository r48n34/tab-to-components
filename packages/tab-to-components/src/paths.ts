import path from "node:path";

export const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

export interface ResolvedIdParts {
  /** Absolute file path, forward-slash normalised. */
  file: string;
  /** Project-root-relative path with forward slashes. */
  rel: string;
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Convert a Vite module id (absolute path, root-relative URL, `/@fs/` URL, or
 * any of those with a query string) into an absolute file path.
 * Returns `undefined` for virtual modules and anything that cannot be mapped.
 */
export function toFilePath(id: string, root: string): string | undefined {
  if (!id || id.startsWith("\0") || id.startsWith("virtual:")) return undefined;

  const queryIndex = id.indexOf("?");
  let file =
    queryIndex === -1
      ? id
      : id.slice(0, queryIndex);

  if (!file) return undefined;

  // `#` only appears in ids as a fragment marker in exotic setups.
  const hashIndex = file.indexOf("#");
  if (hashIndex !== -1) file = file.slice(0, hashIndex);

  try {
    if (/%[0-9a-f]{2}/i.test(file)) file = decodeURIComponent(file);
  } catch {
    return undefined;
  }

  if (file.startsWith("/@fs/")) {
    file = file.slice("/@fs/".length);
    // Vite serves absolute paths as `/@fs/<absolute path>`. Windows keeps its
    // drive prefix (`/@fs/C:/x`); POSIX loses the leading slash (`/@fs/home/`).
    if (/^\/?[A-Za-z]:\//.test(file)) file = file.replace(/^\//, "");
    else if (path.sep === "/" && !file.startsWith("/")) file = `/${file}`;
  } else if (file.startsWith("/@id/")) {
    return undefined;
  } else if (/^\/[A-Za-z]:\//.test(file)) {
    file = file.slice(1);
  } else if (path.sep === "\\" && file.startsWith("/")) {
    // Root-relative URL on Windows, e.g. `/app/routes/home.tsx`. On POSIX a
    // leading slash is an absolute filesystem path and must fall through.
    return path.resolve(root, `.${file}`).replace(/\\/g, "/");
  }

  if (!path.isAbsolute(file)) {
    return path.resolve(root, file).replace(/\\/g, "/");
  }

  return path.normalize(file).replace(/\\/g, "/");
}

/**
 * Turn an absolute file path into a project-root-relative path, or `undefined`
 * when the file lives outside the project root.
 */
export function relativeToRoot(root: string, file: string): string | undefined {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return normalizePath(rel);
}

const DEFAULT_EXCLUDES = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.react-router\//,
  /(^|\/)\.vite\//,
  /(^|\/)\.git\//,
  /(^|\/)public\//,
];

export function isDeclarationFile(file: string): boolean {
  return /\.d\.[cm]?[jt]s$/.test(file);
}

export function isSourceFile(file: string): boolean {
  if (isDeclarationFile(file)) return false;
  return SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/**
 * Queries that mean "this is not the module's executable source": raw imports,
 * asset URLs, inline strings, workers and CSS modules come through as data and
 * must not be rewritten.
 */
export function isNonExecutableQuery(query: string): boolean {
  if (!query) return false;
  const params = new URLSearchParams(query);
  return (
    params.has("raw") ||
    params.has("url") ||
    params.has("inline") ||
    params.has("worker") ||
    params.has("direct")
  );
}

export interface CreateFilterOptions {
  include?: RegExp[];
  exclude?: RegExp[];
}

/**
 * Resolve a module id into everything the transform needs, or `undefined` when
 * the module should be left untouched.
 */
export function resolveModuleId(
  id: string,
  root: string,
  filter: CreateFilterOptions,
): ResolvedIdParts | undefined {
  if (!id || id.startsWith("\0") || id.startsWith("virtual:")) return undefined;

  const queryIndex = id.indexOf("?");
  const query = queryIndex === -1 ? "" : id.slice(queryIndex + 1);
  if (isNonExecutableQuery(query)) return undefined;

  const file = toFilePath(id, root);
  if (!file) return undefined;
  if (!isSourceFile(file)) return undefined;
  if (/\/node_modules\//.test(file)) return undefined;

  const rel = relativeToRoot(root, file);
  if (!rel) return undefined;

  for (const pattern of DEFAULT_EXCLUDES) {
    if (pattern.test(rel)) return undefined;
  }
  for (const pattern of filter.exclude ?? []) {
    if (pattern.test(rel)) return undefined;
  }
  if (filter.include && filter.include.length > 0) {
    if (!filter.include.some((pattern) => pattern.test(rel))) return undefined;
  }

  return { file, rel };
}

const ENTRY_CLIENT_RE = /(^|\/)entry\.client\.[cm]?[jt]sx?$/;

export function isClientEntryModule(rel: string): boolean {
  return ENTRY_CLIENT_RE.test(rel);
}
