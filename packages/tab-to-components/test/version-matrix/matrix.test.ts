import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expectNoBuildLeak,
  expectedMarker,
  packageDir,
  playgroundDir,
  type PlaygroundName,
} from "../integration/helpers.js";
import {
  ESBUILD_BLOCKED_MESSAGE,
  canSpawnEsbuild,
  fetchText,
  loadPlaygroundVite,
  startPlayground,
  type NodeRequireLike,
  type StartedApp,
} from "./helpers.js";

const CLIENT_ID = "/@id/__x00__virtual:tab-to-components/client";
const esbuildAvailable = canSpawnEsbuild();

/**
 * The two Vite 5 playgrounds: `vite-react-vite5` is React 19,
 * `vite-react-vite5-react18` is React 18. Both pin Vite 5.4.21 and
 * `@vitejs/plugin-react` 4.7.0 (plugin-react 5+ requires Vite 6+).
 */
const VITE5_PLAYGROUNDS = [
  { name: "vite-react-vite5", reactMajor: "19" },
  { name: "vite-react-vite5-react18", reactMajor: "18" },
] as const;

/** `major.minor.patch` → major as a string. */
function major(version: string): string {
  return version.split(".")[0] ?? "";
}

interface BuildOutput {
  files: string[];
  contents: string[];
}

function collectBuildOutput(dir: string): BuildOutput {
  const files: string[] = [];
  const contents: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (/\.(?:js|mjs|cjs|html)$/.test(entry.name)) {
        files.push(path.relative(dir, absolute).replace(/\\/g, "/"));
        contents.push(fs.readFileSync(absolute, "utf8"));
      }
    }
  };
  walk(dir);
  return { files, contents };
}

/**
 * Read the `version` field of a package resolved from the playground. Package
 * entry points are walked up to the nearest `package.json`, so packages that do
 * not export `./package.json` (for example `@vitejs/plugin-react`) work too.
 */
function readPackageVersion(
  nodeRequire: NodeRequireLike,
  id: string,
): string {
  let dir = path.dirname(nodeRequire.resolve(id));
  for (;;) {
    const manifestPath = path.join(dir, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, "utf8"),
      ) as { version?: string };
      if (typeof manifest.version === "string") return manifest.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`could not find a package.json for ${id} above ${dir}`);
    }
    dir = parent;
  }
}

/**
 * Build a playground with its own Vite and return the JS/HTML output (markers
 * must not survive into a production build).
 */
async function buildPlayground(
  name: PlaygroundName,
  outDir: string,
): Promise<BuildOutput> {
  const DIR = playgroundDir(name);
  const { vite } = await loadPlaygroundVite(DIR);
  fs.rmSync(outDir, { recursive: true, force: true });

  // esbuild writes its service temp files to the OS temp directory and deletes
  // them afterwards. Some locked-down Windows environments deny that delete;
  // pointing TEMP at the workspace keeps the build hermetic.
  const previousTemp = process.env.TEMP;
  const previousTmp = process.env.TMP;
  const esbuildTemp = path.join(packageDir, ".tmp", "esbuild-temp");
  fs.mkdirSync(esbuildTemp, { recursive: true });
  process.env.TEMP = esbuildTemp;
  process.env.TMP = esbuildTemp;
  try {
    await vite.build({
      root: DIR,
      configFile: path.join(DIR, "vite.config.ts"),
      logLevel: "error",
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    if (previousTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = previousTemp;
    if (previousTmp === undefined) delete process.env.TMP;
    else process.env.TMP = previousTmp;
  }

  const output = collectBuildOutput(outDir);
  expect(output.files.length).toBeGreaterThan(0);
  return output;
}

describe("package metadata and the Vite version matrix", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
  ) as {
    description?: string;
    peerDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    exports?: Record<string, unknown>;
    files?: string[];
  };

  it("supports Vite 5, Vite 7 and Vite 8 in peerDependencies", () => {
    const peer = manifest.peerDependencies?.vite ?? "";
    expect(peer).toContain("^5.0.0");
    expect(peer).toContain("^6.0.0");
    expect(peer).toContain("^7.0.0");
    expect(peer).toContain("^8.0.0");
  });

  it("describes Vite 5-8 support", () => {
    expect(manifest.description).toContain("Vite 5-8");
  });

  it("does not ship a hard runtime dependency on Vite", () => {
    expect(manifest.dependencies?.vite).toBeUndefined();
    for (const file of fs
      .readdirSync(path.join(packageDir, "dist"))
      .filter((name) => name.endsWith(".js"))) {
      const code = fs.readFileSync(path.join(packageDir, "dist", file), "utf8");
      expect(code, `${file} must not import vite`).not.toMatch(
        /from\s*["']vite["']/,
      );
      expect(code, `${file} must not require vite`).not.toMatch(
        /require\(\s*["']vite["']\s*\)/,
      );
    }
  });

  it("is published as ESM with a types entry", () => {
    expect(manifest.exports?.["."]).toBeTruthy();
    expect(manifest.files).toContain("dist");
    const indexPath = path.join(packageDir, "dist", "index.js");
    expect(fs.existsSync(indexPath)).toBe(true);
    expect(fs.readFileSync(indexPath, "utf8")).toContain("tabToComponents");
  });

  it.each(["vite-react", "rr7", "rr8"] as const)(
    "%s playground resolves Vite 8",
    async (name) => {
      const { vite } = await loadPlaygroundVite(playgroundDir(name));
      expect(major(vite.version)).toBe("8");
    },
  );

  it.each(["vite-react-vite7", "rr7-vite7"] as const)(
    "%s playground resolves Vite 7",
    async (name) => {
      const { vite } = await loadPlaygroundVite(playgroundDir(name));
      expect(major(vite.version)).toBe("7");
    },
  );

  for (const playground of VITE5_PLAYGROUNDS) {
    it(`${playground.name} playground resolves Vite 5.4.21, React ${playground.reactMajor} and plugin-react 4.7.0`, async () => {
      const { vite, nodeRequire } = await loadPlaygroundVite(
        playgroundDir(playground.name),
      );
      expect(vite.version).toBe("5.4.21");
      expect(major(readPackageVersion(nodeRequire, "react/package.json"))).toBe(
        playground.reactMajor,
      );
      expect(
        readPackageVersion(nodeRequire, "@vitejs/plugin-react"),
      ).toBe("4.7.0");
    });
  }
});

describe.skipIf(!esbuildAvailable)("Vite 7: plain Vite + React", () => {
  const DIR = playgroundDir("vite-react-vite7");
  let app: StartedApp;

  beforeAll(async () => {
    app = await startPlayground(DIR);
  });

  afterAll(async () => {
    await app?.stop();
  });

  it("serves the app on Vite 7", async () => {
    expect(major(app.viteVersion)).toBe("7");
    const html = await fetchText(app.base, "/");
    expect(html).toContain('<div id="root">');
  });

  it("annotates app modules with source markers", async () => {
    const code = await fetchText(app.base, "/src/App.tsx");
    expect(code).toContain("data-ttc");
    expect(code).toContain(
      expectedMarker(DIR, "src/App.tsx", "<Button"),
    );
    expect(code).toContain('data-ttc-name');
  });

  it("injects the client runtime import", async () => {
    const code = await fetchText(app.base, "/src/App.tsx");
    expect(code).toContain("virtual:tab-to-components/client");
  });

  it("serves the client runtime with its config", async () => {
    const response = await fetch(new URL(CLIENT_ID, app.base));
    expect(response.status).toBe(200);
    const code = await response.text();
    expect(code).toContain("globalThis.__TTC_CONFIG__");
    expect(code).toContain(DIR.replace(/\\/g, "/"));
    expect(code).toContain("__TTC_READY__");
  });
});

for (const playground of VITE5_PLAYGROUNDS) {
  describe.skipIf(!esbuildAvailable)(
    `Vite 5: plain Vite + React ${playground.reactMajor} (${playground.name})`,
    () => {
      const DIR = playgroundDir(playground.name);
      let app: StartedApp;

      beforeAll(async () => {
        app = await startPlayground(DIR);
      });

      afterAll(async () => {
        await app?.stop();
      });

      it("serves the app on Vite 5", async () => {
        expect(app.viteVersion).toBe("5.4.21");
        const html = await fetchText(app.base, "/");
        expect(html).toContain('<div id="root">');
      });

      it("annotates app modules with source markers", async () => {
        const code = await fetchText(app.base, "/src/App.tsx");
        expect(code).toContain("data-ttc");
        expect(code).toContain(
          expectedMarker(DIR, "src/App.tsx", "<Button"),
        );
        expect(code).toContain("data-ttc-name");
      });

      it("injects the client runtime import", async () => {
        const code = await fetchText(app.base, "/src/App.tsx");
        expect(code).toContain("virtual:tab-to-components/client");
      });

      it("serves the client runtime with its config", async () => {
        const response = await fetch(new URL(CLIENT_ID, app.base));
        expect(response.status).toBe(200);
        const code = await response.text();
        expect(code).toContain("globalThis.__TTC_CONFIG__");
        expect(code).toContain(DIR.replace(/\\/g, "/"));
        expect(code).toContain('"open":"component"');
        expect(code).toContain(
          '"clickActions":["open","copy-file","copy-full-path"]',
        );
        expect(code).toContain('"editorEndpoint":"__ttc/open-in-editor"');
        expect(code).toContain("__TTC_READY__");
      });

      it("does not annotate node_modules", async () => {
        const response = await fetch(
          new URL("/node_modules/react/index.js", app.base),
        );
        const code = await response.text();
        expect(code).not.toContain("data-ttc=");
      });

      it("keeps the overlay import out of the SSR transform", async () => {
        // Vite 5 has no `this.environment`; it passes `{ ssr }` to the
        // transform hook, so the plugin must derive SSR from those options.
        // (Vite 8's type only declares `transformRequest(url)`, hence the cast.)
        const transformRequest = app.server.transformRequest as unknown as (
          url: string,
          options?: { ssr?: boolean },
        ) => Promise<{ code: string } | null>;
        const result = await transformRequest("/src/App.tsx", { ssr: true });
        expect(result).toBeTruthy();
        const code = result?.code ?? "";
        expect(code).toContain("data-ttc");
        expect(code).toContain(expectedMarker(DIR, "src/App.tsx", "<Button"));
        expect(code).not.toContain("virtual:tab-to-components/client");
      });
    },
  );
}

describe.skipIf(!esbuildAvailable)("Vite 7: production build", () => {
  it("contains no markers or dev runtime", async () => {
    const output = await buildPlayground(
      "vite-react-vite7",
      path.join(packageDir, ".tmp", "matrix-build-vite7"),
    );
    expectNoBuildLeak(output.files, output.contents);
  });
});

for (const playground of VITE5_PLAYGROUNDS) {
  describe.skipIf(!esbuildAvailable)(
    `Vite 5: production build (${playground.name})`,
    () => {
      it("contains no markers or dev runtime", async () => {
        const outDir = path.join(
          packageDir,
          ".tmp",
          `matrix-build-vite5-react${playground.reactMajor}`,
        );
        const output = await buildPlayground(playground.name, outDir);
        expectNoBuildLeak(output.files, output.contents);
      });
    },
  );
}

describe.skipIf(!esbuildAvailable)("Vite 7: React Router 7 framework mode (SSR)", () => {
  const DIR = playgroundDir("rr7-vite7");
  let app: StartedApp;

  beforeAll(async () => {
    app = await startPlayground(DIR);
  });

  afterAll(async () => {
    await app?.stop();
  });

  it("server-renders on Vite 7", async () => {
    expect(major(app.viteVersion)).toBe("7");
    const response = await fetch(app.base);
    expect(response.status).toBe(200);
  });

  it("SSR markup carries source markers", async () => {
    const html = await fetchText(app.base, "/");
    expect(html).toContain(
      `data-ttc="${expectedMarker(DIR, "app/routes/home.tsx", "<main")}"`,
    );
    expect(html).toContain(
      `data-ttc="${expectedMarker(DIR, "app/components/Button.tsx", "<button")}"`,
    );
  });

  it("annotates route modules and injects the client runtime", async () => {
    const code = await fetchText(app.base, "/app/routes/home.tsx");
    expect(code).toContain('"data-ttc"');
    expect(code).toContain(
      `"data-ttc": "${expectedMarker(DIR, "app/routes/home.tsx", "<Button")}"`,
    );
    expect(code).toContain("virtual:tab-to-components/client");
  });

  it("serves the client runtime", async () => {
    const response = await fetch(new URL(CLIENT_ID, app.base));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("__TTC_READY__");
  });
});

/**
 * Start a playground with `tabToComponents()` listed before the React plugin
 * and fetch a raw-JSX module: the marker must have been inserted as a JSX
 * attribute before the React plugin compiled the module.
 */
async function expectRawJsxOrdering(name: PlaygroundName): Promise<void> {
  const DIR = playgroundDir(name);
  const { vite, nodeRequire } = await loadPlaygroundVite(DIR);
  const reactModule = (await import(
    pathToFileURL(nodeRequire.resolve("@vitejs/plugin-react")).href
  )) as { default?: () => unknown } & (() => unknown);
  const reactPlugin = reactModule.default ?? reactModule;
  const { tabToComponents } = await import("../../src/index.js");

  const server = await vite.createServer({
    root: DIR,
    configFile: false,
    logLevel: "error",
    plugins: [tabToComponents(), reactPlugin()] as never,
    server: { port: 0, strictPort: false, host: "127.0.0.1" },
  });
  try {
    await server.listen();
    const base = server.resolvedUrls?.local?.[0] as string;
    const code = await fetchText(base, "/src/App.tsx");
    expect(code).toContain("data-ttc");
    expect(code).toContain(expectedMarker(DIR, "src/App.tsx", "<Button"));
  } finally {
    await Promise.race([
      server.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    try {
      (nodeRequire("esbuild") as { stop?: () => void }).stop?.();
    } catch {
      // esbuild service already gone
    }
  }
}

describe.skipIf(!esbuildAvailable)("Vite 7: plugin ordering", () => {
  it("annotates raw JSX when tabToComponents() is listed before the React plugin", async () => {
    await expectRawJsxOrdering("vite-react-vite7");
  });
});

for (const playground of VITE5_PLAYGROUNDS) {
  describe.skipIf(!esbuildAvailable)(
    `Vite 5: plugin ordering (${playground.name})`,
    () => {
      it("annotates raw JSX when tabToComponents() is listed before the React plugin", async () => {
        await expectRawJsxOrdering(playground.name);
      });
    },
  );
}

/**
 * Unguarded on purpose: every other tier needs esbuild to transform TSX, but
 * the virtual client module and the editor middleware are pure Vite interop and
 * must be proven against a real Vite 5 server even in this sandbox. The React
 * plugin is intentionally left out, and esbuild/optimizeDeps are disabled so no
 * child process is spawned.
 */
describe("Vite 5: editor middleware and virtual client without esbuild", () => {
  it("serves the virtual client and rejects cross-origin and out-of-root editor requests", async () => {
    const DIR = playgroundDir("vite-react-vite5");
    const { vite } = await loadPlaygroundVite(DIR);
    expect(vite.version).toBe("5.4.21");
    const { tabToComponents } = await import("../../src/index.js");

    const server = await vite.createServer({
      root: DIR,
      configFile: false,
      logLevel: "error",
      esbuild: false,
      optimizeDeps: { disabled: true },
      plugins: [tabToComponents({ log: false })] as never,
      server: { port: 0, strictPort: false, host: "127.0.0.1" },
    });
    try {
      await server.listen();
      const base = server.resolvedUrls?.local?.[0];
      expect(base).toBeTruthy();
      const baseUrl = base as string;

      const clientResponse = await fetch(new URL(CLIENT_ID, baseUrl));
      expect(clientResponse.status).toBe(200);
      const clientCode = await clientResponse.text();
      expect(clientCode).toContain("globalThis.__TTC_CONFIG__");
      expect(clientCode).toContain("__TTC_READY__");
      expect(clientCode).toContain(DIR.replace(/\\/g, "/"));

      const crossOrigin = await fetch(
        new URL("/__ttc/open-in-editor?file=src%2FApp.tsx", baseUrl),
        {
          headers: {
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
          },
        },
      );
      expect(crossOrigin.status).toBe(403);

      const traversal = await fetch(
        new URL(
          "/__ttc/open-in-editor?file=..%2F..%2FWindows%2Fwin.ini",
          baseUrl,
        ),
      );
      expect(traversal.status).toBe(400);
      expect(await traversal.text()).toContain("invalid `file`");
    } finally {
      await server.close();
    }
  });
});

if (!esbuildAvailable) {
  // Make the reason visible in the reporter instead of a silent skip.
  console.warn(
    `\n[version-matrix] skipped Vite 5 and Vite 7 dev-server, SSR, build and plugin-ordering tests. ${ESBUILD_BLOCKED_MESSAGE}\n`,
  );
}
