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
 * True for Windows-style absolute paths: `C:/x`, `D:\x` and UNC
 * `\\server\share`. Drive-letter paths are absolute on every host, which is
 * what lets the helpers below treat them the same way on Linux (CI) as on
 * Windows (a developer machine).
 */
export function isWindowsAbsolutePath(value: string): boolean {
  const normalized = normalizePath(value);
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//");
}

/**
 * Collapse `.` / `..` segments and duplicate separators lexically. Unlike
 * `path.normalize` / `path.resolve` this never consults the host platform, so
 * a Windows path behaves identically on Windows, Linux and macOS.
 */
function collapsePathSegments(value: string): string {
  const normalized = normalizePath(value);
  let prefix = "";
  let rest = normalized;

  const drive = /^[A-Za-z]:\//.exec(normalized);
  if (drive) {
    prefix = drive[0];
    rest = normalized.slice(prefix.length);
  } else if (normalized.startsWith("//")) {
    prefix = "//";
    rest = normalized.slice(2);
  } else if (normalized.startsWith("/")) {
    prefix = "/";
    rest = normalized.slice(1);
  }

  const segments: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `${prefix}${segments.join("/")}`;
}

/** Remove trailing slashes while keeping a bare `/` and a drive root (`D:/`). */
function stripTrailingSlashes(value: string): string {
  let result = value;
  while (result.length > 1 && result.endsWith("/")) {
    if (/^[A-Za-z]:\/$/.test(result)) break;
    result = result.slice(0, -1);
  }
  return result;
}

function joinWithBase(base: string, file: string): string {
  const suffix = normalizePath(file).replace(/^\/+/, "");
  if (base === "") return collapsePathSegments(suffix);
  if (base === "/") return collapsePathSegments(`/${suffix}`);
  return collapsePathSegments(`${base}/${suffix}`);
}

function joinFromRoot(root: string, file: string): string {
  return joinWithBase(stripTrailingSlashes(normalizePath(root)), file);
}

/**
 * Lexically resolve `file` against `root`, without letting the host platform
 * decide what "absolute" means. Windows-style roots/paths keep Windows
 * semantics; everything else is resolved as a POSIX path.
 */
export function resolveFromRoot(root: string, file: string): string {
  const normalizedRoot = stripTrailingSlashes(normalizePath(root));
  const normalizedFile = normalizePath(file);

  if (isWindowsAbsolutePath(normalizedFile)) {
    return collapsePathSegments(normalizedFile);
  }
  if (isWindowsAbsolutePath(normalizedRoot)) {
    return joinFromRoot(normalizedRoot, normalizedFile);
  }
  if (normalizedFile.startsWith("/")) {
    // A leading slash under a POSIX-style root is an absolute POSIX path.
    return collapsePathSegments(normalizedFile);
  }
  if (!normalizedRoot.startsWith("/")) {
    // Relative roots keep the historical cwd-based resolution.
    return normalizePath(path.resolve(normalizedRoot, normalizedFile));
  }
  return joinFromRoot(normalizedRoot, normalizedFile);
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

  file = normalizePath(file);

  if (file.startsWith("/@fs/")) {
    file = file.slice("/@fs/".length);
    // Vite serves absolute paths as `/@fs/<absolute path>`. Windows keeps its
    // drive prefix (`/@fs/C:/x`); POSIX loses the leading slash (`/@fs/home/`).
    if (/^\/?[A-Za-z]:\//.test(file)) {
      file = file.replace(/^\//, "");
    } else if (
      !file.startsWith("/") &&
      (path.sep === "/" || !isWindowsAbsolutePath(root))
    ) {
      file = `/${file}`;
    }
  } else if (file.startsWith("/@id/")) {
    return undefined;
  } else if (/^\/[A-Za-z]:\//.test(file)) {
    file = file.slice(1);
  }

  return resolveFromRoot(root, file);
}

/**
 * Turn an absolute file path into a project-root-relative path, or `undefined`
 * when the file lives outside the project root.
 */
export function relativeToRoot(root: string, file: string): string | undefined {
  const normalizedRoot = stripTrailingSlashes(normalizePath(root));
  const normalizedFile = normalizePath(file);

  if (
    isWindowsAbsolutePath(normalizedRoot) ||
    isWindowsAbsolutePath(normalizedFile)
  ) {
    if (
      !isWindowsAbsolutePath(normalizedRoot) ||
      !isWindowsAbsolutePath(normalizedFile)
    ) {
      return undefined;
    }
    const rootPath = collapsePathSegments(normalizedRoot);
    const filePath = collapsePathSegments(normalizedFile);
    const rootKey = rootPath.toLowerCase();
    const fileKey = filePath.toLowerCase();
    if (fileKey === rootKey) return undefined;
    // `rootPath` may already end with a slash when it is a drive/UNC root.
    const rootPrefix = rootPath.endsWith("/") ? rootKey : `${rootKey}/`;
    if (!fileKey.startsWith(rootPrefix)) return undefined;
    return filePath.slice(rootPrefix.length);
  }

  const rootPath = collapsePathSegments(normalizedRoot);
  const filePath = collapsePathSegments(normalizedFile);
  if (!rootPath.startsWith("/") || !filePath.startsWith("/")) {
    // Preserve the historical cwd-relative behaviour for relative inputs.
    const rel = path.relative(normalizedRoot, normalizedFile);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    return normalizePath(rel);
  }
  if (rootPath === "/") {
    if (filePath === "/") return undefined;
    return filePath.slice(1);
  }
  if (!filePath.startsWith(`${rootPath}/`)) return undefined;
  return filePath.slice(rootPath.length + 1);
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
