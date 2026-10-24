import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizePath, relativeToRoot, resolveFromRoot } from "./paths.js";
import type {
  EditorCommandConfig,
  EditorLauncher,
  EditorOption,
  EditorTarget,
} from "./types.js";

/** Default endpoint used when a custom `editor` is configured. */
export const CUSTOM_EDITOR_ENDPOINT = "__ttc/open-in-editor";

/** Only these commands are treated as editor "names" for preset lookup. */
const VSCODE_FAMILY = new Set([
  "code",
  "code-insiders",
  "vscode",
  "codium",
  "vscodium",
  "cursor",
  "windsurf",
  "trae",
  "antigravity",
]);

const JETBRAINS_FAMILY = new Set([
  "appcode",
  "clion",
  "goland",
  "idea",
  "phpstorm",
  "pycharm",
  "rider",
  "rubymine",
  "webstorm",
  "fleet",
]);

const COLON_FAMILY = new Set([
  "atom",
  "subl",
  "sublime",
  "sublime_text",
  "textmate",
  "zed",
  "wstorm",
  "charm",
]);

const VIM_FAMILY = new Set(["vim", "mvim", "gvim", "nvim", "neovim"]);
const EMACS_FAMILY = new Set(["emacs", "emacsclient"]);
const NOTEPAD_FAMILY = new Set(["notepad++", "notepadplusplus"]);

const PLACEHOLDER_RE = /\{(file|line|column)\}/g;

export interface EditorCommand {
  command: string;
  args: string[];
}

/** `C:\\Program Files\\Code\\Code.exe` / `code.cmd` → `code`. */
export function editorNameOf(command: string): string {
  const normalized = normalizePath(command).replace(/\/+$/, "");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  return base.replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase();
}

/**
 * Split a command template into arguments, honouring single and double quotes.
 * Backslashes are kept as-is (they are path separators on Windows).
 */
export function splitCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;

  for (const char of input) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

function placeholdersIn(value: string): boolean {
  PLACEHOLDER_RE.lastIndex = 0;
  return PLACEHOLDER_RE.test(value);
}

function expand(value: string, target: EditorTarget): string {
  return value
    .replace(/\{file\}/g, target.file)
    .replace(/\{line\}/g, String(target.line))
    .replace(/\{column\}/g, String(target.column));
}

function targetArgument(target: EditorTarget): string {
  return `${target.file}:${target.line}:${target.column}`;
}

/**
 * Arguments that open `target` for a known editor, or `undefined` when the
 * command is not a preset. Mirrors the launch-editor mappings that VS Code,
 * Cursor, Trae, JetBrains, Sublime, Zed, Vim and Emacs users rely on.
 */
export function presetEditorArgs(
  command: string,
  target: EditorTarget,
): string[] | undefined {
  const name = editorNameOf(command);
  if (VSCODE_FAMILY.has(name)) {
    return ["-r", "-g", targetArgument(target)];
  }
  if (JETBRAINS_FAMILY.has(name)) {
    return ["--line", String(target.line), "--column", String(target.column), target.file];
  }
  if (NOTEPAD_FAMILY.has(name)) {
    return [`-n${target.line}`, `-c${target.column}`, target.file];
  }
  if (VIM_FAMILY.has(name)) {
    return [`+call cursor(${target.line}, ${target.column})`, target.file];
  }
  if (COLON_FAMILY.has(name)) {
    return [targetArgument(target)];
  }
  if (EMACS_FAMILY.has(name)) {
    return [`+${target.line}:${target.column}`, target.file];
  }
  return undefined;
}

function resolveStringEditor(editor: string, target: EditorTarget): EditorCommand {
  const trimmed = editor.trim();
  if (trimmed === "") {
    throw new Error("`editor` must not be an empty string.");
  }
  const tokens = splitCommandLine(trimmed);
  const command = tokens[0];
  if (!command) {
    throw new Error(`Could not parse the editor command: ${JSON.stringify(editor)}`);
  }
  const rest = tokens.slice(1);

  // A bare command name: use a preset, or the generic `<command> file:line:column`.
  if (rest.length === 0) {
    const preset = presetEditorArgs(command, target);
    return { command, args: preset ?? [targetArgument(target)] };
  }

  // A template: expand placeholders, or append the target when none are used.
  const tokenHasPlaceholder =
    placeholdersIn(command) || rest.some((token) => placeholdersIn(token));
  const args = rest.map((token) => expand(token, target));
  return {
    command: expand(command, target),
    args: tokenHasPlaceholder ? args : [...args, targetArgument(target)],
  };
}

function resolveObjectEditor(
  editor: EditorCommandConfig,
  target: EditorTarget,
): EditorCommand {
  if (typeof editor.command !== "string" || editor.command.trim() === "") {
    throw new Error("The `editor.command` option must be a non-empty string.");
  }
  const configured = editor.args?.map(String) ?? [];
  const hasPlaceholder = configured.some((arg) => placeholdersIn(arg));
  const args = configured.map((arg) => expand(arg, target));
  return {
    command: expand(editor.command, target),
    args: hasPlaceholder ? args : [...args, targetArgument(target)],
  };
}

/** Resolve any non-function `editor` option into the concrete command to spawn. */
export function resolveEditorInvocation(
  editor: Exclude<EditorOption, EditorLauncher>,
  target: EditorTarget,
): EditorCommand {
  return typeof editor === "string"
    ? resolveStringEditor(editor, target)
    : resolveObjectEditor(editor, target);
}

/** Single-quote/escape a token for a `cmd.exe /c` command line. */
function quoteWindowsArgument(argument: string): string {
  if (argument !== "" && !/[\s"]/.test(argument)) return argument;
  return `"${argument.replace(/"/g, '\\"')}"`;
}

function spawnDetached(
  command: EditorCommand,
  onError?: (message: string) => void,
): void {
  const { command: file, args } = command;
  try {
    if (process.platform === "win32") {
      // Editor CLIs on Windows are usually `.cmd` shims (`code.cmd`,
      // `cursor.cmd`, …), which CreateProcess cannot run directly.
      const commandLine = [file, ...args].map(quoteWindowsArgument).join(" ");
      const child = spawn(commandLine, {
        shell: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", (error) => {
        onError?.(`Could not launch "${file}": ${error.message}`);
      });
      child.unref();
      return;
    }
    const child = spawn(file, args, { stdio: "ignore", detached: true });
    child.on("error", (error) => {
      onError?.(`Could not launch "${file}": ${error.message}`);
    });
    child.unref();
  } catch (error) {
    onError?.(
      `Could not launch "${file}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Turn the `editor` option into a launcher the dev server can call.
 * Failures are reported through `onError` (the plugin logs them) and never
 * thrown back into the middleware.
 */
export function createEditorLauncher(
  editor: EditorOption,
  options: { onError?: (message: string) => void } = {},
): EditorLauncher {
  if (typeof editor === "function") {
    return async (target) => {
      try {
        await editor(target);
      } catch (error) {
        options.onError?.(
          `The custom editor launcher failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };
  }
  return (target) => {
    try {
      spawnDetached(resolveEditorInvocation(editor, target), options.onError);
    } catch (error) {
      options.onError?.(
        `Could not resolve the editor command: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };
}

const POSITION_SUFFIX_RE = /:(\d+)(?::(\d+))?$/;

/**
 * Parse `"<absolute-or-root-relative path>:<line>:<column>"` and make sure the
 * file is inside the project root (`root`), so the endpoint cannot be used to
 * open arbitrary files on the dev-server machine.
 */
export function parseEditorTarget(
  raw: string,
  root: string,
): EditorTarget | undefined {
  const value = raw.trim();
  if (value === "") return undefined;

  let filePart = value;
  let line = 1;
  let column = 1;
  const position = POSITION_SUFFIX_RE.exec(filePart);
  if (position) {
    line = Number(position[1]);
    column = Number(position[2] ?? 1);
    filePart = filePart.slice(0, position.index);
  } else {
    return undefined;
  }
  if (!Number.isFinite(line) || line < 1) return undefined;
  if (!Number.isFinite(column) || column < 1) return undefined;

  if (filePart.startsWith("file://")) {
    try {
      filePart = fileURLToPath(filePart);
    } catch {
      return undefined;
    }
  }

  // Normalise separators and resolve without relying on the host platform:
  // `fileURLToPath` yields `/D:/…` on POSIX for a Windows file URL, and a
  // project root may be a Windows path even when the tests run on Linux.
  filePart = normalizePath(filePart);
  if (/^\/[A-Za-z]:\//.test(filePart)) filePart = filePart.slice(1);

  const resolved = resolveFromRoot(root, filePart);
  if (!relativeToRoot(root, resolved)) return undefined;
  return { file: resolved, line, column };
}

/** Whether `file` exists and is a regular file (used by the dev middleware). */
export function editorTargetExists(target: EditorTarget): boolean {
  try {
    return fs.statSync(target.file).isFile();
  } catch {
    return false;
  }
}
