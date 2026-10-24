import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tabToComponents } from "../src/index.js";
import { VERSION } from "../src/version.js";
import { CLIENT_RESOLVED_ID, CLIENT_VIRTUAL_ID } from "../src/virtual.js";

const ROOT = "D:/Github/app";

type AnyFn = (...args: any[]) => any;

interface TestPlugin {
  name: string;
  apply?: string;
  enforce?: string;
  configResolved?: AnyFn;
  transform?: AnyFn;
  resolveId?: AnyFn;
  load?: AnyFn;
}

function asTestPlugin(plugin: ReturnType<typeof tabToComponents>): TestPlugin {
  return plugin as unknown as TestPlugin;
}

function resolvedConfig(command: "serve" | "build" = "serve", base = "/") {
  return {
    root: ROOT,
    base,
    command,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  } as never;
}

function setup(
  options: Parameters<typeof tabToComponents>[0] = {},
  command: "serve" | "build" = "serve",
  base = "/",
): TestPlugin {
  const plugin = asTestPlugin(tabToComponents(options));
  plugin.configResolved?.call({}, resolvedConfig(command, base));
  return plugin;
}

function runTransform(
  plugin: TestPlugin,
  code: string,
  id: string,
  context: { environment?: { name?: string }; ssr?: boolean } = {},
): { code: string; map: unknown } | null {
  return (plugin.transform as AnyFn).call(
    { environment: context.environment },
    code,
    id,
    context.ssr === undefined ? {} : { ssr: context.ssr },
  ) as { code: string; map: unknown } | null;
}

describe("plugin shape", () => {
  it("is a dev-only pre plugin", () => {
    const plugin = asTestPlugin(tabToComponents());
    expect(plugin.name).toBe("tab-to-components");
    expect(plugin.apply).toBe("serve");
    expect(plugin.enforce).toBe("pre");
  });

  it("resolves the virtual client module", () => {
    const plugin = asTestPlugin(tabToComponents());
    const resolveId = plugin.resolveId as AnyFn;
    expect(resolveId.call({}, CLIENT_VIRTUAL_ID)).toBe(CLIENT_RESOLVED_ID);
    expect(resolveId.call({}, "some-other-module")).toBeNull();
  });

  it("keeps VERSION in sync with package.json", () => {
    const packageJsonPath = fileURLToPath(
      new URL("../package.json", import.meta.url),
    );
    const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version: string;
    };
    expect(manifest.version).toBe(VERSION);
  });
});

describe("transform hook", () => {
  it("annotates and injects the overlay in the client environment", () => {
    const plugin = setup();
    const result = runTransform(
      plugin,
      "export const A = () => <main><Button /></main>;\n",
      `${ROOT}/app/routes/home.tsx`,
      { environment: { name: "client" } },
    );
    expect(result?.code).toContain(`import "${CLIENT_VIRTUAL_ID}";`);
    expect(result?.code).toContain('data-ttc={"app/routes/home.tsx:1:24"}');
    expect(result?.code).toContain('data-ttc-name={"Button"}');
  });

  it("only annotates in the ssr environment by default", () => {
    const plugin = setup();
    const result = runTransform(
      plugin,
      "export const A = () => <div />;\n",
      `${ROOT}/app/routes/home.tsx`,
      { environment: { name: "ssr" } },
    );
    expect(result?.code).toContain("data-ttc=");
    expect(result?.code).not.toContain(CLIENT_VIRTUAL_ID);
  });

  it("skips the ssr environment when ssr is disabled", () => {
    const plugin = setup({ ssr: false });
    const result = runTransform(
      plugin,
      "export const A = () => <div />;\n",
      `${ROOT}/app/routes/home.tsx`,
      { environment: { name: "ssr" } },
    );
    expect(result).toBeNull();
  });

  it("falls back to options.ssr when no environment is available", () => {
    const plugin = setup();
    const client = runTransform(
      plugin,
      "export const A = () => <div />;\n",
      `${ROOT}/app/routes/home.tsx`,
      { ssr: false },
    );
    expect(client?.code).toContain(CLIENT_VIRTUAL_ID);
    const server = runTransform(
      plugin,
      "export const A = () => <div />;\n",
      `${ROOT}/app/routes/home.tsx`,
      { ssr: true },
    );
    expect(server?.code).not.toContain(CLIENT_VIRTUAL_ID);
  });

  it("ignores node_modules, virtual modules and css", () => {
    const plugin = setup();
    for (const id of [
      `${ROOT}/node_modules/lib/index.jsx`,
      "\0virtual:react-router/dev",
      `${ROOT}/app/styles.css`,
    ]) {
      expect(
        runTransform(plugin, "export const A = () => <div />;\n", id, {
          environment: { name: "client" },
        }),
      ).toBeNull();
    }
  });

  it("does nothing during build", () => {
    const plugin = setup({}, "build");
    expect(
      runTransform(
        plugin,
        "export const A = () => <div />;\n",
        `${ROOT}/app/a.tsx`,
        { environment: { name: "client" } },
      ),
    ).toBeNull();
  });

  it("supports overlay: 'entry' mode", () => {
    const plugin = setup({ overlay: "entry" });
    const route = runTransform(
      plugin,
      "export const A = () => <div />;\n",
      `${ROOT}/app/routes/home.tsx`,
      { environment: { name: "client" } },
    );
    expect(route?.code).not.toContain(CLIENT_VIRTUAL_ID);
    const entry = runTransform(
      plugin,
      'import "./root";\n',
      `${ROOT}/app/entry.client.tsx`,
      { environment: { name: "client" } },
    );
    expect(entry?.code).toContain(CLIENT_VIRTUAL_ID);
  });

  it.skipIf(
    !fs.existsSync(fileURLToPath(new URL("../dist/client.js", import.meta.url))),
  )("serves the client module with the resolved config", () => {
    const plugin = setup({ editorEndpoint: "custom-open" }, "serve", "/app/");
    const code = (plugin.load as AnyFn).call({}, CLIENT_RESOLVED_ID) as string;
    expect(code).toBeTruthy();
    const configLine = code.split("\n")[0] ?? "";
    expect(configLine).toContain('"base":"/app/"');
    expect(configLine).toContain('"editorEndpoint":"custom-open"');
    expect(configLine).toContain(`"root":"${ROOT}"`);
    expect(configLine).toContain('"open":"component"');
  });
});
