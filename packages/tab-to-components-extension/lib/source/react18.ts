/**
 * React 18 source locations.
 *
 * React 18's `jsx-dev-runtime` stores the compiler-provided source object on
 * elements (`_source`), and react-dom copies it to the fiber as `_debugSource`:
 *
 *   { fileName: "D:/proj/src/App.tsx", lineNumber: 20, columnNumber: 9 }
 *
 * Babel's dev transform already emits a 1-based line and column, so no
 * adjustment is applied (unlike source-map columns, which are 0-based).
 */

import type { RawDebugSource } from "../protocol";
import {
  createLocation,
  isSafeRelativeFile,
  normalizeAbsolutePath,
  normalizeSlashes,
  stripRoot,
  type SourceLocation,
} from "./location";

export interface DebugSourceLocationOptions {
  /** Configured absolute project root for the current origin. */
  projectRoot: string | null;
}

/**
 * Convert a React 18 `_debugSource` value into a validated location.
 * `fileName` is usually absolute (Babel/plugin-react); relative paths from
 * exotic compilers are kept as relative-only locations.
 */
export function locationFromDebugSource(
  debugSource: RawDebugSource,
  { projectRoot }: DebugSourceLocationOptions = { projectRoot: null },
): SourceLocation | null {
  const fileName = debugSource.fileName.trim();
  if (fileName === "") return null;

  const absoluteFile = normalizeAbsolutePath(fileName);
  const relativeFile =
    absoluteFile !== null
      ? projectRoot
        ? stripRoot(absoluteFile, projectRoot)
        : null
      : isSafeRelativeFile(fileName)
        ? normalizeSlashes(fileName)
        : null;

  return createLocation({
    relativeFile,
    absoluteFile,
    line: debugSource.lineNumber,
    column: debugSource.columnNumber,
    source: "debug-source",
  });
}
