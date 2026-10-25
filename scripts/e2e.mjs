#!/usr/bin/env node
// End-to-end acceptance test for `tab-to-components`.
//
// For every playground this harness:
//   1. starts the playground's Vite dev server IN-PROCESS (`createServer()` from
//      the playground's own `vite`, so no CLI/child process is needed),
//   2. launches headless Chrome with the DevTools protocol port and a throwaway
//      profile under `.tmp/e2e-profile`,
//   3. navigates over CDP, waits for `__TTC_READY__`, checks that `data-ttc`
//      markers reached the DOM and that React hydrated the button,
//   4. holds Alt (rawKeyDown + modifiers: 1) and clicks the rendered button,
//   5. asserts the source action picker opened with "Open in IDE",
//      "Copy file name" and "Copy full path", clicks both copy rows and checks
//      that the bare page file name (e.g. `home.tsx`) and the absolute path
//      reached the clipboard — the clipboard API is stubbed in the page so the
//      harness can observe the exact text,
//   6. Alt+clicks again, chooses "Open in IDE" and asserts the browser issued an
//      open-in-editor request
//      (`GET <base>__ttc/open-in-editor?file=<abs page file>:<line>:<column>`,
//      the plugin's endpoint for its default VS Code editor) for the JSX
//      *usage site* of `<Button>` in the page module (`app/routes/home.tsx` for
//      rr7/rr8, `src/App.tsx` for vite-react),
//   7. asserts the plugin actually launched the editor with that location by
//      putting a fake `code` command first on PATH (no VS Code needed), and
//   8. asserts the app's own click handler did NOT run (counter text unchanged).
//
// Usage (must be started from the repo root):
//   node --import file:///D:/Github/tab-to-components/scripts/sandbox-shim.mjs scripts/e2e.mjs [playground]
//   node --import file:///D:/Github/tab-to-components/scripts/sandbox-shim.mjs scripts/e2e.mjs --server-only
//
// `--server-only` skips Chrome and checks the server-side half (SSR markers,
// transformed page module, virtual client module); useful when a browser cannot
// be launched in the current sandbox.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const TMP_DIR = path.join(REPO_ROOT, ".tmp");
const EDITOR_LOG_PATH = path.join(TMP_DIR, "editor.log");
const FAKE_BIN_DIR = path.join(TMP_DIR, "fake-bin");
const PROFILE_ROOT = path.join(TMP_DIR, "e2e-profile");
const DEFAULT_CHROME_PATH =
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CHROME_PATH = process.env.CHROME_PATH?.trim() || DEFAULT_CHROME_PATH;

const DEV_SERVER_TIMEOUT_MS = 60_000;
const OVERLAY_READY_TIMEOUT_MS = 25_000;
const CHROME_START_TIMEOUT_MS = 25_000;
const OPEN_EDITOR_REQUEST_TIMEOUT_MS = 5_000;
const CLICK_SETTLE_MS = 500;

const PLAYGROUNDS = [
  {
    name: "rr8",
    description: "React Router v8 framework mode (SSR)",
    dir: path.join(REPO_ROOT, "playground", "rr8"),
    pageFile: "app/routes/home.tsx",
    componentFile: "app/components/Button.tsx",
  },
  {
    name: "rr7",
    description: "React Router v7 framework mode (SSR)",
    dir: path.join(REPO_ROOT, "playground", "rr7"),
    pageFile: "app/routes/home.tsx",
    componentFile: "app/components/Button.tsx",
  },
  {
    name: "vite-react",
    description: "plain Vite + React 19 (client only)",
    dir: path.join(REPO_ROOT, "playground", "vite-react"),
    pageFile: "src/App.tsx",
    componentFile: "src/components/Button.tsx",
  },
  {
    name: "vite-react-vite7",
    description: "plain Vite 7 + React 19 (client only)",
    dir: path.join(REPO_ROOT, "playground", "vite-react-vite7"),
    pageFile: "src/App.tsx",
    componentFile: "src/components/Button.tsx",
  },
  {
    name: "rr7-vite7",
    description: "React Router v7 framework mode on Vite 7 (SSR)",
    dir: path.join(REPO_ROOT, "playground", "rr7-vite7"),
    pageFile: "app/routes/home.tsx",
    componentFile: "app/components/Button.tsx",
  },
];

/**
 * Local demo apps under `examples/`. They are git-ignored, so they are only
 * added to the run when they exist and `--examples` is passed.
 */
const EXAMPLE_PLAYGROUNDS = [
  {
    name: "mantine-demo",
    description: "React Router v8 framework mode + Mantine 9 (local example)",
    dir: path.join(REPO_ROOT, "examples", "mantine-demo"),
    pageFile: "app/routes/home.tsx",
  },
  {
    name: "raw-demo",
    description: "React Router v8 data mode, no UI library (local example)",
    dir: path.join(REPO_ROOT, "examples", "raw-demo"),
    pageFile: "src/pages/Home.tsx",
  },
].filter((playground) => fs.existsSync(playground.dir));

/** Raised for harness/setup problems (bad args, missing browser, …). */
export class HarnessError extends Error {
  constructor(message, { hint } = {}) {
    super(message);
    this.name = "HarnessError";
    this.hint = hint;
  }
}

/** Raised when Chrome cannot expose its DevTools endpoint. */
export class ChromeUnavailableError extends HarnessError {}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const toPosix = (value) => String(value).replace(/\\/g, "/");

function log(message = "") {
  console.log(message);
}

function summarizeConsoleMessages(messages, limit = 12) {
  if (messages.length === 0) return "(none)";
  return messages
    .slice(-limit)
    .map((message) => `    ${message}`)
    .join("\n");
}

function formatExitCode(code) {
  if (code === null || code === undefined) return "unknown";
  const signed = Number(code);
  const hex = (signed >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `${signed} (0x${hex})`;
}

// ---------------------------------------------------------------------------
// Expected source location: the JSX usage site of <Button> in the page module.
// ---------------------------------------------------------------------------

export function computeExpectedLocation(pageFileAbs) {
  const source = fs.readFileSync(pageFileAbs, "utf8");
  const occurrences = [...source.matchAll(/<Button\b/g)];
  if (occurrences.length === 0) {
    throw new HarnessError(
      `no \`<Button\` usage found in ${toPosix(pageFileAbs)}; the e2e expectation is derived from it.`,
    );
  }
  if (occurrences.length > 1) {
    throw new HarnessError(
      `found ${occurrences.length} \`<Button\` usages in ${toPosix(pageFileAbs)}; the e2e expectation needs exactly one.`,
    );
  }
  const index = occurrences[0].index;
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const line = source.slice(0, index).split("\n").length;
  const column = index - lineStart + 1;
  return {
    line,
    column,
    marker: `${toPosix(pageFileAbs)}:${line}:${column}`,
  };
}

/**
 * Compare the `file` query param with the expected `path:line:column`.
 * Forward-slash form and case-insensitive comparison (Windows paths).
 */
function matchObservedLocation(observedFile, expectedMarker) {
  const variants = [];
  const add = (value) => {
    if (typeof value !== "string") return;
    const text = toPosix(value).trim();
    if (text !== "" && !variants.includes(text)) variants.push(text);
  };
  add(observedFile);
  if (typeof observedFile === "string") {
    try {
      add(decodeURIComponent(observedFile));
    } catch {
      // `observedFile` is already decoded by URLSearchParams in practice.
    }
  }
  const expectedLower = expectedMarker.toLowerCase();
  const match = variants.find((variant) =>
    variant.toLowerCase().endsWith(expectedLower),
  );
  return {
    ok: Boolean(match),
    observed: match ?? variants[0] ?? String(observedFile ?? ""),
    variants,
  };
}

// ---------------------------------------------------------------------------
// Dev server (in-process, exactly as a user would get it)
// ---------------------------------------------------------------------------

async function startDevServer(playgroundDir) {
  const requireFromPlayground = createRequire(
    path.join(playgroundDir, "package.json"),
  );
  const viteEntry = requireFromPlayground.resolve("vite");
  const vite = await import(pathToFileURL(viteEntry).href);
  if (typeof vite.createServer !== "function") {
    throw new HarnessError(
      `resolved vite from ${toPosix(viteEntry)} but it has no createServer() export.`,
    );
  }
  const server = await vite.createServer({
    configFile: path.join(playgroundDir, "vite.config.ts"),
    root: playgroundDir,
    server: { port: 0, host: "127.0.0.1" },
    logLevel: "error",
  });
  await server.listen();
  const address = server.httpServer?.address?.();
  const port =
    address !== null && typeof address === "object" && address.port
      ? address.port
      : server.config?.server?.port;
  const resolvedBase = server.resolvedUrls?.local?.[0];
  const baseUrl = resolvedBase ?? `http://127.0.0.1:${port}/`;
  return {
    server,
    port,
    baseUrl: baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  };
}

async function closeDevServer(server) {
  if (!server) return;
  try {
    await server.close();
  } catch (error) {
    log(`  ! dev server close failed: ${error.message}`);
  }
}

async function waitForHtml(baseUrl) {
  const deadline = Date.now() + DEV_SERVER_TIMEOUT_MS;
  let lastError = "no attempt made";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, {
        headers: { accept: "text/html" },
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.text();
      if (response.status !== 200) {
        lastError = `HTTP ${response.status}: ${body.slice(0, 600)}`;
      } else if (!body.includes("</html>")) {
        lastError = `response is not an HTML document (${body.length} bytes)`;
      } else {
        return body;
      }
    } catch (error) {
      lastError = error.message;
    }
    await delay(300);
  }
  throw new HarnessError(
    `the dev server never served ${baseUrl}\n  last error: ${lastError}`,
  );
}

async function fetchModuleText(baseUrl, modulePath) {
  const response = await fetch(new URL(modulePath, baseUrl), {
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  return { status: response.status, text };
}

// ---------------------------------------------------------------------------
// Chrome / DevTools protocol
// ---------------------------------------------------------------------------

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        address !== null && typeof address === "object" ? address.port : null;
      server.close(() => {
        if (typeof port === "number") resolve(port);
        else reject(new Error("could not allocate a free port"));
      });
    });
  });
}

function buildChromeArgs(headlessFlag, debuggingPort, profileDir, url) {
  return [
    headlessFlag,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDir}`,
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    "--hide-scrollbars",
    "--window-size=1280,900",
    url,
  ];
}

function launchChromeProcess(headlessFlag, profileDir, url) {
  const portPromise = getFreePort();
  const state = {
    exited: false,
    code: null,
    signal: null,
    spawnError: null,
  };
  return portPromise.then((debuggingPort) => {
    fs.mkdirSync(profileDir, { recursive: true });
    const args = buildChromeArgs(headlessFlag, debuggingPort, profileDir, url);
    const child = spawn(CHROME_PATH, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (error) => {
      state.spawnError = error;
      state.exited = true;
    });
    child.on("exit", (code, signal) => {
      state.exited = true;
      state.code = code;
      state.signal = signal;
    });
    return { child, state, debuggingPort };
  });
}

async function waitForDevToolsEndpoint(launched) {
  const { state, debuggingPort } = launched;
  const deadline = Date.now() + CHROME_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.spawnError) {
      throw new ChromeUnavailableError(
        `could not spawn Chrome (${CHROME_PATH}): ${state.spawnError.message}`,
      );
    }
    if (state.exited) {
      throw new ChromeUnavailableError(
        `Chrome exited before exposing its DevTools endpoint (exit code ${formatExitCode(
          state.code,
        )}).`,
      );
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${debuggingPort}/json/version`,
        { signal: AbortSignal.timeout(1_000) },
      );
      if (response.ok) {
        const version = await response.json();
        return { version, debuggingPort };
      }
    } catch {
      // Chrome is still starting up.
    }
    await delay(150);
  }
  throw new ChromeUnavailableError(
    `Chrome did not expose its DevTools endpoint on 127.0.0.1:${launched.debuggingPort} within ${CHROME_START_TIMEOUT_MS}ms.`,
  );
}

async function launchChrome(url, profileDir) {
  const attempts = ["--headless=new", "--headless"];
  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const headlessFlag = attempts[index];
    let launched = null;
    try {
      launched = await launchChromeProcess(headlessFlag, profileDir, url);
      const { version, debuggingPort } = await waitForDevToolsEndpoint(launched);
      return {
        child: launched.child,
        state: launched.state,
        debuggingPort,
        profileDir,
        version: version?.Browser ?? "unknown browser",
      };
    } catch (error) {
      lastError = error;
      if (launched) {
        try {
          launched.child.kill("SIGKILL");
        } catch {
          // Ignore — Chrome may already be gone.
        }
        await delay(300);
      }
      if (index < attempts.length - 1) {
        log(`  ! ${headlessFlag} launch failed (${error.message}); retrying with ${attempts[index + 1]}`);
      }
    }
  }
  throw lastError;
}

async function stopChrome(launched) {
  if (!launched) return;
  const { child, state, profileDir } = launched;
  if (!state.exited) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Ignore.
    }
    const deadline = Date.now() + 8_000;
    while (!state.exited && Date.now() < deadline) await delay(100);
  }
  await delay(250);
  try {
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  } catch {
    // Chrome may still hold a lock; the directory lives under .tmp and is ignored by git.
  }
}

async function waitForPageTarget(debuggingPort, baseUrl) {
  const deadline = Date.now() + 30_000;
  const startedAt = Date.now();
  let firstPage = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${debuggingPort}/json/list`,
        { signal: AbortSignal.timeout(2_000) },
      );
      const targets = await response.json();
      const pages = targets.filter(
        (target) =>
          target.type === "page" &&
          typeof target.webSocketDebuggerUrl === "string" &&
          !String(target.url).startsWith("devtools://"),
      );
      const ours = pages.find((target) => String(target.url).startsWith(baseUrl));
      if (ours) return ours;
      if (pages.length > 0) {
        firstPage = firstPage ?? pages[0];
        const waited = Date.now() - startedAt;
        if (waited > 10_000 || (waited > 5_000 && firstPage.url !== "about:blank")) {
          return firstPage; // Ensure the correct URL over CDP below.
        }
      }
    } catch {
      // DevTools endpoint not up yet or Chrome restarting its page target.
    }
    await delay(150);
  }
  if (firstPage) return firstPage;
  throw new HarnessError(
    `Chrome exposed no page target on 127.0.0.1:${debuggingPort}.`,
  );
}

class CdpClient {
  static async connect(webSocketDebuggerUrl) {
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener(
        "error",
        () =>
          reject(
            new HarnessError(
              `could not open a CDP WebSocket to ${webSocketDebuggerUrl}`,
            ),
          ),
        { once: true },
      );
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    socket.addEventListener("message", (event) => {
      this.onMessage(event.data);
    });
    socket.addEventListener("close", () => {
      this.onClose();
    });
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) ?? [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
  }

  onMessage(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
      return;
    }
    if (message.id !== undefined && message.id !== null) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(
            `${pending.method} failed: ${message.error.message ?? "unknown CDP error"}`,
          ),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    const handlers = this.listeners.get(message.method);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(message.params ?? {});
      } catch {
        // A throwing listener must not corrupt the CDP client.
      }
    }
  }

  onClose() {
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(new Error("CDP connection closed"));
    }
    this.pending.clear();
  }

  send(method, params = {}, timeoutMs = 20_000) {
    if (this.closed) {
      return Promise.reject(new Error(`cannot send ${method}: CDP connection closed`));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Ignore.
    }
  }
}

async function evaluate(client, expression) {
  const { result, exceptionDetails } = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    const description =
      exceptionDetails.exception?.description ??
      exceptionDetails.text ??
      "unknown evaluation error";
    throw new Error(`Runtime.evaluate threw: ${description}`);
  }
  return result?.value;
}

const PAGE_STATE_EXPRESSION = `(() => {
  const button = document.querySelector("button");
  return {
    href: location.href,
    readyState: document.readyState,
    hasButton: button !== null,
    buttonText: button === null ? null : (button.textContent || "").trim(),
    markers: document.querySelectorAll("[data-ttc]").length,
    ready: globalThis.__TTC_READY__ === true,
    version: typeof globalThis.__TTC_VERSION__ === "string" ? globalThis.__TTC_VERSION__ : null,
    hydrated: button !== null && Object.keys(button).some((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")),
    bodyText: document.body === null ? "" : (document.body.innerText || "")
  };
})()`;

const BUTTON_RECT_EXPRESSION = `(() => {
  const button = document.querySelector("button");
  if (button === null) return null;
  const rect = button.getBoundingClientRect();
  return JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
})()`;

/** Read the open source action picker, or null when it is not visible. */
const ACTION_MENU_EXPRESSION = `(() => {
  const host = document.querySelector("[data-ttc-ui]");
  const menu = host && host.shadowRoot
    ? host.shadowRoot.querySelector('[data-ttc-menu="actions"]')
    : null;
  if (!menu || menu.style.display === "none") return null;
  return JSON.stringify(Array.from(menu.querySelectorAll(".ttc-menu-item"), (row) => ({
    label: (row.querySelector(".ttc-menu-name") || {}).textContent || "",
    detail: (row.querySelector(".ttc-menu-source") || {}).textContent || "",
    text: row.textContent || ""
  })));
})()`;

/**
 * Observe the exact clipboard text from the page. Headless Chrome may allow the
 * real Clipboard API, but granting permissions and reading the OS clipboard is
 * platform-specific; stubbing writeText keeps this harness deterministic while
 * exercising the runtime's real copy path.
 */
const CLIPBOARD_CAPTURE_EXPRESSION = `(() => {
  try {
    window.__ttcClipboard = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => { window.__ttcClipboard.push(String(text)); }
      }
    });
    return true;
  } catch (error) {
    return String(error && error.message ? error.message : error);
  }
})()`;

async function readPageState(client) {
  return evaluate(client, PAGE_STATE_EXPRESSION);
}

async function installClipboardCapture(client) {
  const result = await evaluate(client, CLIPBOARD_CAPTURE_EXPRESSION);
  if (result !== true) {
    throw new HarnessError(
      `could not stub navigator.clipboard in the page: ${String(result)}`,
    );
  }
}

async function waitForActionMenu(client, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const json = await evaluate(client, ACTION_MENU_EXPRESSION).catch(() => null);
    if (typeof json === "string") {
      let rows;
      try {
        rows = JSON.parse(json);
      } catch {
        rows = null;
      }
      if (Array.isArray(rows) && rows.length > 0) return rows;
    }
    await delay(100);
  }
  return null;
}

async function clickActionRow(client, label) {
  return evaluate(
    client,
    `(() => {
      const host = document.querySelector("[data-ttc-ui]");
      const menu = host && host.shadowRoot
        ? host.shadowRoot.querySelector('[data-ttc-menu="actions"]')
        : null;
      if (!menu) return false;
      const row = Array.from(menu.querySelectorAll(".ttc-menu-item")).find((candidate) =>
        (candidate.textContent || "").startsWith(${JSON.stringify(label)}),
      );
      if (!row) return false;
      row.click();
      return true;
    })()`,
  );
}

async function readCopiedTexts(client) {
  const value = await evaluate(
    client,
    "Array.isArray(window.__ttcClipboard) ? window.__ttcClipboard.slice() : []",
  );
  return Array.isArray(value) ? value.map(String) : [];
}

async function waitForCopiedText(client, expected, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const texts = await readCopiedTexts(client).catch(() => []);
    if (texts.includes(expected)) return texts;
    await delay(50);
  }
  return readCopiedTexts(client).catch(() => []);
}

/**
 * Alt+click the button, wait for the source action picker and activate one row.
 * Returns null when the picker never opened (the caller may retry once).
 */
async function chooseSourceAction(client, x, y, label) {
  await dispatchAltClick(client, x, y);
  const rows = await waitForActionMenu(client);
  if (rows === null) return null;
  const clicked = await clickActionRow(client, label);
  return { rows, clicked };
}

async function ensurePageUrl(client, baseUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const href = await evaluate(client, "location.href").catch(() => "");
    if (typeof href === "string" && href.startsWith(baseUrl)) return;
    await delay(100);
  }
  await client.send("Page.navigate", { url: baseUrl });
  const navigationDeadline = Date.now() + 20_000;
  while (Date.now() < navigationDeadline) {
    const href = await evaluate(client, "location.href").catch(() => "");
    if (typeof href === "string" && href.startsWith(baseUrl)) return;
    await delay(100);
  }
  throw new HarnessError(`the page never navigated to ${baseUrl}`);
}

async function waitForOverlayReady(client, diagnostics) {
  const startedAt = Date.now();
  const deadline = startedAt + OVERLAY_READY_TIMEOUT_MS;
  let snapshot = null;
  while (Date.now() < deadline) {
    snapshot = await readPageState(client).catch((error) => ({
      error: error.message,
    }));
    if (snapshot && !snapshot.error) {
      diagnostics.lastSnapshot = snapshot;
      if (
        snapshot.hasButton &&
        snapshot.markers > 0 &&
        snapshot.ready &&
        snapshot.hydrated
      ) {
        return { snapshot, elapsedMs: Date.now() - startedAt };
      }
    }
    await delay(100);
  }
  const last = diagnostics.lastSnapshot ?? snapshot ?? { error: "no state read" };
  throw new HarnessError(
    [
      "the app never became ready for Alt+click.",
      `  last state: ${JSON.stringify(last)}`,
      "  page console:",
      summarizeConsoleMessages(diagnostics.consoleMessages),
    ].join("\n"),
  );
}

async function readButtonCentre(client) {
  const rectJson = await evaluate(client, BUTTON_RECT_EXPRESSION);
  if (typeof rectJson !== "string") {
    throw new HarnessError("the page has no <button> to click.");
  }
  const rect = JSON.parse(rectJson);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new HarnessError(`the <button> has an empty hit box: ${rectJson}`);
  }
  return {
    x: Number(rect.x) + width / 2,
    y: Number(rect.y) + height / 2,
    rect,
  };
}

async function dispatchAltClick(client, x, y) {
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Alt",
    code: "AltLeft",
    windowsVirtualKeyCode: 18,
    nativeVirtualKeyCode: 18,
    modifiers: 1,
    location: 1,
    autoRepeat: false,
    isKeypad: false,
  });
  await delay(50);
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    modifiers: 1,
    buttons: 0,
  });
  await delay(50);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers: 1,
  });
}

async function releaseAlt(client) {
  try {
    await client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Alt",
      code: "AltLeft",
      windowsVirtualKeyCode: 18,
      nativeVirtualKeyCode: 18,
      modifiers: 0,
      location: 1,
    });
  } catch {
    // The page/browser may already be gone.
  }
}

async function waitForFirstOpenEditorRequest(requests, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (requests.length > 0) return requests[0];
    await delay(50);
  }
  return null;
}

function createDiagnostics(baseUrl) {
  return {
    baseUrl,
    consoleMessages: [],
    requests: [],
    responseStatus: new Map(),
    lastSnapshot: null,
  };
}

function wireNetworkCapture(client, diagnostics) {
  client.on("Network.requestWillBeSent", (params) => {
    const request = params.request ?? {};
    const url = typeof request.url === "string" ? request.url : "";
    if (!url.includes("open-in-editor")) return;
    let file = null;
    try {
      file = new URL(url).searchParams.get("file");
    } catch {
      file = null;
    }
    diagnostics.requests.push({
      url,
      file,
      method: request.method ?? "GET",
      requestId: params.requestId ?? null,
      at: Date.now(),
    });
  });
  client.on("Network.responseReceived", (params) => {
    const response = params.response ?? {};
    const url = typeof response.url === "string" ? response.url : "";
    if (!url.includes("open-in-editor")) return;
    diagnostics.responseStatus.set(params.requestId ?? url, {
      status: response.status,
      url,
    });
  });
  client.on("Runtime.consoleAPICalled", (params) => {
    const text = (params.args ?? [])
      .map((argument) => {
        if (argument === null || argument === undefined) return "";
        if (typeof argument.value === "string") return argument.value;
        if (argument.value !== undefined) return String(argument.value);
        return argument.description ?? argument.unserializableValue ?? argument.type ?? "";
      })
      .join(" ");
    const line = `[${params.type ?? "log"}] ${text}`.trim();
    if (line !== "") diagnostics.consoleMessages.push(line);
    if (diagnostics.consoleMessages.length > 200) diagnostics.consoleMessages.shift();
  });
  client.on("Runtime.exceptionThrown", (params) => {
    const details = params.exceptionDetails ?? {};
    const description =
      details.exception?.description ?? details.text ?? "unknown page exception";
    diagnostics.consoleMessages.push(`[exception] ${description}`);
    if (diagnostics.consoleMessages.length > 200) diagnostics.consoleMessages.shift();
  });
}

// ---------------------------------------------------------------------------
// Browser-mode runner
// ---------------------------------------------------------------------------

export async function runPlaygroundInBrowser(playground) {
  const startedAt = Date.now();
  const pageFileAbs = path.join(playground.dir, playground.pageFile);
  const expected = computeExpectedLocation(pageFileAbs);
  const expectedFileName = toPosix(path.basename(playground.pageFile));
  const expectedFullPath = toPosix(pageFileAbs);
  const profileDir = path.join(
    PROFILE_ROOT,
    `${playground.name}-${process.pid}-${Date.now()}`,
  );
  fs.writeFileSync(EDITOR_LOG_PATH, "", "utf8");

  const diagnostics = createDiagnostics("");
  let server = null;
  let launchedChrome = null;
  let client = null;
  let passed = false;
  let observed = "(no open-in-editor request observed)";
  let editorStatus = "n/a";
  let failure = null;
  let readyInfo = null;
  let clickInfo = null;
  let preClickState = null;
  let actionMenuRows = null;
  let copiedText = null;

  log(`\n=== ${playground.name} — ${playground.description} ===`);
  log(`  root:      ${toPosix(playground.dir)}`);
  log(`  page file: ${toPosix(pageFileAbs)}`);
  log(`  expected:  ${expected.marker}`);

  try {
    const devServer = await startDevServer(playground.dir);
    server = devServer.server;
    diagnostics.baseUrl = devServer.baseUrl;
    log(`  dev server: ${devServer.baseUrl}`);
    await waitForHtml(devServer.baseUrl);

    launchedChrome = await launchChrome(devServer.baseUrl, profileDir);
    log(
      `  chrome:     ${launchedChrome.version} (CDP port ${launchedChrome.debuggingPort})`,
    );

    const target = await waitForPageTarget(
      launchedChrome.debuggingPort,
      devServer.baseUrl,
    );
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    wireNetworkCapture(client, diagnostics);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Network.enable");
    await ensurePageUrl(client, devServer.baseUrl);

    readyInfo = await waitForOverlayReady(client, diagnostics);
    log(
      `  ready:      __TTC_READY__=true version=${readyInfo.snapshot.version ?? "?"} markers=${readyInfo.snapshot.markers} hydrated=yes (${readyInfo.elapsedMs}ms)`,
    );

    preClickState = await readPageState(client);
    const clickPoint = await readButtonCentre(client);
    clickInfo = clickPoint;
    log(
      `  click:      Alt + left at (${Math.round(clickPoint.x)}, ${Math.round(
        clickPoint.y,
      )}) on "count is 0" button`,
    );
    await installClipboardCapture(client);

    // Alt+click must open the source action picker, not open the editor directly.
    let copyAttempt = await chooseSourceAction(
      client,
      clickPoint.x,
      clickPoint.y,
      "Copy file name",
    );
    if (copyAttempt === null) {
      // One retry: the modifier/hover plumbing can race the very first click on
      // a cold page. The retry is only safe while the app counter is unchanged.
      const stateAfterAttempt = await readPageState(client);
      if (stateAfterAttempt.buttonText !== preClickState.buttonText) {
        throw new HarnessError(
          `the Alt+click reached the app instead of the overlay: button text changed from "${preClickState.buttonText}" to "${stateAfterAttempt.buttonText}".`,
        );
      }
      log("  retry:      no action picker after the first Alt+click; retrying once");
      copyAttempt = await chooseSourceAction(
        client,
        clickPoint.x,
        clickPoint.y,
        "Copy file name",
      );
    }
    if (copyAttempt === null) {
      throw new HarnessError(
        [
          "Alt+click did not open the source action picker.",
          "  page console:",
          summarizeConsoleMessages(diagnostics.consoleMessages),
        ].join("\n"),
      );
    }

    actionMenuRows = copyAttempt.rows;
    const labels = actionMenuRows.map((row) => row.label);
    if (
      !labels.includes("Open in IDE") ||
      !labels.includes("Copy file name") ||
      !labels.includes("Copy full path")
    ) {
      throw new HarnessError(
        `the action picker is missing its default rows: ${JSON.stringify(labels)}`,
      );
    }
    const copyRow = actionMenuRows.find((row) => row.label === "Copy file name");
    if (copyRow?.detail !== expectedFileName) {
      throw new HarnessError(
        `the copy row shows "${copyRow?.detail ?? "?"}"; expected the page file name "${expectedFileName}".`,
      );
    }
    if (!copyAttempt.clicked) {
      throw new HarnessError("could not activate the Copy file name row.");
    }

    const copiedTexts = await waitForCopiedText(client, expectedFileName);
    if (!copiedTexts.includes(expectedFileName)) {
      throw new HarnessError(
        `Copy file name did not write "${expectedFileName}" to the clipboard (observed ${JSON.stringify(copiedTexts)}).`,
      );
    }
    copiedText = expectedFileName;
    log(`  copy:       clipboard <- ${expectedFileName}`);

    // The same picker must offer the absolute path of the file.
    const copyFullAttempt = await chooseSourceAction(
      client,
      clickPoint.x,
      clickPoint.y,
      "Copy full path",
    );
    if (copyFullAttempt === null || !copyFullAttempt.clicked) {
      throw new HarnessError("could not activate the Copy full path row.");
    }
    const fullPathRow = copyFullAttempt.rows.find(
      (row) => row.label === "Copy full path",
    );
    if (fullPathRow?.detail !== expectedFullPath) {
      throw new HarnessError(
        `the full-path row shows "${fullPathRow?.detail ?? "?"}"; expected "${expectedFullPath}".`,
      );
    }
    const copiedFullPaths = await waitForCopiedText(client, expectedFullPath);
    if (!copiedFullPaths.includes(expectedFullPath)) {
      throw new HarnessError(
        `Copy full path did not write "${expectedFullPath}" to the clipboard (observed ${JSON.stringify(copiedFullPaths)}).`,
      );
    }
    copiedText = `${expectedFileName}, ${expectedFullPath}`;
    log(`  copy:       clipboard <- ${expectedFullPath}`);

    // The copy actions must not double as editor requests.
    await delay(150);
    if (diagnostics.requests.length > 0) {
      throw new HarnessError(
        "a copy action unexpectedly issued an open-in-editor request.",
      );
    }

    // Choose the editor row next. The same one-retry policy as before: a cold
    // page may drop the first synthetic Alt+click.
    let openAttempt = await chooseSourceAction(
      client,
      clickPoint.x,
      clickPoint.y,
      "Open in IDE",
    );
    if (openAttempt === null) {
      const stateAfterAttempt = await readPageState(client);
      if (stateAfterAttempt.buttonText !== preClickState.buttonText) {
        throw new HarnessError(
          `the Alt+click reached the app instead of the overlay: button text changed from "${preClickState.buttonText}" to "${stateAfterAttempt.buttonText}".`,
        );
      }
      log("  retry:      no action picker while reopening; retrying once");
      openAttempt = await chooseSourceAction(
        client,
        clickPoint.x,
        clickPoint.y,
        "Open in IDE",
      );
    }
    if (openAttempt === null || !openAttempt.clicked) {
      throw new HarnessError(
        "could not choose Open in IDE from the source action picker.",
      );
    }

    let request = await waitForFirstOpenEditorRequest(
      diagnostics.requests,
      OPEN_EDITOR_REQUEST_TIMEOUT_MS,
    );
    if (!request) {
      // One more editor retry: reopen the picker and choose the row again.
      const stateAfterAttempt = await readPageState(client);
      if (stateAfterAttempt.buttonText !== preClickState.buttonText) {
        throw new HarnessError(
          `the Alt+click reached the app instead of the overlay: button text changed from "${preClickState.buttonText}" to "${stateAfterAttempt.buttonText}".`,
        );
      }
      log("  retry:      no request after Open in IDE; retrying once");
      const retry = await chooseSourceAction(
        client,
        clickPoint.x,
        clickPoint.y,
        "Open in IDE",
      );
      if (retry === null || !retry.clicked) {
        throw new HarnessError(
          "could not reopen the source action picker for the editor retry.",
        );
      }
      request = await waitForFirstOpenEditorRequest(
        diagnostics.requests,
        OPEN_EDITOR_REQUEST_TIMEOUT_MS,
      );
    }
    if (!request) {
      throw new HarnessError(
        [
          `no open-in-editor request was observed after choosing Open in IDE.`,
          "  page console:",
          summarizeConsoleMessages(diagnostics.consoleMessages),
        ].join("\n"),
      );
    }

    observed = request.file ?? "(missing file query param)";
    const status = diagnostics.responseStatus.get(request.requestId);
    editorStatus = status ? String(status.status) : "no response recorded yet";
    const match = matchObservedLocation(request.file, expected.marker);
    observed = match.observed;

    // Let a late response and the overlay toast settle before reading the app.
    await delay(CLICK_SETTLE_MS);
    const postClickState = await readPageState(client).catch(() => null);
    if (!postClickState) {
      throw new HarnessError("the page disappeared before the click assertion.");
    }
    if (postClickState.buttonText !== preClickState.buttonText) {
      throw new HarnessError(
        `the app click handler ran: button text changed from "${preClickState.buttonText}" to "${postClickState.buttonText}".`,
      );
    }
    if (!postClickState.bodyText.includes("count is 0")) {
      throw new HarnessError(
        `the "count is 0" text is no longer on the page after Alt+click.`,
      );
    }
    if (!match.ok) {
      throw new HarnessError(
        [
          "the editor request opened the wrong source location.",
          `  expected: ${expected.marker}`,
          `  observed: ${match.observed}`,
          `  request:  ${request.url}`,
        ].join("\n"),
      );
    }

    // The default editor is VS Code (`code`): prove the plugin really launched
    // it with the right location by reading the fake `code` log.
    const editorInvocation = await waitForEditorInvocation(
      expected.marker,
      10_000,
    );
    if (!editorInvocation.ok) {
      throw new HarnessError(
        [
          "the plugin did not launch the default `code` editor with the expected location.",
          `  expected in ${toPosix(EDITOR_LOG_PATH)}: ${expected.marker}`,
          `  log content: ${JSON.stringify(editorInvocation.log.slice(0, 400))}`,
        ].join("\n"),
      );
    }

    passed = true;
  } catch (error) {
    failure = error;
  } finally {
    if (client) await releaseAlt(client);
    if (client) client.close();
    await stopChrome(launchedChrome);
    await closeDevServer(server);
  }

  const elapsedMs = Date.now() - startedAt;
  if (passed) {
    log(
      `  picker:     ${actionMenuRows.map((row) => row.label).join(", ")} (clipboard -> ${copiedText})`,
    );
    log(
      `  result:     count unchanged ("${preClickState?.buttonText}"), editor request opened ${observed} (status ${editorStatus})`,
    );
    log(`  PASS ${playground.name} (${elapsedMs}ms)`);
    return {
      name: playground.name,
      passed: true,
      expected: expected.marker,
      observed,
      elapsedMs,
    };
  }

  log(`  FAIL ${playground.name}: ${failure?.message ?? "unknown failure"}`);
  if (
    !(failure?.message ?? "").includes("page console:") &&
    diagnostics.consoleMessages.length > 0
  ) {
    log("  page console:");
    log(summarizeConsoleMessages(diagnostics.consoleMessages));
  }
  const hint = failure?.hint;
  if (hint) log(`  hint: ${hint}`);
  log(`  observed: ${observed}`);
  return {
    name: playground.name,
    passed: false,
    expected: expected.marker,
    observed,
    error: failure?.message ?? "unknown failure",
    elapsedMs,
  };
}

// ---------------------------------------------------------------------------
// Server-only smoke checks (no browser needed)
// ---------------------------------------------------------------------------

async function runPlaygroundServerOnly(playground) {
  const startedAt = Date.now();
  const pageFileAbs = path.join(playground.dir, playground.pageFile);
  const expected = computeExpectedLocation(pageFileAbs);
  const pageModulePath = "/" + toPosix(playground.pageFile);
  const componentModulePath = "/" + toPosix(playground.componentFile);
  const isSsr = playground.name !== "vite-react";
  let server = null;
  const notes = [];

  log(`\n=== ${playground.name} — ${playground.description} (server-only) ===`);
  log(`  expected marker: ${expected.marker}`);

  try {
    const devServer = await startDevServer(playground.dir);
    server = devServer.server;
    log(`  dev server: ${devServer.baseUrl}`);
    const html = await waitForHtml(devServer.baseUrl);

    if (isSsr) {
      const markers = [...html.matchAll(/data-ttc="([^"]+)"/g)].map(
        (match) => match[1],
      );
      if (markers.length === 0) {
        throw new HarnessError(
          "SSR HTML contains no data-ttc markers; the plugin transform did not run for this playground.",
        );
      }
      if (!markers.some((marker) => marker.startsWith("app/"))) {
        throw new HarnessError(
          `SSR markers do not look project-relative: ${markers.slice(0, 5).join(", ")}`,
        );
      }
      notes.push(`${markers.length} SSR markers`);
    } else {
      if (!html.includes('id="root"')) {
        throw new HarnessError("the plain Vite page has no #root mount point.");
      }
      notes.push("client-only shell served");
    }

    for (const modulePath of [pageModulePath, componentModulePath]) {
      const { status, text } = await fetchModuleText(devServer.baseUrl, modulePath);
      if (status !== 200) {
        throw new HarnessError(`${modulePath} responded with HTTP ${status}.`);
      }
      if (!text.includes("virtual:tab-to-components/client")) {
        throw new HarnessError(
          `${modulePath} does not import the overlay client module.`,
        );
      }
      if (!text.includes("data-ttc")) {
        throw new HarnessError(`${modulePath} has no injected data-ttc marker.`);
      }
      notes.push(`${modulePath} transformed`);
    }

    const pageModule = await fetchModuleText(devServer.baseUrl, pageModulePath);
    const expectedLiteral = JSON.stringify(
      `${toPosix(playground.pageFile)}:${expected.line}:${expected.column}`,
    );
    if (!pageModule.text.includes(expectedLiteral)) {
      throw new HarnessError(
        `the transformed page module does not carry the expected marker ${expectedLiteral}.`,
      );
    }
    if (!pageModule.text.includes("data-ttc-name")) {
      throw new HarnessError(
        `the transformed page module has no data-ttc-name attribute for component usages.`,
      );
    }
    notes.push("expected <Button> usage marker present");

    const clientModule = await fetchModuleText(
      devServer.baseUrl,
      "/@id/__x00__virtual:tab-to-components/client",
    );
    if (clientModule.status !== 200) {
      throw new HarnessError(
        `the virtual client module responded with HTTP ${clientModule.status}.`,
      );
    }
    if (!clientModule.text.includes("__TTC_CONFIG__")) {
      throw new HarnessError(
        "the virtual client module does not publish __TTC_CONFIG__.",
      );
    }
    const expectedRoot = toPosix(playground.dir);
    if (!toPosix(clientModule.text).includes(expectedRoot)) {
      throw new HarnessError(
        `the client config does not carry the playground root ${expectedRoot}.`,
      );
    }
    notes.push("client runtime + config served");

    log(`  PASS ${playground.name} (server-only, ${Date.now() - startedAt}ms)`);
    log(`  checks: ${notes.join("; ")}`);
    return {
      name: playground.name,
      passed: true,
      expected: expected.marker,
      observed: "server-side only (no browser)",
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    log(`  FAIL ${playground.name}: ${error.message}`);
    return {
      name: playground.name,
      passed: false,
      expected: expected.marker,
      observed: "server-side only (no browser)",
      error: error.message,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    await closeDevServer(server);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * The plugin opens VS Code by default. Put an observable fake `code` command
 * first on PATH so the full browser → plugin → editor chain can be asserted on
 * a machine that has no VS Code installed.
 */
export function installFakeCodeBinary() {
  fs.mkdirSync(FAKE_BIN_DIR, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(FAKE_BIN_DIR, "code.cmd"),
      `@echo off\r\necho %*>>"${EDITOR_LOG_PATH}"\r\n`,
      "utf8",
    );
  } else {
    const scriptPath = path.join(FAKE_BIN_DIR, "code");
    fs.writeFileSync(
      scriptPath,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${EDITOR_LOG_PATH}"\n`,
      "utf8",
    );
    fs.chmodSync(scriptPath, 0o755);
  }
  process.env.PATH = `${FAKE_BIN_DIR}${path.delimiter}${process.env.PATH ?? ""}`;
}

/** Wait until the fake `code` log mentions `marker`. */
async function waitForEditorInvocation(marker, timeoutMs) {
  const startedAt = Date.now();
  let logContent = "";
  while (Date.now() - startedAt < timeoutMs) {
    logContent = fs.existsSync(EDITOR_LOG_PATH)
      ? fs.readFileSync(EDITOR_LOG_PATH, "utf8")
      : "";
    if (logContent.includes(marker)) return { ok: true, log: logContent };
    await delay(100);
  }
  return { ok: false, log: logContent };
}

function chromeUnavailableHint() {
  return [
    "Headless Chrome could not start in this environment.",
    "This repository's Windows sandbox blocks the named pipes / crashpad channel Chromium creates at",
    'startup ("platform_channel.cc:112 Check failed ... access denied"), so no CDP endpoint appears.',
    "Run the browser e2e from a session with full process access, or use the server-side smoke checks here:",
    `  node --import ${pathToFileURL(path.join(SCRIPT_DIR, "sandbox-shim.mjs")).href} scripts/e2e.mjs --server-only`,
    `Set CHROME_PATH to override the browser executable (currently ${CHROME_PATH}).`,
  ].join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = argv.filter((argument) => argument.startsWith("--"));
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  const knownFlags = new Set(["--server-only", "--examples"]);
  for (const flag of flags) {
    if (!knownFlags.has(flag)) {
      throw new HarnessError(
        `unknown flag ${flag}. Supported flags: --server-only, --examples.`,
      );
    }
  }
  if (positional.length > 1) {
    throw new HarnessError(
      `expected at most one playground name, got: ${positional.join(", ")}`,
    );
  }

  const withExamples = flags.includes("--examples");
  const serverOnly = flags.includes("--server-only");
  if (withExamples && serverOnly) {
    throw new HarnessError(
      "--examples only runs in browser mode (drop --server-only).",
    );
  }

  const pool = withExamples
    ? [...PLAYGROUNDS, ...EXAMPLE_PLAYGROUNDS]
    : PLAYGROUNDS;
  let selected = pool;
  if (positional.length === 1) {
    selected = pool.filter((playground) => playground.name === positional[0]);
    if (selected.length === 0) {
      throw new HarnessError(
        `unknown playground "${positional[0]}". Available: ${pool
          .map((playground) => playground.name)
          .join(", ")}`,
      );
    }
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  try {
    fs.rmSync(PROFILE_ROOT, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // A previous Chrome may still hold the profile directory; a fresh subdir is
    // used for every run anyway.
  }
  fs.writeFileSync(EDITOR_LOG_PATH, "", "utf8");

  // Default editor is VS Code (`code`); observe the plugin's launch via a fake
  // command on PATH instead of requiring a real VS Code install.
  installFakeCodeBinary();

  log("tab-to-components e2e");
  log(`  repo:      ${toPosix(REPO_ROOT)}`);
  log(`  node:      ${process.execPath}`);
  log(`  editor:    code (default) -> ${toPosix(EDITOR_LOG_PATH)}`);
  log(`  mode:      ${serverOnly ? "server-only smoke checks (no browser)" : "in-process Vite + headless Chrome + CDP"}`);

  if (!serverOnly) {
    if (!fs.existsSync(CHROME_PATH)) {
      throw new HarnessError(
        `Chrome executable not found at ${CHROME_PATH}. Set CHROME_PATH to override.`,
        { hint: chromeUnavailableHint() },
      );
    }
    // Fail fast with a precise message before spending time on dev servers.
    try {
      const probeDir = path.join(PROFILE_ROOT, "preflight");
      fs.rmSync(probeDir, { recursive: true, force: true });
      const probe = await launchChrome("about:blank", probeDir);
      log(`  chrome:    ${probe.version}`);
      await stopChrome(probe);
    } catch (error) {
      throw new HarnessError(
        `Chrome preflight failed: ${error.message}`,
        { hint: chromeUnavailableHint() },
      );
    }
  }

  const results = [];
  for (const playground of selected) {
    results.push(
      serverOnly
        ? await runPlaygroundServerOnly(playground)
        : await runPlaygroundInBrowser(playground),
    );
  }

  const passed = results.filter((result) => result.passed).length;
  log(`\nSummary: ${passed}/${results.length} playgrounds passed`);
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    const detail = result.passed
      ? result.observed
      : result.error ?? "unknown failure";
    log(`  ${status}  ${result.name}  (${result.elapsedMs}ms)  ${detail}`);
  }
  process.exitCode = passed === results.length ? 0 : 1;
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// The compatibility matrix imports the runner; only the CLI entry point runs
// `main()`. Guarding this keeps `pnpm e2e` behaviour identical.
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\ne2e harness error: ${error.message}`);
    if (error.hint) console.error(`\n${error.hint}`);
    process.exitCode = error instanceof HarnessError ? 2 : 1;
  });
}
