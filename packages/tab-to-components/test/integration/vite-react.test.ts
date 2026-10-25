import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expectedMarker,
  fetchText,
  playgroundDir,
  startDevServer,
  type RunningServer,
} from "./helpers.js";

const PLAYGROUND = playgroundDir("vite-react");
const CLIENT_ID = "/@id/__x00__virtual:tab-to-components/client";
describe("plain Vite + @vitejs/plugin-react", () => {
  let running: RunningServer;

  beforeAll(async () => {
    running = await startDevServer(PLAYGROUND);
  });

  afterAll(async () => {
    await running?.close();
  });

  it("serves the index.html shell", async () => {
    const html = await fetchText(running.base, "/");
    expect(html).toContain('<div id="root">');
  });

  it("annotates the app modules with source markers", async () => {
    const app = await fetchText(running.base, "/src/App.tsx");
    // The module is already compiled by the React plugin, so markers appear as
    // props on the jsxDEV calls rather than as JSX attributes.
    expect(app).toContain('"data-ttc"');
    expect(app).not.toContain("app/vite.config.ts");
    expect(app).toContain(
      expectedMarker(PLAYGROUND, "src/App.tsx", "<Button"),
    );
  });

  it("injects the client runtime import into client modules", async () => {
    const app = await fetchText(running.base, "/src/App.tsx");
    expect(app).toContain("virtual:tab-to-components/client");
  });

  it("serves the client runtime as a module with its config", async () => {
    const response = await fetch(new URL(CLIENT_ID, running.base));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    const code = await response.text();
    expect(code).toContain("globalThis.__TTC_CONFIG__");
    expect(code).toContain('"open":"component"');
    expect(code).toContain(
      '"clickActions":["open","copy-file","copy-full-path"]',
    );
    // Default editor is VS Code, served by the plugin's own endpoint.
    expect(code).toContain('"editorEndpoint":"__ttc/open-in-editor"');
    expect(code).toContain(PLAYGROUND.replace(/\\/g, "/"));
    // the bundled runtime itself must be present
    expect(code).toContain("__TTC_READY__");
  });

  it("does not annotate node_modules", async () => {
    const response = await fetch(
      new URL("/node_modules/react/index.js", running.base),
    );
    const code = await response.text();
    expect(code).not.toContain("data-ttc=");
  });
});

describe("plugin order does not matter", () => {
  it("annotates raw JSX when the plugin runs before the React plugin", async () => {
    const { createServer } = await import("vite");
    const [reactPlugin, { tabToComponents }] = await Promise.all([
      import("@vitejs/plugin-react").then((mod) => mod.default),
      import("../../src/index.js"),
    ]);
    const server = await createServer({
      root: PLAYGROUND,
      configFile: false,
      logLevel: "error",
      plugins: [tabToComponents(), reactPlugin()],
      server: { port: 0, strictPort: false, host: "127.0.0.1" },
    });
    try {
      await server.listen();
      const base = server.resolvedUrls?.local?.[0];
      expect(base).toBeTruthy();
      const code = await fetchText(base as string, "/src/App.tsx");
      // Raw JSX path: markers were inserted as JSX attributes before the
      // React plugin compiled the module.
      expect(code).toContain("data-ttc");
      expect(code).toContain(
        expectedMarker(PLAYGROUND, "src/App.tsx", "<Button"),
      );
    } finally {
      await server.close();
    }
  });
});
