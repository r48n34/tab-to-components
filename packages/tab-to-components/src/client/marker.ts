/**
 * Parsing and formatting for the `data-ttc` marker attributes injected by the
 * plugin transform.
 *
 * Marker format: `<relative-posix-path>:<line>:<column>` with 1-based line and
 * column, e.g. `app/routes/home.tsx:19:7`.
 */

/** A location inside a project source file. */
export interface SourceMarker {
  /** Posix path relative to the project root. */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
}

const DECIMAL = /^\d+$/;

/**
 * Parse a raw `data-ttc` attribute value. Returns `null` for missing or
 * malformed values instead of throwing.
 */
export function parseMarker(value: string | null | undefined): SourceMarker | null {
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
  if (file === "") return null;

  if (!DECIMAL.test(lineText) || !DECIMAL.test(columnText)) return null;
  const line = Number.parseInt(lineText, 10);
  const column = Number.parseInt(columnText, 10);
  if (!Number.isSafeInteger(line) || line < 1) return null;
  if (!Number.isSafeInteger(column) || column < 1) return null;

  return { file, line, column };
}

/** `app/routes/home.tsx:19:7` */
export function formatMarker(marker: SourceMarker): string {
  return `${marker.file}:${marker.line}:${marker.column}`;
}

/** Anything with the pair of fields needed for a label. */
export interface LabelInput {
  name: string;
  marker: SourceMarker;
}

/** `<button />  app/components/Button.tsx:6:10` (two spaces pad the menu rows). */
export function formatEntryLabel(entry: LabelInput): string {
  return `${formatNameLabel(entry.name)}  ${formatMarker(entry.marker)}`;
}

/** `<Button />` */
export function formatNameLabel(name: string): string {
  return `<${name} />`;
}
