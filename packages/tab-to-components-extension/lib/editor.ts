/**
 * Turning a source location into a URL the operating system's IDE handler can
 * open, plus the launch rate limits.
 *
 * A browser extension cannot spawn processes, so "Open in IDE" relies on the
 * URL schemes desktop editors register (VS Code, Cursor, Zed, …). The result is
 * validated before it is handed to the browser: only non-script schemes are
 * allowed, the path must be safe, and the URL is length capped.
 */

import {
  fileNameOf,
  isSafeAbsolutePath,
  isSafeRelativeFile,
  joinRoot,
  normalizeAbsolutePath,
  resolveAbsoluteLocation,
  type SourceLocation,
} from "./source/location";

export type EditorPresetId =
  | "vscode"
  | "cursor"
  | "windsurf"
  | "vscodium"
  | "zed"
  | "sublime"
  | "jetbrains"
  | "custom";

export interface EditorSetting {
  preset: EditorPresetId;
  /** Only used by the `custom` preset; empty for the built-in presets. */
  template: string;
}

export interface EditorPreset {
  id: EditorPresetId;
  label: string;
  template: string;
  /** Shown in the options page to explain a preset's requirements. */
  hint: string;
}

export const EDITOR_PRESETS: readonly EditorPreset[] = [
  {
    id: "vscode",
    label: "VS Code",
    template: "vscode://file/{path}:{line}:{column}",
    hint: "Requires the vscode:// URL handler (installed with VS Code).",
  },
  {
    id: "cursor",
    label: "Cursor",
    template: "cursor://file/{path}:{line}:{column}",
    hint: "Requires the cursor:// URL handler (installed with Cursor).",
  },
  {
    id: "windsurf",
    label: "Windsurf",
    template: "windsurf://file/{path}:{line}:{column}",
    hint: "Requires the windsurf:// URL handler (installed with Windsurf).",
  },
  {
    id: "vscodium",
    label: "VSCodium",
    template: "vscodium://file/{path}:{line}:{column}",
    hint: "Requires the vscodium:// URL handler (installed with VSCodium).",
  },
  {
    id: "zed",
    label: "Zed",
    template: "zed://file/{path}:{line}:{column}",
    hint: "Requires the zed:// URL handler (installed with Zed).",
  },
  {
    id: "sublime",
    label: "Sublime Text",
    template: "subl://open?url=file://{path}&line={line}",
    hint: "Requires the subl:// URL handler (Sublime Text registers it on install).",
  },
  {
    id: "jetbrains",
    label: "JetBrains (experimental)",
    template: "jetbrains://idea/navigate/reference?path={path}&line={line}",
    hint: "Requires a running JetBrains IDE with the project open; the product segment may need editing for WebStorm/PyCharm.",
  },
  {
    id: "custom",
    label: "Custom URL template",
    template: "",
    hint: "Use {path}, {file}, {fileUri}, {line} and {column} placeholders.",
  },
];

export const DEFAULT_EDITOR_SETTING: EditorSetting = {
  preset: "vscode",
  template: "",
};

export const MAX_EDITOR_URL_LENGTH = 4096;
export const MAX_EDITOR_TEMPLATE_LENGTH = 1024;

/**
 * Schemes that may never be navigated to from the overlay. Everything else
 * (vscode, cursor, zed, jetbrains, …) is assumed to be an editor handler.
 */
const DENIED_SCHEMES = new Set([
  "javascript",
  "data",
  "vbscript",
  "file",
  "blob",
  "about",
  "chrome",
  "chrome-extension",
  "moz-extension",
  "http",
  "https",
  "ws",
  "wss",
  "ftp",
  "mailto",
  "tel",
]);

export function isEditorPresetId(value: unknown): value is EditorPresetId {
  return (
    typeof value === "string" &&
    EDITOR_PRESETS.some((preset) => preset.id === value)
  );
}

/** Resolve the template for a setting; `null` when the custom template is empty. */
export function resolveEditorTemplate(setting: EditorSetting): string | null {
  if (setting.preset === "custom") {
    const template = setting.template.trim();
    return template === "" ? null : template;
  }
  const preset = EDITOR_PRESETS.find((candidate) => candidate.id === setting.preset);
  return preset ? preset.template : null;
}

export function editorPresetLabel(setting: EditorSetting): string {
  const preset = EDITOR_PRESETS.find((candidate) => candidate.id === setting.preset);
  return preset?.label ?? setting.preset;
}

export function schemeOf(url: string): string | null {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url);
  return match?.[1] ? match[1].toLowerCase() : null;
}

export function isAllowedEditorScheme(scheme: string): boolean {
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) && !DENIED_SCHEMES.has(scheme);
}

/** Whether a fully built URL may be navigated to. */
export function isAllowedEditorUrl(url: string): boolean {
  if (typeof url !== "string" || url.length > MAX_EDITOR_URL_LENGTH) return false;
  const scheme = schemeOf(url);
  return scheme !== null && isAllowedEditorScheme(scheme);
}

/**
 * Percent-encode a filesystem path for use in a URL, keeping separators and a
 * Windows drive letter (`D:`) readable.
 */
export function encodePathForUrl(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized
    .split("/")
    .map((segment, index) => {
      if (index === 0 && /^[A-Za-z]:$/.test(segment)) return segment;
      return encodeURIComponent(segment);
    })
    .join("/");
}

/** `D:/proj/a.tsx` → `file:///D:/proj/a.tsx`; `null` for UNC paths. */
export function toFileUri(absolutePath: string): string | null {
  const normalized = absolutePath.replace(/\\/g, "/");
  if (normalized.startsWith("//")) return null;
  const encoded = encodePathForUrl(normalized);
  if (/^[A-Za-z]:\//.test(encoded)) return `file:///${encoded}`;
  if (encoded.startsWith("/")) return `file://${encoded}`;
  return null;
}

export interface EditorUrlInput {
  location: SourceLocation;
  /** Configured absolute project root for the page origin, if any. */
  root: string | null;
}

export type EditorUrlResult = { url: string } | { error: string };

/**
 * Expand placeholders and validate the resulting URL.
 *
 * Placeholders: `{path}` (absolute), `{file}` (relative), `{fileUri}`,
 * `{line}`, `{column}`.
 */
export function expandEditorUrl(
  template: string,
  { location, root }: EditorUrlInput,
): EditorUrlResult {
  const trimmed = template.trim();
  if (trimmed === "") return { error: "No editor URL template is configured." };
  if (trimmed.length > MAX_EDITOR_TEMPLATE_LENGTH) {
    return { error: "The editor URL template is too long." };
  }

  const absolute = resolveAbsoluteLocation(location, root);
  const relative =
    location.relativeFile ??
    (isSafeRelativeFile(location.file) ? location.file : null);
  const usesAbsolute = /\{path\}|\{fileUri\}/.test(trimmed);
  if (usesAbsolute && absolute === null) {
    return {
      error:
        "A project root is required for this editor template. Set one for this site in the extension options.",
    };
  }
  if (absolute !== null && !isSafeAbsolutePath(absolute)) {
    return { error: "The source path is not a safe absolute path." };
  }

  const url = trimmed
    .replace(/\{path\}/g, () => encodePathForUrl(absolute ?? ""))
    .replace(/\{fileUri\}/g, () => {
      if (absolute === null) return "";
      return toFileUri(absolute) ?? "";
    })
    .replace(/\{file\}/g, () =>
      encodeURI(relative ?? fileNameOf(location.file)),
    )
    .replace(/\{line\}/g, () => String(location.line))
    .replace(/\{column\}/g, () => String(location.column));

  const scheme = schemeOf(url);
  if (scheme === null) {
    return { error: "The editor URL has no scheme (expected something like vscode://)." };
  }
  if (!isAllowedEditorScheme(scheme)) {
    return { error: `The "${scheme}:" scheme is not allowed for editor launches.` };
  }
  if (url.length > MAX_EDITOR_URL_LENGTH) {
    return { error: "The editor URL is too long." };
  }
  return { url };
}

/** Build the URL for a setting, merging the preset template when needed. */
export function buildEditorUrl(
  setting: EditorSetting,
  input: EditorUrlInput,
): EditorUrlResult {
  const template = resolveEditorTemplate(setting);
  if (template === null) return { error: "No editor URL template is configured." };
  return expandEditorUrl(template, input);
}

/** Resolve `root + relative` for templates that need an absolute path. */
export function editorAbsolutePath(
  location: SourceLocation,
  root: string | null,
): string | null {
  if (location.absoluteFile !== null) {
    return normalizeAbsolutePath(location.absoluteFile);
  }
  if (root !== null && location.relativeFile !== null) {
    return joinRoot(root, location.relativeFile);
  }
  return null;
}

export type LaunchVerdict = "allow" | "duplicate" | "limited";

/**
 * Coalesce repeated/rapid editor launches so a page (or an impatient
 * developer) cannot spawn an editor storm.
 */
export class LaunchLimiter {
  private readonly inFlight = new Set<string>();
  private readonly lastLaunchAt = new Map<string, number>();
  private readonly recent: number[] = [];
  private readonly now: () => number;

  constructor(
    now: () => number = () => Date.now(),
    readonly minIntervalMs = 500,
    readonly windowMs = 60_000,
    readonly maxPerWindow = 10,
  ) {
    this.now = now;
  }

  reserve(target: string): LaunchVerdict {
    const now = this.now();
    if (this.inFlight.has(target)) return "duplicate";
    const last = this.lastLaunchAt.get(target);
    if (last !== undefined && now - last < this.minIntervalMs) {
      return "duplicate";
    }
    while (this.recent.length > 0) {
      const oldest = this.recent[0];
      if (oldest === undefined || now - oldest <= this.windowMs) break;
      this.recent.shift();
    }
    if (this.recent.length >= this.maxPerWindow) return "limited";

    this.inFlight.add(target);
    this.lastLaunchAt.set(target, now);
    this.recent.push(now);
    if (this.lastLaunchAt.size > 512) {
      for (const [key, launchedAt] of this.lastLaunchAt) {
        if (now - launchedAt > this.windowMs) this.lastLaunchAt.delete(key);
      }
    }
    return "allow";
  }

  release(target: string): void {
    this.inFlight.delete(target);
  }
}
