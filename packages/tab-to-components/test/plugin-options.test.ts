import { describe, expect, it } from "vitest";
import { AUTO_EDITOR, DEFAULT_EDITOR, tabToComponents } from "../src/index.js";
import { CLIENT_RESOLVED_ID, CLIENT_VIRTUAL_ID } from "../src/virtual.js";

const ROOT = "D:/proj";

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

interface ClientPayload {
  version: string;
  root: string;
  base: string;
  keyboard: string[];
  open: string;
  clickActions: string[];
  customActions?: Array<{
    id: string;
    label: string;
    copy: string;
    icon?: string;
  }>;
  menu: boolean;
  theme: string;
  editorEndpoint: string;
}

function createPlugin(
  options: Parameters<typeof tabToComponents>[0] = {},
  root = ROOT,
): TestPlugin {
  const plugin = tabToComponents(options) as unknown as TestPlugin;
  plugin.configResolved?.({
    root,
    base: "/",
    command: "serve",
    logger: { info() {}, warn() {}, error() {} },
  } as never);
  return plugin;
}

function clientPayload(plugin: TestPlugin): ClientPayload {
  const code = (plugin.load as AnyFn).call({}, CLIENT_RESOLVED_ID) as string;
  const prelude = code.split("\n")[0] ?? "";
  const json = prelude.replace(/^globalThis\.__TTC_CONFIG__=/, "").replace(/;$/, "");
  return JSON.parse(json) as ClientPayload;
}

function transform(
  plugin: TestPlugin,
  code: string,
  id: string,
  environment: string | undefined = "client",
) {
  return (plugin.transform as AnyFn).call({ environment: { name: environment } }, code, id, {}) as
    | { code: string }
    | null;
}

const SOURCE = "export const A = () => <main><Button /></main>;\n";

describe("keyboard option", () => {
  it("defaults to alt", () => {
    expect(clientPayload(createPlugin()).keyboard).toEqual(["alt"]);
  });

  it("accepts a single key and an array", () => {
    expect(clientPayload(createPlugin({ keyboard: "ctrl" })).keyboard).toEqual(["ctrl"]);
    expect(
      clientPayload(createPlugin({ keyboard: ["meta", "shift"] })).keyboard,
    ).toEqual(["meta", "shift"]);
  });

  it("drops unknown keys, dedupes, and falls back to alt", () => {
    expect(
      clientPayload(createPlugin({ keyboard: ["alt", "alt"] as never })).keyboard,
    ).toEqual(["alt"]);
    expect(
      clientPayload(createPlugin({ keyboard: ["hyper"] as never })).keyboard,
    ).toEqual(["alt"]);
  });
});

describe("open / menu options", () => {
  it("defaults to opening the nearest component and showing the menu", () => {
    const payload = clientPayload(createPlugin());
    expect(payload.open).toBe("component");
    expect(payload.menu).toBe(true);
  });

  it("passes through element and menu modes", () => {
    expect(clientPayload(createPlugin({ open: "element" })).open).toBe("element");
    expect(clientPayload(createPlugin({ open: "menu" })).open).toBe("menu");
  });

  it("falls back to component for an invalid mode", () => {
    expect(
      clientPayload(createPlugin({ open: "sidebar" as never })).open,
    ).toBe("component");
  });

  it("can disable the chain menu", () => {
    expect(clientPayload(createPlugin({ menu: false })).menu).toBe(false);
  });

  it("uses a custom editor endpoint when configured", () => {
    expect(
      clientPayload(createPlugin({ editorEndpoint: "/custom/open" }))
        .editorEndpoint,
    ).toBe("custom/open");
  });
});

describe("theme option", () => {
  it("defaults to the original dark overlay", () => {
    expect(clientPayload(createPlugin()).theme).toBe("dark");
  });

  it("passes the light theme through to the browser runtime", () => {
    expect(clientPayload(createPlugin({ theme: "light" })).theme).toBe("light");
    expect(clientPayload(createPlugin({ theme: "dark" })).theme).toBe("dark");
  });

  it("falls back to dark for an unknown theme", () => {
    expect(
      clientPayload(createPlugin({ theme: "solarized" as never })).theme,
    ).toBe("dark");
  });
});

describe("clickActions option", () => {
  it("defaults to opening the editor, the file name and the full path", () => {
    expect(clientPayload(createPlugin()).clickActions).toEqual([
      "open",
      "copy-file",
      "copy-full-path",
    ]);
  });

  it("passes an ordered array through and dedupes it", () => {
    expect(
      clientPayload(
        createPlugin({
          clickActions: [
            "copy-file",
            "copy-full-path",
            "copy-path",
            "copy-file",
            "open",
          ],
        }),
      ).clickActions,
    ).toEqual(["copy-file", "copy-full-path", "copy-path", "open"]);
  });

  it("accepts a single action as a shorthand", () => {
    expect(
      clientPayload(createPlugin({ clickActions: "open" })).clickActions,
    ).toEqual(["open"]);
  });

  it("passes the four per-IDE open actions through in order", () => {
    expect(
      clientPayload(
        createPlugin({
          clickActions: [
            "open-cursor",
            "open-code",
            "open-webstorm",
            "open-trae",
          ],
        }),
      ).clickActions,
    ).toEqual(["open-cursor", "open-code", "open-webstorm", "open-trae"]);
  });

  it("keeps per-IDE actions ordered among the copy actions and dedupes them", () => {
    expect(
      clientPayload(
        createPlugin({
          clickActions: [
            "open-trae",
            "copy-file",
            "open-trae",
            "open-webstorm",
            "copy-full-path",
          ],
        }),
      ).clickActions,
    ).toEqual([
      "open-trae",
      "copy-file",
      "open-webstorm",
      "copy-full-path",
    ]);
  });

  it("drops an unknown action without resetting the known ones", () => {
    expect(
      clientPayload(
        createPlugin({ clickActions: ["open-code", "sidebar"] as never }),
      ).clickActions,
    ).toEqual(["open-code"]);
  });

  it("drops unknown actions and falls back to the defaults", () => {
    expect(
      clientPayload(createPlugin({ clickActions: ["sidebar"] as never }))
        .clickActions,
    ).toEqual(["open", "copy-file", "copy-full-path"]);
    expect(
      clientPayload(createPlugin({ clickActions: [] })).clickActions,
    ).toEqual(["open", "copy-file", "copy-full-path"]);
  });
});

describe("customActions option", () => {
  it("is omitted from the injected config when empty", () => {
    expect(clientPayload(createPlugin()).customActions).toBeUndefined();
    expect(clientPayload(createPlugin({ customActions: [] })).customActions).toBeUndefined();
  });

  it("passes valid custom actions through in order", () => {
    expect(
      clientPayload(
        createPlugin({
          customActions: [
            {
              id: "review",
              label: "Copy review prompt",
              copy: "Review {name} at {location}",
              icon: "sparkles",
            },
            { id: "issue", label: "Copy issue", copy: "{chain} ({file})" },
          ],
        }),
      ).customActions,
    ).toEqual([
      {
        id: "review",
        label: "Copy review prompt",
        copy: "Review {name} at {location}",
        icon: "sparkles",
      },
      { id: "issue", label: "Copy issue", copy: "{chain} ({file})" },
    ]);
  });

  it("drops malformed custom actions and dedupes ids", () => {
    expect(
      clientPayload(
        createPlugin({
          customActions: [
            { id: "ok", label: "Fine", copy: "{file}" },
            { id: "ok", label: "Duplicate", copy: "{file}" },
            { id: "bad id", label: "Bad id", copy: "{file}" },
            { id: "no-label", label: "   ", copy: "{file}" },
            { id: "no-copy", label: "No copy", copy: "   " },
            { id: "too-long", label: "L".repeat(81), copy: "{file}" },
            { id: "icon", label: "Icon", copy: "{file}", icon: "rocket" as never },
            null as never,
          ],
        }),
      ).customActions,
    ).toEqual([
      { id: "ok", label: "Fine", copy: "{file}" },
      { id: "icon", label: "Icon", copy: "{file}" },
    ]);
  });

  it("keeps a 600-character template and drops a 601-character one", () => {
    const payload = clientPayload(
      createPlugin({
        customActions: [
          { id: "max", label: "Max", copy: "x".repeat(600) },
          { id: "over", label: "Over", copy: "x".repeat(601) },
        ],
      }),
    );
    expect(payload.customActions).toHaveLength(1);
    expect(payload.customActions?.[0]?.id).toBe("max");
    expect(payload.customActions?.[0]?.copy).toHaveLength(600);
  });

  it("caps the number of custom actions at twelve", () => {
    const actions = Array.from({ length: 20 }, (_, index) => ({
      id: `action-${index}`,
      label: `Action ${index}`,
      copy: "{file}",
    }));
    const payload = clientPayload(createPlugin({ customActions: actions }));
    expect(payload.customActions).toHaveLength(12);
    expect(payload.customActions?.[11]?.id).toBe("action-11");
  });
});

describe("editor option", () => {
  it("defaults to VS Code through the plugin's own endpoint", () => {
    const payload = clientPayload(createPlugin());
    expect(payload.editorEndpoint).toBe("__ttc/open-in-editor");
  });

  it("exposes the default editor name", () => {
    expect(DEFAULT_EDITOR).toBe("code");
    expect(AUTO_EDITOR).toBe("auto");
  });

  it("uses Vite's built-in endpoint for editor: 'auto'", () => {
    expect(clientPayload(createPlugin({ editor: "auto" })).editorEndpoint).toBe(
      "__open-in-editor",
    );
  });

  it("switches to the plugin's own endpoint for a named editor", () => {
    for (const editor of ["cursor", "trae", "webstorm", "pi", "code"]) {
      expect(clientPayload(createPlugin({ editor })).editorEndpoint, editor).toBe(
        "__ttc/open-in-editor",
      );
    }
  });

  it("switches endpoint for object and function editors too", () => {
    expect(
      clientPayload(
        createPlugin({ editor: { command: "my-ide", args: ["--goto", "{file}"] } }),
      ).editorEndpoint,
    ).toBe("__ttc/open-in-editor");
    expect(
      clientPayload(createPlugin({ editor: () => undefined })).editorEndpoint,
    ).toBe("__ttc/open-in-editor");
  });

  it("lets an explicit editorEndpoint win over the editor default", () => {
    expect(
      clientPayload(
        createPlugin({ editor: "cursor", editorEndpoint: "/custom-open" }),
      ).editorEndpoint,
    ).toBe("custom-open");
  });

  it("registers the editor middleware by default and a containment check for editor: 'auto'", () => {
    const useCalls: unknown[] = [];
    const fakeServer = {
      middlewares: { use: (...args: unknown[]) => useCalls.push(args) },
      config: { logger: { info() {}, warn() {} }, root: ROOT },
    };
    const defaultPlugin = createPlugin() as TestPlugin & {
      configureServer?: (server: unknown) => void;
    };
    defaultPlugin.configureServer?.(fakeServer);
    expect(useCalls, "default editor must be launched by the plugin").toHaveLength(1);

    const autoPlugin = createPlugin({ editor: "auto" }) as TestPlugin & {
      configureServer?: (server: unknown) => void;
    };
    autoPlugin.configureServer?.(fakeServer);
    // Auto mode registers one validating middleware that forwards in-root
    // requests to Vite's launch-editor endpoint.
    expect(
      useCalls,
      "editor: 'auto' must validate before delegating to Vite",
    ).toHaveLength(2);
  });

  it("does not leak editor state between instances", () => {
    expect(clientPayload(createPlugin({ editor: "cursor" })).editorEndpoint).toBe(
      "__ttc/open-in-editor",
    );
    expect(clientPayload(createPlugin({ editor: "auto" })).editorEndpoint).toBe(
      "__open-in-editor",
    );
    expect(clientPayload(createPlugin()).editorEndpoint).toBe(
      "__ttc/open-in-editor",
    );
  });
});

describe("overlay option", () => {
  it("injects the client import into every client module by default", () => {
    const plugin = createPlugin();
    const result = transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx`);
    expect(result?.code).toContain("virtual:tab-to-components/client");
  });

  it("keeps markers but skips the overlay when disabled", () => {
    const plugin = createPlugin({ overlay: false });
    const result = transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx`);
    expect(result?.code).toContain('data-ttc={"app/routes/home.tsx:1:24"}');
    expect(result?.code).not.toContain("virtual:tab-to-components/client");
  });

  it("only targets entry.client modules in entry mode", () => {
    const plugin = createPlugin({ overlay: "entry" });
    const route = transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx`);
    expect(route?.code).not.toContain("virtual:tab-to-components/client");
    const entry = transform(plugin, 'import "./root";\n', `${ROOT}/app/entry.client.tsx`);
    expect(entry?.code).toContain("virtual:tab-to-components/client");
  });
});

describe("include / exclude options", () => {
  it("only instruments matching paths", () => {
    const plugin = createPlugin({ include: [/^app\/routes\//] });
    expect(transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx`)).not.toBeNull();
    expect(
      transform(plugin, SOURCE, `${ROOT}/app/components/Button.tsx`),
    ).toBeNull();
  });

  it("skips excluded paths", () => {
    const plugin = createPlugin({ exclude: [/\.stories\.tsx$/] });
    expect(
      transform(plugin, SOURCE, `${ROOT}/app/Button.stories.tsx`),
    ).toBeNull();
  });
});

describe("environment handling", () => {
  it("annotates both environments by default", () => {
    const plugin = createPlugin();
    expect(
      transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx`, "client")?.code,
    ).toContain("data-ttc");
    expect(
      transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx`, "ssr")?.code,
    ).toContain("data-ttc");
  });

  it("injects the overlay only in the client environment", () => {
    const plugin = createPlugin();
    expect(
      transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx`, "ssr")?.code,
    ).not.toContain("virtual:tab-to-components/client");
  });

  it("treats unknown environments as non-client", () => {
    const plugin = createPlugin();
    expect(
      transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx`, "react-server")
        ?.code,
    ).not.toContain("virtual:tab-to-components/client");
  });

  it("skips everything outside the project root", () => {
    const plugin = createPlugin();
    expect(transform(plugin, SOURCE, "/@fs/D:/elsewhere/app.tsx")).toBeNull();
  });
});

describe("plugin instances and the React Router child compiler", () => {
  it("keeps option state per plugin instance", () => {
    const elementPlugin = createPlugin({ open: "element" });
    const componentPlugin = createPlugin({ open: "component" });
    expect(clientPayload(elementPlugin).open).toBe("element");
    expect(clientPayload(componentPlugin).open).toBe("component");
  });

  it("keeps the first resolved config (the real dev server)", () => {
    const plugin = tabToComponents() as unknown as TestPlugin;
    plugin.configResolved?.({
      root: ROOT,
      base: "/",
      command: "serve",
      logger: { info() {}, warn() {}, error() {} },
    } as never);
    // React Router creates a child Vite server that reuses user plugins; its
    // config resolution must not move the project root.
    plugin.configResolved?.({
      root: "D:/somewhere/else",
      base: "/child/",
      command: "serve",
      logger: { info() {}, warn() {}, error() {} },
    } as never);
    expect(clientPayload(plugin).root).toBe(ROOT);
    expect(clientPayload(plugin).base).toBe("/");
    const result = transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx`);
    expect(result?.code).toContain('data-ttc={"app/routes/home.tsx:1:24"}');
  });

  it("returns null from load for other ids", () => {
    const plugin = createPlugin();
    expect((plugin.load as AnyFn).call({}, "/some/other/module")).toBeNull();
  });
});

describe("filter and overlay combinations", () => {
  it("accepts a single RegExp for include and exclude", () => {
    const plugin = createPlugin({
      include: /^app\/routes\//,
      exclude: /\.stories\.tsx$/,
    });

    expect(
      transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx`),
    ).not.toBeNull();
    expect(
      transform(plugin, SOURCE, `${ROOT}/app/components/Button.tsx`),
    ).toBeNull();
    expect(
      transform(plugin, SOURCE, `${ROOT}/app/routes/Button.stories.tsx`),
    ).toBeNull();
    expect(
      transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx?raw`),
    ).toBeNull();
  });

  it("returns null when both markers and overlay are disabled", () => {
    const plugin = createPlugin({ ssr: false, overlay: false });

    expect(
      transform(plugin, SOURCE, `${ROOT}/app/routes/home.tsx`, "ssr"),
    ).toBeNull();
  });

  it("keeps client markers even with ssr and overlay disabled", () => {
    const plugin = createPlugin({ ssr: false, overlay: false });
    const client = transform(
      plugin,
      SOURCE,
      `${ROOT}/app/routes/home.tsx`,
      "client",
    );

    expect(client?.code).toContain("data-ttc");
    expect(client?.code).not.toContain(CLIENT_VIRTUAL_ID);
  });

  it.each([
    "entry.client.js",
    "entry.client.jsx",
    "entry.client.mjs",
    "entry.client.cjs",
    "entry.client.ts",
    "entry.client.tsx",
    "entry.client.mts",
    "entry.client.cts",
    "app/entry.client.tsx",
  ])("treats %s as a client entry in overlay: 'entry' mode", (file) => {
    const plugin = createPlugin({ overlay: "entry" });
    const result = transform(
      plugin,
      'export const value = 1;\n',
      `${ROOT}/${file}`,
      "client",
    );

    expect(result?.code).toContain(CLIENT_VIRTUAL_ID);
  });

  it("does not treat entry.server files as client entries", () => {
    const plugin = createPlugin({ overlay: "entry" });
    const result = transform(
      plugin,
      'export const value = 1;\n',
      `${ROOT}/app/entry.server.tsx`,
      "client",
    );

    expect(result?.code ?? "").not.toContain(CLIENT_VIRTUAL_ID);
  });
});

describe("resolved client config", () => {
  it("normalizes the root and base the browser runtime receives", () => {
    const plugin = tabToComponents() as unknown as TestPlugin;
    plugin.configResolved?.({
      root: `${ROOT}/`,
      base: "/app",
      command: "serve",
      logger: { info() {}, warn() {}, error() {} },
    } as never);

    const payload = clientPayload(plugin);
    expect(payload.root).toBe(ROOT);
    expect(payload.base).toBe("/app/");
  });

  it("normalizes a base that already has a trailing slash", () => {
    const plugin = tabToComponents() as unknown as TestPlugin;
    plugin.configResolved?.({
      root: ROOT,
      base: "/nested/app/",
      command: "serve",
      logger: { info() {}, warn() {}, error() {} },
    } as never);

    expect(clientPayload(plugin).base).toBe("/nested/app/");
  });

  it("does not read the client asset for unrelated modules", () => {
    const plugin = createPlugin();
    expect((plugin.load as AnyFn).call({}, CLIENT_RESOLVED_ID)).toBeTruthy();
    expect((plugin.load as AnyFn).call({}, "/src/App.tsx")).toBeNull();
  });
});

