import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

/**
 * Characters `cmd.exe` interprets as syntax. They must be caret-escaped in
 * every token of a command line that runs through the shell.
 */
const CMD_METACHARACTER_RE = /[&|<>,;=^]/g;
const DEFAULT_WINDOWS_EXTENSIONS = [".COM", ".EXE", ".BAT", ".CMD"];

function windowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.PATHEXT ?? "")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_WINDOWS_EXTENSIONS;
}

function isInsideDirectory(candidate: string, directory: string): boolean {
  const normalizedCandidate = candidate.replace(/\\/g, "/").toLowerCase();
  const normalizedDirectory = directory.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (normalizedDirectory === "") return false;
  return normalizedCandidate.startsWith(`${normalizedDirectory}/`);
}

/**
 * Resolve the editor executable to an absolute path without consulting the
 * current directory. `cmd.exe` resolves a bare command against the cwd first,
 * so a repository (or a dependency) could otherwise plant `code.cmd` and have
 * it executed by the editor click.
 */
export function resolveWindowsExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const trimmed = command.trim();
  if (trimmed === "") {
    throw new Error("the editor command must not be empty");
  }

  if (/[\\/]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed)) {
    const resolved = path.resolve(cwd, trimmed);
    if (!fs.existsSync(resolved)) {
      throw new Error(`could not find the editor at "${resolved}"`);
    }
    return resolved;
  }

  const extensions = windowsExecutableExtensions(env);
  const lowered = trimmed.toLowerCase();
  const hasExtension = extensions.some((extension) =>
    lowered.endsWith(extension.toLowerCase()),
  );
  const directories = (env.PATH ?? "")
    .split(path.delimiter)
    .map((directory) => directory.trim())
    .filter(Boolean);

  for (const directory of directories) {
    for (const extension of hasExtension ? [""] : extensions) {
      const candidate = path.resolve(directory, `${trimmed}${extension}`);
      // Refuse to launch an executable that lives inside the project tree:
      // that is exactly the binary-planting shape this lookup exists to stop.
      if (isInsideDirectory(candidate, cwd)) continue;
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Keep looking: a missing candidate is not an error.
      }
    }
  }

  throw new Error(
    `could not find "${trimmed}" on PATH (an editor installed outside PATH needs an absolute command)`,
  );
}

/**
 * Escape one token the way `cmd.exe` expects. Mirrors the `launch-editor`
 * implementation bundled with Vite: reject CR/LF and `%` (cmd expands
 * environment variables before `^` can protect them), caret-escape the
 * metacharacters, then quote.
 */
export function escapeWindowsCommandArgument(argument: string): string {
  if (/[\r\n]/.test(argument)) {
    throw new Error("the editor command contains a line break");
  }
  if (argument.includes("%")) {
    throw new Error('the editor command contains a "%" that cmd.exe would expand');
  }
  return argument.replace(CMD_METACHARACTER_RE, "^$&");
}

/** Quote a token for `cmd.exe /d /s /c` after escaping it. */
function quoteWindowsArgument(argument: string): string {
  const escaped = escapeWindowsCommandArgument(argument);
  if (escaped.includes("^")) return `^"${escaped}^"`;
  if (escaped.includes(" ")) return `"${escaped}"`;
  return escaped;
}

/** Build the single command line that `cmd.exe /d /s /c` will execute. */
export function buildWindowsCommandLine(command: EditorCommand): string {
  return [command.command, ...command.args]
    .map(quoteWindowsArgument)
    .join(" ");
}

export interface WindowsSpawnPlan {
  /** Executable to hand to `spawn` (cmd.exe for `.cmd`/`.bat` shims). */
  file: string;
  args: string[];
  /** Only the `cmd.exe` plan needs verbatim argument passing. */
  windowsVerbatimArguments: boolean;
}

/**
 * Decide how to launch an editor on Windows. `.exe`/`.com` binaries are
 * spawned directly (no shell); `.cmd`/`.bat` shims are the only case that
 * needs `cmd.exe`, and then with a fully escaped command line.
 */
export function createWindowsSpawnPlan(
  command: EditorCommand,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): WindowsSpawnPlan {
  const executable = resolveWindowsExecutable(command.command, env, cwd);
  const lowered = executable.toLowerCase();
  if (lowered.endsWith(".cmd") || lowered.endsWith(".bat")) {
    const commandLine = buildWindowsCommandLine({
      command: executable,
      args: command.args,
    });
    return {
      file: env.ComSpec ?? env.COMSPEC ?? "cmd.exe",
      args: ["/d", "/s", "/c", `"${commandLine}"`],
      windowsVerbatimArguments: true,
    };
  }
  return {
    file: executable,
    args: [...command.args],
    windowsVerbatimArguments: false,
  };
}

function spawnDetached(
  command: EditorCommand,
  onError?: (message: string) => void,
): void {
  const { command: file } = command;
  try {
    if (process.platform === "win32") {
      // Editor CLIs on Windows are usually `.cmd` shims (`code.cmd`,
      // `cursor.cmd`, …), which CreateProcess cannot run directly. Resolve the
      // executable ourselves and escape every token: `shell: true` with a
      // concatenated command line let `cmd.exe` interpret metacharacters in
      // the file path (a project or dependency filename) as syntax.
      const plan = createWindowsSpawnPlan(command);
      const child = spawn(plan.file, plan.args, {
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: plan.windowsVerbatimArguments,
      });
      child.on("error", (error) => {
        onError?.(`Could not launch "${file}": ${error.message}`);
      });
      child.unref();
      return;
    }
    const child = spawn(file, command.args, {
      stdio: "ignore",
      detached: true,
    });
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
 * Normalise and contain one file part (no position suffix) inside `root`.
 * Returns `undefined` for anything that resolves outside the project root.
 */
function resolveContainedFile(rawFile: string, root: string): string | undefined {
  let filePart = rawFile;
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
  return resolved;
}

/**
 * Resolve the file part of an open-in-editor request without requiring a
 * position suffix, so a request can be containment-checked before it is
 * delegated to Vite's built-in `/__open-in-editor` endpoint (`editor: "auto"`).
 */
export function parseEditorFilePath(
  raw: string,
  root: string,
): string | undefined {
  const value = raw.trim();
  if (value === "") return undefined;
  let filePart = value;
  const position = POSITION_SUFFIX_RE.exec(filePart);
  if (position) filePart = filePart.slice(0, position.index);
  if (filePart === "") return undefined;
  return resolveContainedFile(filePart, root);
}

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

  const resolved = resolveContainedFile(filePart, root);
  if (!resolved) return undefined;
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
