/**
 * Source locations and the path rules shared by the extension.
 *
 * A location can carry a project-relative path, an absolute path on the
 * dev-server machine, or both:
 *
 * - the Vite plugin's `data-ttc` marker only has the project-relative path;
 * - React 18's `_debugSource.fileName` only has the absolute path;
 * - Vite's dev source maps have both (`sources` + the absolute `file` field).
 *
 * Everything that reaches an editor URL or the clipboard is validated here:
 * page-authored data is untrusted, so absolute paths, `..` segments, control
 * characters and over-long values are rejected before use.
 */

/** Where a location was recovered from. */
export type LocationSource = "marker" | "debug-source" | "source-map";

/** A JSX site; line and column are 1-based and point at the element/component. */
export interface SourceLocation {
  /** Best display path: project-relative when known, otherwise absolute. */
  file: string;
  /** Project-relative posix path, when known (`src/App.tsx`). */
  relativeFile: string | null;
  /** Absolute path on the dev-server machine, when known (`D:/proj/src/App.tsx`). */
  absoluteFile: string | null;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  /** Which layer produced the location. */
  source: LocationSource;
}

/** A raw `data-ttc` marker value: `<relative-path>:<line>:<column>`. */
export interface SourceMarker {
  file: string;
  line: number;
  column: number;
}

export const MAX_PATH_LENGTH = 1024;
export const MAX_POSITION = 10_000_000;

const DECIMAL = /^\d+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WINDOWS_DRIVE = /^[A-Za-z]:\//;
const URL_SCHEME_PATH = /^\/[A-Za-z][A-Za-z0-9+.-]*:/;

/** Backslashes to forward slashes; everything else is preserved. */
export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Whether `file` is a plain project-relative posix path. */
export function isSafeRelativeFile(file: unknown): file is string {
  if (typeof file !== "string") return false;
  if (file === "" || file.length > MAX_PATH_LENGTH) return false;
  if (CONTROL_CHARS.test(file)) return false;
  const normalized = normalizeSlashes(file);
  if (normalized.startsWith("/")) return false;
  if (WINDOWS_DRIVE.test(normalized)) return false;
  return !normalized.split("/").includes("..");
}

/**
 * Whether `file` looks like an absolute filesystem path (Windows drive, UNC or
 * POSIX). A bare `/src/App.tsx` is accepted: on POSIX that is a valid absolute
 * path, and URL-derived paths are normalised into relative paths before they
 * reach this check.
 */
export function isSafeAbsolutePath(file: unknown): file is string {
  if (typeof file !== "string") return false;
  if (file === "" || file.length > MAX_PATH_LENGTH) return false;
  if (CONTROL_CHARS.test(file)) return false;
  const normalized = normalizeSlashes(file);
  if (WINDOWS_DRIVE.test(normalized)) return true;
  if (normalized.startsWith("//")) return true;
  if (normalized.startsWith("/")) return !URL_SCHEME_PATH.test(normalized);
  return false;
}

/** Parse a raw `data-ttc` attribute value; `null` when missing or malformed. */
export function parseMarker(value: unknown): SourceMarker | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;

  const columnSeparator = text.lastIndexOf(":");
  if (columnSeparator <= 0) return null;
  const columnText = text.slice(columnSeparator + 1);
  const rest = text.slice(0, columnSeparator);

  const lineSeparator = rest.lastIndexOf(":");
  if (lineSeparator <= 0) return null;
  const lineText = rest.slice(lineSeparator + 1);
  const file = rest.slice(0, lineSeparator);
  if (!isSafeRelativeFile(file)) return null;

  if (!DECIMAL.test(lineText) || !DECIMAL.test(columnText)) return null;
  const line = Number.parseInt(lineText, 10);
  const column = Number.parseInt(columnText, 10);
  if (!Number.isSafeInteger(line) || line < 1 || line > MAX_POSITION) return null;
  if (!Number.isSafeInteger(column) || column < 1 || column > MAX_POSITION) {
    return null;
  }
  return { file, line, column };
}

/** `src/App.tsx:12:5` */
export function formatLocation(location: {
  file: string;
  line: number;
  column: number;
}): string {
  return `${location.file}:${location.line}:${location.column}`;
}

/** `app/routes/home.tsx:19:7` from a parsed marker. */
export function formatMarker(marker: SourceMarker): string {
  return formatLocation(marker);
}

/** `home.tsx` for `app/routes/home.tsx`; accepts either separator. */
export function fileNameOf(file: string): string {
  const separator = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return separator === -1 ? file : file.slice(separator + 1);
}

/** `<Button />` */
export function formatNameLabel(name: string): string {
  return `<${name} />`;
}

/** `<button />  app/components/Button.tsx:6:10` */
export function formatEntryLabel(entry: {
  name: string;
  location: SourceLocation;
}): string {
  return `${formatNameLabel(entry.name)}  ${formatLocation(entry.location)}`;
}

/** Join an absolute project root and a project-relative path. */
export function joinRoot(root: string, relativeFile: string): string | null {
  const normalizedRoot = normalizeSlashes(root).replace(/\/+$/, "");
  const relative = normalizeSlashes(relativeFile).replace(/^\/+/, "");
  if (normalizedRoot === "") return null;
  if (!isSafeRelativeFile(relative)) return null;
  return `${normalizedRoot}/${relative}`;
}

/**
 * Strip `root` from an absolute path, returning the project-relative part.
 * Matching is case-insensitive so Windows paths compare correctly.
 */
export function stripRoot(
  absoluteFile: string,
  root: string | null,
): string | null {
  if (!root) return null;
  const normalizedFile = normalizeSlashes(absoluteFile);
  const normalizedRoot = normalizeSlashes(root).replace(/\/+$/, "");
  if (normalizedRoot === "") return null;
  const fileLower = normalizedFile.toLowerCase();
  const rootLower = normalizedRoot.toLowerCase();
  if (!fileLower.startsWith(`${rootLower}/`)) return null;
  const relative = normalizedFile.slice(normalizedRoot.length + 1);
  return isSafeRelativeFile(relative) ? relative : null;
}

/**
 * The inverse of `stripRoot`: given an absolute file and its project-relative
 * path (`D:/proj/src/App.tsx` + `src/App.tsx`), return the project root
 * (`D:/proj`). Used to recover the project root from a dev module whose
 * absolute path is known, so locations that only carry a project-relative path
 * can still be turned into absolute ones.
 *
 * Returns `null` when the two paths do not agree or the result is unusable
 * (e.g. a bare filesystem root, which `joinRoot` cannot round-trip).
 */
export function projectRootFrom(
  absoluteFile: string | null,
  relativeFile: string | null,
): string | null {
  if (absoluteFile === null || relativeFile === null) return null;
  const absolute = normalizeSlashes(absoluteFile);
  const relative = normalizeSlashes(relativeFile).replace(/^\/+/, "");
  if (!isSafeAbsolutePath(absolute)) return null;
  if (!isSafeRelativeFile(relative)) return null;
  const suffix = `/${relative}`;
  if (absolute.length <= suffix.length) return null;
  if (absolute.toLowerCase().slice(-suffix.length) !== suffix.toLowerCase()) {
    return null;
  }
  const root = absolute.slice(0, absolute.length - suffix.length);
  if (root === "") return null;
  return isSafeAbsolutePath(root) ? root : null;
}

/** What a module URL tells us once it is aligned with its absolute file. */
export interface ModulePathAlignment {
  /** Project-relative path the dev server serves (`app/routes/home.tsx`). */
  relativeFile: string;
  /** URL prefix the dev server mounts the project on (`/cats/`, or `/`). */
  basePrefix: string;
}

/**
 * Align a module's URL path with the absolute file the bundler embedded in it.
 *
 * A dev server may mount the project under a non-root base
 * (`/cats/app/routes/home.tsx` on disk at
 * `C:/proj/app/routes/home.tsx`). Comparing the two from the end recovers both
 * the project-relative path and the base prefix without trusting any
 * configuration:
 *
 *   `/cats/app/routes/home.tsx` + `C:/proj/app/routes/home.tsx`
 *     → { relativeFile: "app/routes/home.tsx", basePrefix: "/cats/" }
 */
export function alignModulePath(
  modulePathname: string,
  absoluteFile: string | null,
): ModulePathAlignment | null {
  if (absoluteFile === null) return null;
  const pathname = normalizeSlashes(modulePathname);
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
  const absolute = normalizeSlashes(absoluteFile);
  if (!isSafeAbsolutePath(absolute)) return null;

  const urlSegments = pathname.split("/").filter((segment) => segment !== "");
  if (urlSegments.length === 0) return null;
  const fileSegments = absolute.split("/");

  let matched = 0;
  while (matched < urlSegments.length && matched < fileSegments.length) {
    const urlSegment = urlSegments[urlSegments.length - 1 - matched];
    const fileSegment = fileSegments[fileSegments.length - 1 - matched];
    if (urlSegment === undefined || fileSegment === undefined) break;
    if (urlSegment.toLowerCase() !== fileSegment.toLowerCase()) break;
    matched += 1;
  }
  if (matched === 0) return null;

  const relativeFile = urlSegments.slice(urlSegments.length - matched).join("/");
  if (!isSafeRelativeFile(relativeFile)) return null;
  const prefixSegments = urlSegments.slice(0, urlSegments.length - matched);
  const basePrefix =
    prefixSegments.length === 0 ? "/" : `/${prefixSegments.join("/")}/`;
  return { relativeFile, basePrefix };
}

/** Turn a `file://` URL into a filesystem path; `null` when malformed. */
export function fileUrlToPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;
    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
    return pathname;
  } catch {
    return null;
  }
}

/**
 * Normalise an absolute path as reported by a bundler: forward slashes,
 * `file://` URLs converted, a leading slash before a drive letter removed.
 * Returns `null` for unsafe or malformed input.
 */
export function normalizeAbsolutePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let path = trimmed.startsWith("file://") ? fileUrlToPath(trimmed) : trimmed;
  if (path === null) return null;
  path = normalizeSlashes(path);
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  return isSafeAbsolutePath(path) ? path : null;
}

/**
 * Build the best display path for a location: relative when known, otherwise
 * absolute, otherwise the bare file name.
 */
export function displayFileOf(location: SourceLocation): string {
  if (location.relativeFile !== null) return location.relativeFile;
  if (location.absoluteFile !== null) return location.absoluteFile;
  return location.file;
}

/**
 * Resolve the absolute path of a location: the known absolute path first, then
 * `configured root + relative path`. Returns `null` when neither is possible.
 */
export function resolveAbsoluteLocation(
  location: SourceLocation,
  root: string | null,
): string | null {
  if (location.absoluteFile !== null) return location.absoluteFile;
  const relative = location.relativeFile;
  if (root && relative) return joinRoot(root, relative);
  return null;
}

/** Validate a 1-based position pair. */
export function isValidPosition(line: unknown, column: unknown): boolean {
  return (
    typeof line === "number" &&
    Number.isSafeInteger(line) &&
    line >= 1 &&
    line <= MAX_POSITION &&
    typeof column === "number" &&
    Number.isSafeInteger(column) &&
    column >= 1 &&
    column <= MAX_POSITION
  );
}

/** Build a location, or `null` when the position or path is unusable. */
export function createLocation(input: {
  relativeFile: string | null;
  absoluteFile: string | null;
  line: number;
  column: number;
  source: LocationSource;
}): SourceLocation | null {
  if (!isValidPosition(input.line, input.column)) return null;
  const relative =
    input.relativeFile !== null && isSafeRelativeFile(input.relativeFile)
      ? normalizeSlashes(input.relativeFile)
      : null;
  const absolute =
    input.absoluteFile !== null ? normalizeAbsolutePath(input.absoluteFile) : null;
  const file = relative ?? absolute;
  if (file === null) return null;
  return {
    file,
    relativeFile: relative,
    absoluteFile: absolute,
    line: input.line,
    column: input.column,
    source: input.source,
  };
}
