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
