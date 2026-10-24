import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { tabToComponents } from "../src/index.js";
import { CLIENT_RESOLVED_ID, CLIENT_VIRTUAL_ID } from "../src/virtual.js";

const ROOT = "D:/Github/app";
const SOURCE = "export const A = () => <main><Button /></main>;\n";
const DIST_CLIENT = fileURLToPath(
  new URL("../dist/client.js", import.meta.url),
);
const HAS_CLIENT_ASSET = fs.existsSync(DIST_CLIENT);

type AnyFn = (...args: any[]) => any;

interface TestPlugin {
  name: string;
  apply?: string | ((config: unknown, env: unknown) => boolean);
  enforce?: string;
  configResolved?: AnyFn;
  transform?: AnyFn;
  resolveId?: AnyFn;
  load?: AnyFn;
  configureServer?: AnyFn;
}

interface FakeLogger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function asTestPlugin(plugin: ReturnType<typeof tabToComponents>): TestPlugin {
  return plugin as unknown as TestPlugin;
}

function fakeLogger(): FakeLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function resolvedConfig(
  command: "serve" | "build",
  overrides: { root?: string; base?: string } = {},
): { config: never; logger: FakeLogger } {
  const logger = fakeLogger();
  return {
    config: {
      root: overrides.root ?? ROOT,
      base: overrides.base ?? "/",
      command,
      logger,
    } as never,
    logger,
  };
}

function configure(
  plugin: TestPlugin,
  command: "serve" | "build",
  overrides: { root?: string; base?: string } = {},
): FakeLogger {
  const { config, logger } = resolvedConfig(command, overrides);
  plugin.configResolved?.call({}, config);
  return logger;
}

function runTransform(
  plugin: TestPlugin,
  code = SOURCE,
  id = `${ROOT}/app/routes/home.tsx`,
): { code: string; map: unknown } | null {
  return (plugin.transform as AnyFn).call(
    { environment: { name: "client" } },
    code,
    id,
    {},
  ) as { code: string; map: unknown } | null;
}

function runResolve(plugin: TestPlugin, id: string): unknown {
  return (plugin.resolveId as AnyFn).call({}, id);
}

function runLoad(plugin: TestPlugin, id: string): unknown {
  return (plugin.load as AnyFn).call({}, id);
}

function fakeServer(): {
  server: never;
  use: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} {
  const use = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  return {
    server: {
      middlewares: { use },
      config: { logger: { info, warn }, root: ROOT },
    } as never,
    use,
    info,
    warn,
  };
}

describe("dev-only contract", () => {
  it("declares the Vite dev-server gate", () => {
    const plugin = asTestPlugin(tabToComponents());
    expect(plugin.name).toBe("tab-to-components");
    expect(plugin.apply).toBe("serve");
    expect(plugin.enforce).toBe("pre");
  });

  it("stays inert until a serve config is resolved", () => {
    const plugin = asTestPlugin(tabToComponents());

    expect(runResolve(plugin, CLIENT_VIRTUAL_ID)).toBeNull();
    expect(runLoad(plugin, CLIENT_RESOLVED_ID)).toBeNull();
    expect(runTransform(plugin)).toBeNull();

    const { server, use } = fakeServer();
    plugin.configureServer?.call({}, server);
    expect(use).not.toHaveBeenCalled();
  });

  it("warns and stays inert when a build config reaches the plugin", () => {
    const plugin = asTestPlugin(tabToComponents({ log: true }));
    const logger = configure(plugin, "build");

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0]?.[0] ?? "")).toMatch(/dev-only/i);

    expect(runResolve(plugin, CLIENT_VIRTUAL_ID)).toBeNull();
    expect(runLoad(plugin, CLIENT_RESOLVED_ID)).toBeNull();
    expect(runTransform(plugin)).toBeNull();

    const { server, use, info } = fakeServer();
    plugin.configureServer?.call({}, server);
    expect(use).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("warns only once when build configs are resolved repeatedly", () => {
    const plugin = asTestPlugin(tabToComponents());
    const logger = configure(plugin, "build");

    plugin.configResolved?.call(
      {},
      resolvedConfig("build", { root: "D:/somewhere/else" }).config,
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("activates when a serve config follows a rejected build config", () => {
    const plugin = asTestPlugin(tabToComponents());
    configure(plugin, "build");
    const logger = configure(plugin, "serve");

    expect(logger.warn).not.toHaveBeenCalled();
    expect(runResolve(plugin, CLIENT_VIRTUAL_ID)).toBe(CLIENT_RESOLVED_ID);

    const result = runTransform(plugin);
    expect(result?.code).toContain('data-ttc={"app/routes/home.tsx:1:24"}');
    expect(result?.code).toContain(`import "${CLIENT_VIRTUAL_ID}";`);
  });

  it("keeps the first serve config authoritative across child compilers", () => {
    const plugin = asTestPlugin(tabToComponents());
    configure(plugin, "serve", { root: ROOT, base: "/" });
    const logger = configure(plugin, "serve", {
      root: "D:/child/root",
      base: "/child/",
    });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(runResolve(plugin, CLIENT_VIRTUAL_ID)).toBe(CLIENT_RESOLVED_ID);
    expect(runTransform(plugin)?.code).toContain(
      'data-ttc={"app/routes/home.tsx:1:24"}',
    );
  });

  it("stays active if a build config is resolved after the dev server", () => {
    const plugin = asTestPlugin(tabToComponents());
    configure(plugin, "serve");
    const logger = configure(plugin, "build");

    expect(logger.warn).not.toHaveBeenCalled();
    expect(runResolve(plugin, CLIENT_VIRTUAL_ID)).toBe(CLIENT_RESOLVED_ID);
    expect(runTransform(plugin)).not.toBeNull();
  });

  it.skipIf(!HAS_CLIENT_ASSET)(
    "serves the client prelude only from the dev server",
    () => {
      const plugin = asTestPlugin(
        tabToComponents({ editorEndpoint: "custom-open" }),
      );
      configure(plugin, "serve", { base: "/app/" });

      const code = runLoad(plugin, CLIENT_RESOLVED_ID) as string;
      expect(code).toContain("globalThis.__TTC_CONFIG__=");
      expect(code).toContain('"editorEndpoint":"custom-open"');
      expect(code).toContain('"base":"/app/"');
      expect(code).toContain("__TTC_READY__");

      expect(runLoad(plugin, "/some/other/module")).toBeNull();
    },
  );
});

describe("published package surface", () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    exports?: Record<string, unknown>;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  it("does not expose the browser runtime as an importable entry", () => {
    expect(manifest.exports).toBeTruthy();
    expect(Object.keys(manifest.exports ?? {})).not.toContain(
      "./dist/client.js",
    );
    expect(Object.keys(manifest.exports ?? {})).not.toContain("./client");
    expect(manifest.exports?.["."]).toBeTruthy();
  });

  it("keeps Vite a peer dependency, never a hard runtime dependency", () => {
    expect(manifest.dependencies?.vite).toBeUndefined();
    expect(manifest.peerDependencies?.vite).toBeTruthy();
  });
});
