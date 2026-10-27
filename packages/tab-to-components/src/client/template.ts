/**
 * Custom action clipboard templates.
 *
 * A `customActions` entry carries a `copy` template that is expanded in the
 * browser from the clicked source marker and its component chain. Templates are
 * data only (the plugin serializes them into the client config), so they never
 * reach the dev server and cannot open files or run commands.
 *
 * Supported placeholders: `{file}`, `{absPath}`, `{name}`, `{line}`,
 * `{column}`, `{location}` and `{chain}`. Unknown `{tokens}` are left untouched
 * so a template can still contain literal braces.
 */

import type { ChainEntry } from "./chain";
import { resolveFullPath } from "./marker";

/** Everything a custom action template can read. */
export interface ActionContext {
  /** The entry the picker acts on (nearest component usage site by default). */
  entry: ChainEntry;
  /** The full marked chain, innermost first (as returned by `getComponentChain`). */
  chain: ChainEntry[];
  /** Injected project root, used by `{absPath}`. */
  root: string;
}

/** Hard cap on clipboard text produced from one action. */
export const MAX_ACTION_TEXT = 4000;
/** Default length of the one-line preview shown in the picker's detail column. */
export const ACTION_PREVIEW_LENGTH = 96;
/** Longest display name copied into a template (`data-ttc-name` is untrusted). */
const MAX_ACTION_NAME = 120;
/** Longest path copied from a template (`data-ttc` is page-tamperable). */
const MAX_ACTION_PATH = 1024;

/**
 * Control characters and bidi overrides can spoof a pasted path or label, so
 * they are stripped before either reaches the clipboard.
 */
const UNSAFE_TEXT_CHARS =
  /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

/** One display name, safe to paste (single line, no control/bidi characters). */
export function sanitizeActionName(name: string): string {
  if (typeof name !== "string") return "";
  const cleaned = name
    .replace(UNSAFE_TEXT_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length <= MAX_ACTION_NAME
    ? cleaned
    : `${cleaned.slice(0, MAX_ACTION_NAME - 1)}…`;
}

/**
 * A path shown in copied context, safe to paste: control and bidi characters
 * stripped and capped. `data-ttc` can be authored by application markup, so
 * the marker path is treated as untrusted here just like the display name.
 */
export function sanitizeActionPath(file: string): string {
  if (typeof file !== "string") return "";
  const cleaned = file.replace(UNSAFE_TEXT_CHARS, "");
  return cleaned.length <= MAX_ACTION_PATH
    ? cleaned
    : `${cleaned.slice(0, MAX_ACTION_PATH - 1)}…`;
}

/** `file:line:column` for copied context, with a sanitized path. */
export function formatActionMarker(marker: ActionContext["entry"]["marker"]): string {
  return `${sanitizeActionPath(marker.file)}:${marker.line}:${marker.column}`;
}

/** The chain with the outermost component first, falling back to the entry. */
export function orderedChain(context: ActionContext): ChainEntry[] {
  const chain = context.chain.length > 0 ? context.chain : [context.entry];
  return [...chain].reverse();
}

/** `App > Card > Button` (outermost first). */
export function formatChainNames(context: ActionContext): string {
  return orderedChain(context)
    .map((entry) => sanitizeActionName(entry.name))
    .filter((name) => name !== "")
    .join(" > ");
}

function templateValues(context: ActionContext): Record<string, string> {
  const { entry, root } = context;
  const marker = entry.marker;
  const file = sanitizeActionPath(marker.file);
  return {
    file,
    absPath: resolveFullPath({ ...marker, file }, root),
    name: sanitizeActionName(entry.name),
    line: String(marker.line),
    column: String(marker.column),
    location: formatActionMarker(marker),
    chain: formatChainNames(context),
  };
}

/** Cap clipboard text so an extreme chain cannot produce a huge clipboard write. */
export function limitActionText(text: string): string {
  return text.length <= MAX_ACTION_TEXT
    ? text
    : `${text.slice(0, MAX_ACTION_TEXT - 1)}…`;
}

/** Expand one template; unknown `{tokens}` stay literal. */
export function expandActionTemplate(
  template: string,
  context: ActionContext,
): string {
  const values = templateValues(context);
  const expanded = template.replace(
    /\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
    (match, token: string) => {
      // Only the documented own properties expand: a plain object would
      // otherwise resolve `{constructor}` / `{toString}` to function source.
      const value = Object.hasOwn(values, token) ? values[token] : undefined;
      return value ?? match;
    },
  );
  return limitActionText(expanded);
}

/** Flatten a (possibly multi-line) clipboard value for a picker detail row. */
export function previewActionText(
  text: string,
  maxLength: number = ACTION_PREVIEW_LENGTH,
): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= maxLength
    ? flat
    : `${flat.slice(0, maxLength - 1)}…`;
}
