import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packageDir, playgroundDir } from "./helpers.js";

const PLAYGROUND = playgroundDir("vite-react");
const REPO_ROOT = path.resolve(packageDir, "../..");
const FAKE_EDITOR = path.join(REPO_ROOT, "scripts", "fake-editor.mjs");
const LOG_FILE = path.join(packageDir, ".tmp", "editor-endpoint.log");

const CLIENT_VIRTUAL = "/@id/__x00__virtual:tab-to-components/client";

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for the fake editor to run");
}

describe("custom editor endpoint", () => {
  let server: import("vite").ViteDevServer;
  let base: string;
  let previousLogFile: string | undefined;

  beforeAll(async () => {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.rmSync(LOG_FILE, { force: true });
    previousLogFile = process.env.TTC_EDITOR_LOG;
    process.env.TTC_EDITOR_LOG = LOG_FILE;

    const { createServer } = await import("vite");
    const reactPlugin = (await import("@vitejs/plugin-react")).default;
    const { tabToComponents } = await import("../../src/index.js");

    server = await createServer({
      root: PLAYGROUND,
      configFile: false,
      logLevel: "error",
      plugins: [
        reactPlugin(),
        tabToComponents({
          log: false,
          // The reader can use any editor command; the test points it at a
          // script that records the location it was asked to open.
          editor: {
            command: process.execPath,
            args: [FAKE_EDITOR, "{file}:{line}:{column}"],
          },
        }),
      ],
      server: { port: 0, strictPort: false, host: "127.0.0.1" },
    });
    await server.listen();
    base = server.resolvedUrls?.local?.[0] as string;
  });

  afterAll(async () => {
    await server?.close();
    fs.rmSync(LOG_FILE, { force: true });
    if (previousLogFile === undefined) delete process.env.TTC_EDITOR_LOG;
    else process.env.TTC_EDITOR_LOG = previousLogFile;
  });

  it("tells the browser to use the plugin's editor endpoint", async () => {
    const code = await (await fetch(new URL(CLIENT_VIRTUAL, base))).text();
    expect(code).toContain('"editorEndpoint":"__ttc/open-in-editor"');
  });

  it("opens the requested location through the configured editor command", async () => {
    const file = path.join(PLAYGROUND, "src", "App.tsx").replace(/\\/g, "/");
    const expected = `${file}:20:9`;
    const response = await fetch(
      new URL(
        `/__ttc/open-in-editor?file=${encodeURIComponent(expected)}`,
        base,
      ),
    );
    expect(response.status).toBe(200);

    await waitFor(() => fs.existsSync(LOG_FILE));
    const log = fs.readFileSync(LOG_FILE, "utf8");
    expect(log).toContain(expected);
  });

  it("rejects files outside the project root", async () => {
    const response = await fetch(
      new URL(
        `/__ttc/open-in-editor?file=${encodeURIComponent("D:/outside/file.tsx:1:1")}`,
        base,
      ),
    );
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("invalid `file`");
  });

  it("rejects requests without a file parameter", async () => {
    const response = await fetch(new URL("/__ttc/open-in-editor", base));
    expect(response.status).toBe(400);
  });

  it("rejects unsupported methods", async () => {
    const response = await fetch(new URL("/__ttc/open-in-editor", base), {
      method: "DELETE",
    });
    expect(response.status).toBe(405);
  });
});

describe("default editor (no editor configured → VS Code)", () => {
  let server: import("vite").ViteDevServer;
  let base: string;
  let fakeBinDir: string;
  let codeLog: string;
  let previousPath: string | undefined;

  beforeAll(async () => {
    // Put a fake `code` command first on PATH so the default launcher can be
    // observed without VS Code being installed. It lives outside the project
    // tree on purpose: the launcher refuses executables planted in the project
    // directory (binary-planting guard), which is exactly what this fixture
    // would otherwise look like.
    fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "ttc-fake-editor-"));
    codeLog = path.join(fakeBinDir, "code.log");
    fs.rmSync(codeLog, { force: true });
    if (process.platform === "win32") {
      fs.writeFileSync(
        path.join(fakeBinDir, "code.cmd"),
        `@echo off\r\necho %*>>"${codeLog}"\r\n`,
        "utf8",
      );
    } else {
      const script = path.join(fakeBinDir, "code");
      fs.writeFileSync(script, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${codeLog}"\n`, "utf8");
      fs.chmodSync(script, 0o755);
    }
    previousPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${previousPath ?? ""}`;

    const { createServer } = await import("vite");
    const reactPlugin = (await import("@vitejs/plugin-react")).default;
    const { tabToComponents } = await import("../../src/index.js");
    server = await createServer({
      root: PLAYGROUND,
      configFile: false,
      logLevel: "error",
      plugins: [reactPlugin(), tabToComponents({ log: false })],
      server: { port: 0, strictPort: false, host: "127.0.0.1" },
    });
    await server.listen();
    base = server.resolvedUrls?.local?.[0] as string;
  });

  afterAll(async () => {
    await server?.close();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    fs.rmSync(fakeBinDir, { recursive: true, force: true });
  });

  it("uses the plugin's endpoint, i.e. it launches the editor itself", async () => {
    const code = await (await fetch(new URL(CLIENT_VIRTUAL, base))).text();
    expect(code).toContain('"editorEndpoint":"__ttc/open-in-editor"');
  });

  it("opens the location with `code` by default", async () => {
    const file = path.join(PLAYGROUND, "src", "App.tsx").replace(/\\/g, "/");
    const expected = `${file}:20:9`;
    const response = await fetch(
      new URL(`/__ttc/open-in-editor?file=${encodeURIComponent(expected)}`, base),
    );
    expect(response.status).toBe(200);

    await waitFor(() => fs.existsSync(codeLog));
    const log = fs.readFileSync(codeLog, "utf8");
    expect(log).toContain(expected);
    // VS Code family preset arguments.
    expect(log).toContain("-r");
    expect(log).toContain("-g");
  });
});

describe("editor: 'auto' delegates to Vite / launch-editor", () => {
  let server: import("vite").ViteDevServer;
  let base: string;

  beforeAll(async () => {
    const { createServer } = await import("vite");
    const reactPlugin = (await import("@vitejs/plugin-react")).default;
    const { tabToComponents } = await import("../../src/index.js");
    server = await createServer({
      root: PLAYGROUND,
      configFile: false,
      logLevel: "error",
      plugins: [reactPlugin(), tabToComponents({ log: false, editor: "auto" })],
      server: { port: 0, strictPort: false, host: "127.0.0.1" },
    });
    await server.listen();
    base = server.resolvedUrls?.local?.[0] as string;
  });

  afterAll(async () => {
    await server?.close();
  });

  it("keeps using Vite's built-in open-in-editor endpoint", async () => {
    const code = await (await fetch(new URL(CLIENT_VIRTUAL, base))).text();
    expect(code).toContain('"editorEndpoint":"__open-in-editor"');
  });

  it("does not register the custom endpoint", async () => {
    const response = await fetch(
      new URL(
        `/__ttc/open-in-editor?file=${encodeURIComponent(path.join(PLAYGROUND, "src", "App.tsx").replace(/\\/g, "/") + ":1:1")}`,
        base,
      ),
    );
    // Without a custom editor the path falls through to Vite's HTML fallback.
    expect(response.headers.get("content-type") ?? "").toContain("text/html");
  });

  it("rejects files outside the project root before Vite sees them", async () => {
    const response = await fetch(
      new URL(
        `/__open-in-editor?file=${encodeURIComponent("D:/outside/file.tsx:1:1")}`,
        base,
      ),
    );
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain(
      "outside the project root",
    );
  });

  it("rejects traversal to the project root's parent", async () => {
    const response = await fetch(
      new URL(
        `/__open-in-editor?file=${encodeURIComponent("../../outside.tsx:1:1")}`,
        base,
      ),
    );
    expect(response.status).toBe(400);
  });
});

function writeRecordingShim(binDir: string, name: string, logPath: string): void {
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(binDir, `${name}.cmd`),
      `@echo off\r\necho %*>>"${logPath}"\r\n`,
      "utf8",
    );
    return;
  }
  const script = path.join(binDir, name);
  fs.writeFileSync(
    script,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\n`,
    "utf8",
  );
  fs.chmodSync(script, 0o755);
}

function readLog(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Absolute path of a playground file with forward slashes. */
function playgroundFile(relativePath: string): string {
  return path.join(PLAYGROUND, relativePath).replace(/\\/g, "/");
}

function playgroundMarker(
  relativePath: string,
  line: number,
  column: number,
): string {
  return `${playgroundFile(relativePath)}:${line}:${column}`;
}

describe("per-IDE click actions", () => {
  let server: import("vite").ViteDevServer;
  let base: string;
  let fakeBinDir: string;
  let cursorLog: string;
  let webstormLog: string;
  let previousPath: string | undefined;

  beforeAll(async () => {
    fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "ttc-fake-ides-"));
    cursorLog = path.join(fakeBinDir, "cursor.log");
    webstormLog = path.join(fakeBinDir, "webstorm.log");
    fs.rmSync(cursorLog, { force: true });
    fs.rmSync(webstormLog, { force: true });
    writeRecordingShim(fakeBinDir, "cursor", cursorLog);
    writeRecordingShim(fakeBinDir, "webstorm", webstormLog);

    previousPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${previousPath ?? ""}`;

    const { createServer } = await import("vite");
    const reactPlugin = (await import("@vitejs/plugin-react")).default;
    const { tabToComponents } = await import("../../src/index.js");
    server = await createServer({
      root: PLAYGROUND,
      configFile: false,
      logLevel: "error",
      plugins: [
        reactPlugin(),
        tabToComponents({
          log: false,
          clickActions: ["open-cursor", "open-webstorm"],
        }),
      ],
      server: { port: 0, strictPort: false, host: "127.0.0.1" },
    });
    await server.listen();
    base = server.resolvedUrls?.local?.[0] as string;
  });

  afterAll(async () => {
    await server?.close();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    fs.rmSync(fakeBinDir, { recursive: true, force: true });
  });

  it("launches `cursor` with the VS Code family arguments", async () => {
    const expected = playgroundMarker("src/App.tsx", 20, 9);
    const response = await fetch(
      new URL(
        `/__ttc/open-in-editor?file=${encodeURIComponent(expected)}&ide=cursor`,
        base,
      ),
    );
    expect(response.status).toBe(200);

    await waitFor(() => readLog(cursorLog).includes(expected));
    const log = readLog(cursorLog);
    expect(log).toContain("-r");
    expect(log).toContain("-g");
    expect(log).toContain(expected);
  });

  it("launches `webstorm` with the JetBrains line/column arguments", async () => {
    const file = playgroundFile("src/App.tsx");
    const expected = `${file}:20:9`;
    const response = await fetch(
      new URL(
        `/__ttc/open-in-editor?file=${encodeURIComponent(expected)}&ide=webstorm`,
        base,
      ),
    );
    expect(response.status).toBe(200);

    await waitFor(() => readLog(webstormLog).includes(file));
    const log = readLog(webstormLog);
    expect(log).toContain("--line 20 --column 9");
    expect(log).toContain(file);
  });

  it("rejects an ide id the plugin does not handle", async () => {
    const file = playgroundFile("src/App.tsx");
    const response = await fetch(
      new URL(
        `/__ttc/open-in-editor?file=${encodeURIComponent(`${file}:20:9`)}&ide=phpstorm`,
        base,
      ),
    );
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("invalid `ide`");
  });

  it("rejects a known IDE that is not in clickActions", async () => {
    const file = playgroundFile("src/App.tsx");
    const response = await fetch(
      new URL(
        `/__ttc/open-in-editor?file=${encodeURIComponent(`${file}:20:9`)}&ide=trae`,
        base,
      ),
    );
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("invalid `ide`");
  });

  it("launches two different IDEs for the same file", async () => {
    const file = playgroundFile("src/main.tsx");
    const expected = `${file}:1:1`;
    const target = `/__ttc/open-in-editor?file=${encodeURIComponent(expected)}`;

    const cursorResponse = await fetch(new URL(`${target}&ide=cursor`, base));
    expect(cursorResponse.status).toBe(200);
    const webstormResponse = await fetch(
      new URL(`${target}&ide=webstorm`, base),
    );
    expect(webstormResponse.status).toBe(200);

    await waitFor(
      () =>
        readLog(cursorLog).includes(expected) &&
        readLog(webstormLog).includes(file),
    );
    expect(occurrences(readLog(cursorLog), expected)).toBe(1);
    expect(occurrences(readLog(webstormLog), file)).toBe(1);
  });

  it("coalesces duplicate requests for the same IDE and file", async () => {
    const file = playgroundFile("src/components/Button.tsx");
    const expected = `${file}:1:1`;
    const target = `/__ttc/open-in-editor?file=${encodeURIComponent(expected)}&ide=cursor`;

    const [first, second] = await Promise.all([
      fetch(new URL(target, base)),
      fetch(new URL(target, base)),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    await waitFor(() => readLog(cursorLog).includes(expected));
    expect(occurrences(readLog(cursorLog), expected)).toBe(1);
  });
});

describe("editor: 'auto' handles per-IDE click actions itself", () => {
  let server: import("vite").ViteDevServer;
  let base: string;
  let fakeBinDir: string;
  let cursorLog: string;
  let codeLog: string;
  let previousPath: string | undefined;

  beforeAll(async () => {
    fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "ttc-auto-ide-"));
    cursorLog = path.join(fakeBinDir, "cursor.log");
    codeLog = path.join(fakeBinDir, "code.log");
    fs.rmSync(cursorLog, { force: true });
    fs.rmSync(codeLog, { force: true });
    writeRecordingShim(fakeBinDir, "cursor", cursorLog);
    // Also shim `code`, so a request that wrongly falls through to Vite's
    // launch-editor cannot open the developer's real VS Code.
    writeRecordingShim(fakeBinDir, "code", codeLog);

    previousPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${previousPath ?? ""}`;

    const { createServer } = await import("vite");
    const reactPlugin = (await import("@vitejs/plugin-react")).default;
    const { tabToComponents } = await import("../../src/index.js");
    server = await createServer({
      root: PLAYGROUND,
      configFile: false,
      logLevel: "error",
      plugins: [
        reactPlugin(),
        tabToComponents({
          log: false,
          editor: "auto",
          clickActions: ["open-cursor"],
        }),
      ],
      server: { port: 0, strictPort: false, host: "127.0.0.1" },
    });
    await server.listen();
    base = server.resolvedUrls?.local?.[0] as string;
  });

  afterAll(async () => {
    await server?.close();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    fs.rmSync(fakeBinDir, { recursive: true, force: true });
  });

  it("answers the ide request itself instead of delegating to Vite", async () => {
    const expected = playgroundMarker("src/components/Badge.tsx", 1, 1);
    const response = await fetch(
      new URL(
        `/__open-in-editor?file=${encodeURIComponent(expected)}&ide=cursor`,
        base,
      ),
    );
    expect(response.status).toBe(200);

    await waitFor(() => readLog(cursorLog).includes(expected));
    expect(readLog(cursorLog)).toContain("-r");
    expect(readLog(cursorLog)).toContain("-g");
    // Vite's launch-editor was not involved.
    expect(fs.existsSync(codeLog)).toBe(false);
  });
});
