/**
 * The actions offered by the modifier + left-click picker.
 *
 * Alt+click opens a tiny action sheet. By default it offers `["open",
 * "copy-file", "copy-full-path"]`; `clickActions` reorders or extends the
 * built-in rows and `customActions` appends team-defined copy templates, so the
 * developer can jump to the editor, copy a path, or paste source context into
 * an issue, a chat or an AI coding tool without leaving the page.
 */

import { IDE_LABELS, type ClickAction, type CustomAction, type EditorIde } from "./config";
import type { MenuIconName } from "./icons";
import {
  fileNameOf,
  formatMarker,
  formatNameLabel,
  resolveFullPath,
} from "./marker";
import {
  expandActionTemplate,
  formatActionMarker,
  formatChainNames,
  limitActionText,
  orderedChain,
  previewActionText,
  sanitizeActionName,
  type ActionContext,
} from "./template";

export { IDE_LABELS };

/** IDE a per-IDE open action launches, or `null` for `open` and the copy actions. */
export function sourceActionIde(action: ClickAction): EditorIde | null {
  switch (action) {
    case "open-code":
      return "code";
    case "open-cursor":
      return "cursor";
    case "open-webstorm":
      return "webstorm";
    case "open-trae":
      return "trae";
    default:
      return null;
  }
}

/**
 * Icon rendered before the primary label in the action picker. Each action
 * points at what it acts on: the editor, the file, a relative/full path, the
 * `file:line:column` location, an AI context block or the component chain.
 */
export function sourceActionIcon(action: ClickAction): MenuIconName {
  switch (action) {
    case "open":
      return "open";
    case "open-code":
      return "open-code";
    case "open-cursor":
      return "open-cursor";
    case "open-webstorm":
      return "open-webstorm";
    case "open-trae":
      return "open-trae";
    case "copy-file":
      return "copy-file";
    case "copy-path":
      return "copy-path";
    case "copy-full-path":
      return "copy-full-path";
    case "copy-location":
      return "copy-location";
    case "copy-ai-context":
      return "sparkles";
    case "copy-mention":
      return "at";
    case "copy-markdown":
      return "markdown";
    case "copy-chain":
      return "component";
  }
}

/** Primary label rendered in the action picker. */
export function sourceActionLabel(action: ClickAction): string {
  switch (action) {
    case "open":
      return "Open in IDE";
    case "open-code":
      return `Open in ${IDE_LABELS.code}`;
    case "open-cursor":
      return `Open in ${IDE_LABELS.cursor}`;
    case "open-webstorm":
      return `Open in ${IDE_LABELS.webstorm}`;
    case "open-trae":
      return `Open in ${IDE_LABELS.trae}`;
    case "copy-file":
      return "Copy file name";
    case "copy-path":
      return "Copy relative path";
    case "copy-full-path":
      return "Copy full path";
    case "copy-location":
      return "Copy file:line:column";
    case "copy-ai-context":
      return "Copy for AI";
    case "copy-mention":
      return "Copy @mention";
    case "copy-markdown":
      return "Copy as Markdown";
    case "copy-chain":
      return "Copy component chain";
  }
}

/**
 * A markdown context block for an AI coding tool: the target element, its
 * source location and the marked component chain with one location per row.
 */
export function aiContextText(context: ActionContext): string {
  const entry = context.entry;
  const lines = [
    `Target: ${formatNameLabel(sanitizeActionName(entry.name))} — ${formatActionMarker(entry.marker)}`,
    "Component chain (outermost → innermost):",
  ];
  orderedChain(context).forEach((chainEntry, index) => {
    lines.push(
      `${index + 1}. ${formatNameLabel(sanitizeActionName(chainEntry.name))} — ${formatActionMarker(chainEntry.marker)}`,
    );
  });
  return limitActionText(lines.join("\n"));
}

/** An inline markdown reference: `` `<Button />` — `src/App.tsx:20:9` ``. */
export function markdownText(context: ActionContext): string {
  const name = formatNameLabel(sanitizeActionName(context.entry.name));
  return limitActionText(
    `\`${name}\` — \`${formatActionMarker(context.entry.marker)}\``,
  );
}

/**
 * Secondary, right-aligned detail rendered in the action picker. Built-in rows
 * keep showing the exact value they copy; multi-line presets and custom
 * templates are flattened to a one-line preview.
 */
export function sourceActionDetail(
  action: ClickAction,
  context: ActionContext,
): string {
  const marker = context.entry.marker;
  switch (action) {
    case "copy-file":
      return fileNameOf(marker);
    case "copy-path":
      return marker.file;
    case "copy-full-path":
      return resolveFullPath(marker, context.root);
    case "copy-ai-context":
      return previewActionText(aiContextText(context));
    case "copy-mention":
      return `@${formatActionMarker(marker)}`;
    case "copy-markdown":
      return previewActionText(markdownText(context));
    case "copy-chain":
      return previewActionText(limitActionText(formatChainNames(context)));
    case "open":
    case "open-code":
    case "open-cursor":
    case "open-webstorm":
    case "open-trae":
    case "copy-location":
      return formatMarker(marker);
  }
}

/** What a copy action writes, or null for the editor action. */
export interface SourceActionCopy {
  /** Exact clipboard text. */
  text: string;
  /** Confirmation toast, e.g. `Copied file name: Button.tsx`. */
  toast: string;
}

/**
 * Resolve a built-in copy action to its clipboard text and confirmation
 * message. Returns null for every `open*` action, which the editor client
 * handles.
 */
export function sourceActionCopy(
  action: ClickAction,
  context: ActionContext,
): SourceActionCopy | null {
  const marker = context.entry.marker;
  switch (action) {
    case "open":
    case "open-code":
    case "open-cursor":
    case "open-webstorm":
    case "open-trae":
      return null;
    case "copy-file": {
      const text = fileNameOf(marker);
      return { text, toast: `Copied file name: ${text}` };
    }
    case "copy-path":
      return { text: marker.file, toast: `Copied path: ${marker.file}` };
    case "copy-full-path": {
      const text = resolveFullPath(marker, context.root);
      return { text, toast: `Copied full path: ${text}` };
    }
    case "copy-location": {
      const text = formatMarker(marker);
      return { text, toast: `Copied location: ${text}` };
    }
    case "copy-ai-context":
      return {
        text: aiContextText(context),
        toast: `Copied AI context: ${formatActionMarker(marker)}`,
      };
    case "copy-mention": {
      const text = `@${formatActionMarker(marker)}`;
      return { text, toast: `Copied @mention: ${text}` };
    }
    case "copy-markdown":
      return {
        text: markdownText(context),
        toast: `Copied Markdown: ${formatActionMarker(marker)}`,
      };
    case "copy-chain": {
      const text = limitActionText(formatChainNames(context));
      return {
        text,
        toast: `Copied component chain: ${previewActionText(text, 120)}`,
      };
    }
  }
}

/** Icon a custom action renders (defaults to the location pin). */
export function customActionIcon(action: CustomAction): MenuIconName {
  return action.icon ?? "copy-location";
}

/** Expand a custom action's template for the picker's detail column. */
export function customActionDetail(
  action: CustomAction,
  context: ActionContext,
): string {
  const text = expandActionTemplate(action.copy, context);
  return previewActionText(text) || previewActionText(action.copy);
}

/** Expand a custom action's template for the clipboard. */
export function customActionCopy(
  action: CustomAction,
  context: ActionContext,
): SourceActionCopy {
  const text = expandActionTemplate(action.copy, context);
  return { text, toast: `Copied: ${previewActionText(text, 120)}` };
}
