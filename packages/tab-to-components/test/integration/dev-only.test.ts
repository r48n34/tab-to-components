import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Plugin } from "vite";
import { tabToComponents } from "../../src/index.js";
import { CLIENT_VIRTUAL_ID } from "../../src/virtual.js";
import { expectNoBuildLeak, packageDir } from "./helpers.js";

const WORK_DIR = path.join(packageDir, ".tmp", "dev-only-build");

const APP_SOURCE = `
export function App() {
  return (
    <main>
      <button type="button">hello</button>
    </main>
  );
}
console.log("app-ready");
`;

const VIRTUAL_IMPORT_SOURCE = `
import "${CLIENT_VIRTUAL_ID}";
export const value = 1;
`;

function writeApp(name: string, entrySource: string): string {
  const root = path.join(WORK_DIR, name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "index.html"),
    [
      "<!doctype html>",
      '<html lang="en">',
      "  <body>",
      '    <div id="root"></div>',
      '    <script type="module" src="/src/entry.jsx"></script>',
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(root, "src", "entry.jsx"), entrySource, "utf8");
  return root;
}

function collectOutput(dir: string): { files: string[]; contents: string[] } {
  const files: string[] = [];
  const contents: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else {
        files.push(path.relative(dir, absolute).replace(/\\/g, "/"));
        contents.push(fs.readFileSync(absolute, "utf8"));
      }
    }
  };
  walk(dir);
  return { files, contents };
}

/**
 * Simulate a wrapper that re-registers the plugin in a build without its
 * `apply: "serve"` gate. The plugin's own command guards must keep it inert.
 */
function forceIntoBuild(plugin: Plugin): Plugin {
  const copy = { ...plugin } as Plugin;
  delete (copy as { apply?: unknown }).apply;
  return copy;
}

async function buildApp(
  root: string,
  plugins: Plugin[],
  outDir = path.join(WORK_DIR, "dist"),
): Promise<void> {
  const { build } = await import("vite");
  const reactPlugin = (await import("@vitejs/plugin-react")).default;
  await build({
    root,
    configFile: false,
    logLevel: "error",
    plugins: [reactPlugin(), ...plugins],
    build: { outDir, emptyOutDir: true },
  });
}

afterAll(() => {
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
});

describe("production builds cannot use the dev-only package", () => {
  it("is filtered out by apply: 'serve' before any hook runs", async () => {
    const root = writeApp("filtered", APP_SOURCE);
    const plugin = tabToComponents({ log: false });
    // If Vite ever called the hook, this spy would make it return undefined.
    const transformSpy = vi.fn();
    (plugin as unknown as Record<string, unknown>).transform = transformSpy;

    await buildApp(root, [plugin]);

    const { files, contents } = collectOutput(path.join(WORK_DIR, "dist"));
    expect(files.some((file) => file.endsWith(".js"))).toBe(true);
    expect(transformSpy).not.toHaveBeenCalled();
    expectNoBuildLeak(files, contents);
  });

  it("stays inert even when a wrapper strips apply and forces it into a build", async () => {
    const root = writeApp("forced", APP_SOURCE);
    const forced = forceIntoBuild(tabToComponents({ log: false }));

    await buildApp(root, [forced]);

    const { files, contents } = collectOutput(path.join(WORK_DIR, "dist"));
    expect(files.some((file) => file.endsWith(".js"))).toBe(true);
    expectNoBuildLeak(files, contents);
  });

  it("cannot resolve the dev client virtual module from a production build", async () => {
    const root = writeApp("virtual-import", VIRTUAL_IMPORT_SOURCE);
    const forced = forceIntoBuild(tabToComponents({ log: false }));

    await expect(buildApp(root, [forced])).rejects.toThrow(
      /virtual:tab-to-components\/client|failed to resolve|not resolve/i,
    );
  });
});
