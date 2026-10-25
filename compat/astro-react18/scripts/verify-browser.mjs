// Headless-browser (Chrome DevTools Protocol) verification for the Astro
// fixture. Confirms that the SSR island actually hydrates, that the overlay
// runtime installs in the page, and that Alt+click resolves the clicked DOM
// node back to the <Button> usage marker and issues the open-in-editor request.
//
// The check degrades to "na" when Chrome cannot be launched in this
// environment, so the reusable fixture still runs headless-only.
//
// Run: node scripts/verify-browser.mjs   (port override: TTC_ASTRO_PORT)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";

// Astro's telemetry creates its config under %APPDATA%\astro and throws EPERM
// when the profile is read-only. This must be set before Astro's module graph
// is evaluated, so the Astro import below is dynamic.
process.env.ASTRO_TELEMETRY_DISABLED ??= "1";
const { dev } = await import("astro");

const port = Number(process.env.TTC_ASTRO_PORT ?? "4400");
const origin = `http://127.0.0.1:${port}`;
const CHROME_PATH =
  process.env.CHROME_PATH?.trim() ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const START_TIMEOUT_MS = 25_000;
const READY_TIMEOUT_MS = 25_000;
const EDITOR_REQUEST_TIMEOUT_MS = 8_000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

function record(check, status, evidence) {
  results.push({ check, status, evidence });
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const freePort =
        address !== null && typeof address === "object" ? address.port : null;
      server.close(() => {
        if (typeof freePort === "number") resolve(freePort);
        else reject(new Error("could not allocate a free port"));
      });
    });
  });
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
            new Error(`could not open a CDP WebSocket to ${webSocketDebuggerUrl}`),
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
    socket.addEventListener("message", (event) => this.onMessage(event.data));
    socket.addEventListener("close", () => this.onClose());
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
        // Ignore listener errors.
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
      return Promise.reject(new Error(`cannot send ${method}: CDP closed`));
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
    throw new Error(
      `Runtime.evaluate threw: ${
        exceptionDetails.exception?.description ??
        exceptionDetails.text ??
        "unknown error"
      }`,
    );
  }
  return result?.value;
}

async function poll(fn, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    try {
      lastValue = await fn();
      if (predicate(lastValue)) return lastValue;
    } catch {
      // Page/CDP may still be starting.
    }
    await delay(150);
  }
  return lastValue;
}

function buildChromeArgs(headlessFlag, debuggingPort, profileDir) {
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
    "about:blank",
  ];
}

async function launchChrome() {
  if (!existsSync(CHROME_PATH)) {
    throw new Error(`Chrome executable not found at ${CHROME_PATH}`);
  }
  const debuggingPort = await getFreePort();
  const profileDir = path.join(process.cwd(), ".tmp", "chrome-profile");
  rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });

  const attempts = ["--headless=new", "--headless"];
  let lastError;
  for (const headlessFlag of attempts) {
    const state = { exited: false, spawnError: null };
    const child = spawn(
      CHROME_PATH,
      buildChromeArgs(headlessFlag, debuggingPort, profileDir),
      { stdio: "ignore", windowsHide: true },
    );
    child.once("error", (error) => {
      state.spawnError = error;
      state.exited = true;
    });
    child.once("exit", () => {
      state.exited = true;
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    let endpointReady = false;
    while (Date.now() < deadline) {
      if (state.spawnError) {
        lastError = new Error(`could not spawn Chrome: ${state.spawnError.message}`);
        break;
      }
      if (state.exited) {
        lastError = new Error("Chrome exited before exposing its DevTools endpoint");
        break;
      }
      try {
        const response = await fetch(
          `http://127.0.0.1:${debuggingPort}/json/version`,
          { signal: AbortSignal.timeout(1_000) },
        );
        if (response.ok) {
          endpointReady = true;
          break;
        }
      } catch {
        // Still starting.
      }
      await delay(150);
    }

    if (endpointReady) {
      return { child, state, debuggingPort, profileDir };
    }
    try {
      child.kill("SIGKILL");
    } catch {
      // Ignore.
    }
    await delay(300);
  }
  throw lastError ?? new Error("Chrome did not expose its DevTools endpoint");
}

async function findPageTarget(debuggingPort) {
  const deadline = Date.now() + 15_000;
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
      const ours = pages.find((target) => String(target.url).startsWith(origin));
      if (ours) return ours;
      firstPage = firstPage ?? pages[0];
      if (firstPage) return firstPage;
    } catch {
      // Endpoint not ready yet.
    }
    await delay(150);
  }
  throw new Error("Chrome exposed no page target");
}

const PAGE_STATE_EXPRESSION = `(() => {
  const button = document.querySelector("astro-island button");
  const island = document.querySelector("astro-island");
  const islandClass = customElements.get("astro-island");
  return {
    url: location.href,
    readyState: document.readyState,
    overlayReady: globalThis.__TTC_READY__ === true,
    overlayHost: !!document.querySelector("[data-ttc-ui]"),
    islandUpgraded: !!island && !!islandClass && island instanceof islandClass,
    mainMarker: document.querySelector("main")?.getAttribute("data-ttc") ?? null,
    buttonMarker: button?.getAttribute("data-ttc") ?? null,
    buttonText: button ? (button.textContent || "").trim() : null,
    markerCount: document.querySelectorAll("[data-ttc]").length,
    hydrated: !!button && Object.keys(button).some((key) =>
      key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")
    ),
    fiberKeys: button ? Object.keys(button).filter((key) => key.startsWith("__react")) : []
  };
})()`;

const BUTTON_RECT_EXPRESSION = `(() => {
  const button = document.querySelector("astro-island button");
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
})()`;

async function dispatchAltClick(client, x, y) {
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

let server;
try {
  server = await dev({
    root: process.cwd(),
    logLevel: "error",
    server: { port, host: "127.0.0.1" },
  });
} catch (error) {
  console.log(
    JSON.stringify(
      { phase: "dev-server-start", error: error?.stack ?? String(error) },
      null,
      2,
    ),
  );
  process.exit(1);
}

let chrome;
let client;
let phase = "setup";
try {
  chrome = await launchChrome();
  const target = await findPageTarget(chrome.debuggingPort);
  client = await CdpClient.connect(target.webSocketDebuggerUrl);

  const requests = [];
  const pageErrors = [];
  client.on("Network.requestWillBeSent", (params) => {
    requests.push(params.request?.url ?? "");
  });
  client.on("Runtime.exceptionThrown", (params) => {
    pageErrors.push(params.exceptionDetails?.text ?? "unknown exception");
  });

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Page.navigate", { url: `${origin}/` });
  phase = "checks";

  const readyState = await poll(
    () => evaluate(client, "window.__TTC_READY__ === true"),
    (value) => value === true,
    READY_TIMEOUT_MS,
  );
  record(
    "browser: overlay runtime sets __TTC_READY__",
    readyState === true ? "pass" : "fail",
    `__TTC_READY__=${String(readyState)}`,
  );

  const state = await poll(
    () => evaluate(client, PAGE_STATE_EXPRESSION),
    (value) => Boolean(value?.hydrated),
    10_000,
  );
  record(
    "browser: SSR island hydrated by React",
    state?.hydrated ? "pass" : "fail",
    `hydrated=${state?.hydrated} fiberKeys=${JSON.stringify(state?.fiberKeys ?? [])} buttonText=${JSON.stringify(state?.buttonText)}`,
  );
  record(
    "browser: overlay host installed in the page",
    state?.overlayHost ? "pass" : "fail",
    `[data-ttc-ui]=${state?.overlayHost}`,
  );
  record(
    "browser: markers present in hydrated DOM",
    state?.mainMarker && state?.buttonMarker ? "pass" : "fail",
    `main=${state?.mainMarker} button=${state?.buttonMarker} count=${state?.markerCount}`,
  );
  record(
    "browser: astro-island custom element upgraded",
    state?.islandUpgraded ? "pass" : "fail",
    `islandUpgraded=${state?.islandUpgraded}`,
  );

  const moduleRequests = requests.filter(
    (url) =>
      url.includes("/src/components/App.tsx") ||
      url.includes("/src/components/Button.tsx"),
  );
  const virtualRequests = requests.filter((url) =>
    url.includes("/@id/__x00__virtual:tab-to-components/client"),
  );
  record(
    "browser: fetched the transformed React modules",
    moduleRequests.length > 0 ? "pass" : "fail",
    moduleRequests.map((url) => url.replace(origin, "")).join(", ") ||
      "no module request observed",
  );
  record(
    "browser: fetched the overlay virtual client module",
    virtualRequests.length > 0 ? "pass" : "fail",
    virtualRequests.map((url) => url.replace(origin, "")).join(", ") ||
      "no virtual module request observed",
  );

  const rectJson = await evaluate(client, BUTTON_RECT_EXPRESSION);
  if (!rectJson) {
    record("browser: found the hydrated <button>", "fail", "no button");
  } else {
    const rect = JSON.parse(rectJson);
    record(
      "browser: found the hydrated <button>",
      "pass",
      `rect=${rectJson}`,
    );
    await dispatchAltClick(
      client,
      Math.round(rect.x + rect.width / 2),
      Math.round(rect.y + rect.height / 2),
    );
    const editorRequest = await poll(
      () =>
        requests.find((url) => url.includes("__ttc/open-in-editor")) ?? null,
      (value) => Boolean(value),
      EDITOR_REQUEST_TIMEOUT_MS,
    );
    let decoded = "";
    try {
      decoded = editorRequest ? decodeURIComponent(editorRequest) : "";
    } catch {
      decoded = editorRequest ?? "";
    }
    const expectedMarker = "src/components/App.tsx:7:7";
    record(
      "browser: Alt+click issues the open-in-editor request",
      editorRequest ? "pass" : "fail",
      editorRequest ? editorRequest.replace(origin, "") : "no editor request observed",
    );
    record(
      "browser: Alt+click targets the <Button> usage site marker",
      decoded.includes(expectedMarker) ? "pass" : "fail",
      decoded ? decoded.replace(origin, "") : "no editor request to inspect",
    );
  }

  record(
    "browser: no uncaught page exceptions",
    pageErrors.length === 0 ? "pass" : "fail",
    pageErrors.length === 0 ? "none" : pageErrors.join(" | "),
  );
} catch (error) {
  const reason = error?.message ?? String(error);
  if (phase === "setup") {
    record(
      "browser: headless Chrome available",
      "na",
      `browser check skipped in this environment: ${reason}`,
    );
  } else {
    record("browser: verification crashed", "fail", reason);
  }
} finally {
  client?.close();
  if (chrome) {
    try {
      chrome.child.kill("SIGKILL");
    } catch {
      // Ignore.
    }
    await delay(300);
    try {
      rmSync(chrome.profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    } catch {
      // Chrome may still hold a lock; the directory is under the ignored .tmp/.
    }
  }
  await server.stop();
}

const failed = results.filter((result) => result.status === "fail").length;
const passed = results.filter((result) => result.status === "pass").length;
const notApplicable = results.filter((result) => result.status === "na").length;
console.log(
  JSON.stringify(
    {
      fixture: process.cwd(),
      origin,
      chrome: CHROME_PATH,
      results,
      passed,
      failed,
      notApplicable,
    },
    null,
    2,
  ),
);
process.exit(failed === 0 ? 0 : 1);
