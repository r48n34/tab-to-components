/**
 * Writing source paths to the developer's clipboard.
 *
 * Ported from the Vite plugin's `src/client/clipboard.ts`. The extension runs on
 * localhost, which the Clipboard API treats as a secure context, so
 * `navigator.clipboard.writeText()` is normally available (the MV3 manifest
 * also declares the `clipboardWrite` permission). Embedded previews and sites
 * served over plain HTTP are not secure contexts, and the browser may deny a
 * write even on localhost — those cases fall back to the legacy hidden-textarea
 * + `document.execCommand("copy")` path.
 */

/** The subset of `navigator.clipboard` this module needs. */
export interface ClipboardLike {
  writeText(text: string): Promise<void> | void;
}

/** Injection points used by tests and exotic embedding environments. */
export interface CopyTextOptions {
  /** Defaults to `navigator.clipboard` when available. */
  clipboard?: ClipboardLike | null;
  /** Defaults to the global `document`. */
  document?: Document | null;
}

function globalClipboard(): ClipboardLike | null {
  const navigatorLike = (globalThis as { navigator?: { clipboard?: ClipboardLike } })
    .navigator;
  const clipboard = navigatorLike?.clipboard;
  if (clipboard === null || clipboard === undefined) return null;
  return typeof clipboard.writeText === "function" ? clipboard : null;
}

function globalDocument(): Document | null {
  const candidate = (globalThis as { document?: Document }).document;
  return candidate ?? null;
}

/**
 * Copy `text` using `execCommand`, the pre-Clipboard-API technique. Returns
 * false when the document cannot run the command (happy-dom, some sandboxes).
 */
function legacyCopy(text: string, doc: Document | null): boolean {
  if (doc === null || typeof doc.execCommand !== "function") return false;

  const textarea = doc.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0;";
  const parent = doc.body ?? doc.documentElement;
  if (parent === null || parent === undefined) return false;

  parent.append(textarea);
  try {
    textarea.select();
    if (typeof textarea.setSelectionRange === "function") {
      textarea.setSelectionRange(0, text.length);
    }
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/**
 * Copy `text` to the clipboard. Never throws; resolves to true when either the
 * Clipboard API or the legacy fallback reported success.
 */
export async function copyText(
  text: string,
  options: CopyTextOptions = {},
): Promise<boolean> {
  if (typeof text !== "string" || text === "") return false;

  const clipboard =
    options.clipboard === undefined ? globalClipboard() : options.clipboard;
  if (clipboard !== null) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or an insecure context: try the legacy path below.
    }
  }

  const doc =
    options.document === undefined ? globalDocument() : options.document;
  return legacyCopy(text, doc);
}
