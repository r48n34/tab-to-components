/**
 * Chrome/V8 stack parsing.
 *
 * React 19 no longer stores the JSX source object on elements; instead
 * `jsxDEV` captures `Error("react-stack-top-frame")` into `_debugStack`, and
 * react-dom copies it to the rendered fiber. The frame that matters is the
 * first application frame: it points at the compiled `_jsxDEV(...)` call,
 * which a source map maps back to the original JSX site.
 */

/** One parsed `url:line:column` frame. */
export interface StackFrame {
  url: string;
  line: number;
  column: number;
}

export const MAX_STACK_CHARS = 16_384;

/**
 * Matches the tail of a V8 frame:
 *   at App (http://localhost:5173/src/App.tsx?t=1:15:20)
 *   at http://localhost:5173/src/App.tsx?t=1:15:20
 *   App@http://localhost:5173/src/App.tsx:15:20
 * The URL part is greedy so paths containing parentheses still parse.
 */
const FRAME_TAIL_RE = /((?:https?|file):\/\/\S+?):(\d+):(\d+)\)?$/;

/** Runtime modules that are never the JSX site the developer clicked. */
const RUNTIME_PATH_RES = [
  /\/node_modules\//,
  /\/\.vite\//,
  /\/@vite\//,
  /\/@react-refresh/,
  /\/@id\//,
  /\/(?:react-dom|react_jsx|react-jsx|react-refresh|scheduler)[^/]*\.js/i,
  /react_devtools|react-devtools/i,
];

function isRuntimeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.startsWith("chrome-extension:")) return true;
  if (lower.startsWith("moz-extension:")) return true;
  if (lower.startsWith("webpack:")) return true;
  return RUNTIME_PATH_RES.some((pattern) => pattern.test(lower));
}

/** Accept an `Error`, a stack string, or an object carrying a `.stack` string. */
export function stackStringOf(value: unknown): string | null {
  if (typeof value === "string") {
    return value === "" ? null : value.slice(0, MAX_STACK_CHARS);
  }
  if (typeof value !== "object" || value === null) return null;
  const stack = (value as { stack?: unknown }).stack;
  if (typeof stack !== "string" || stack === "") return null;
  return stack.slice(0, MAX_STACK_CHARS);
}

/** Parse every `url:line:column` frame in a V8-style stack. */
export function parseStackFrames(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const rawLine of stack.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const match = FRAME_TAIL_RE.exec(line);
    if (!match) continue;
    const url = match[1];
    const frameLine = Number.parseInt(match[2] ?? "", 10);
    const column = Number.parseInt(match[3] ?? "", 10);
    if (url === undefined) continue;
    if (!Number.isSafeInteger(frameLine) || frameLine < 1) continue;
    if (!Number.isSafeInteger(column) || column < 1) continue;
    frames.push({ url, line: frameLine, column });
  }
  return frames;
}

/**
 * Pick the first application frame: prefer the page's own origin, skip the
 * React/Vite runtime, and fall back to any remaining http(s)/file frame.
 */
export function pickAppFrame(
  stack: string,
  pageOrigin?: string | null,
): StackFrame | null {
  let fallback: StackFrame | null = null;
  for (const frame of parseStackFrames(stack)) {
    if (isRuntimeUrl(frame.url)) continue;
    if (pageOrigin) {
      try {
        if (new URL(frame.url).origin === pageOrigin) return frame;
      } catch {
        // malformed URL: keep it as a fallback candidate below
      }
    }
    if (fallback === null) fallback = frame;
  }
  return fallback;
}
