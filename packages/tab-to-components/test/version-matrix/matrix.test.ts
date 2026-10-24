import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expectNoBuildLeak,
  expectedMarker,
  packageDir,
  playgroundDir,
} from "../integration/helpers.js";
import {
  ESBUILD_BLOCKED_MESSAGE,
  canSpawnEsbuild,
  fetchText,
  loadPlaygroundVite,
  startPlayground,
  type StartedApp,
} from "./helpers.js";

const CLIENT_ID = "/@id/__x00__virtual:tab-to-components/client";
const esbuildAvailable = canSpawnEsbuild();

/** `major.minor.patch` → major as a string. */
function major(version: string): string {
  return version.split(".")[0] ?? "";
}

function collectJs(dir: string): { files: string[]; contents: string[] } {
  const files: string[] = [];
  const contents: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.endsWith(".js")) {
        files.push(path.relative(dir, absolute).replace(/\\/g, "/"));
        contents.push(fs.readFileSync(absolute, "utf8"));
      }
    }
  };
  walk(dir);
  return { files, contents };
}

describe("package metadata and the Vite version matrix", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
  ) as {
    peerDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    exports?: Record<string, unknown>;
    files?: string[];
  };

  it("supports Vite 7 and Vite 8 in peerDependencies", () => {
    const peer = manifest.peerDependencies?.vite ?? "";
    expect(peer).toContain("^7.0.0");
    expect(peer).toContain("^8.0.0");
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

describe.skipIf(!esbuildAvailable)("Vite 7: production build", () => {
  it("contains no markers or dev runtime", async () => {
    const DIR = playgroundDir("vite-react-vite7");
    const { vite } = await loadPlaygroundVite(DIR);
    const outDir = path.join(packageDir, ".tmp", "matrix-build-vite7");
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

    const { files, contents } = collectJs(outDir);
    expect(files.length).toBeGreaterThan(0);
    expectNoBuildLeak(files, contents);
  });
});

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

describe.skipIf(!esbuildAvailable)("Vite 7: plugin ordering", () => {
  it("annotates raw JSX when tabToComponents() is listed before the React plugin", async () => {
    const DIR = playgroundDir("vite-react-vite7");
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
      // Raw JSX path: the marker was inserted as a JSX attribute before the
      // React plugin compiled the module.
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
  });
});

if (!esbuildAvailable) {
  // Make the reason visible in the reporter instead of a silent skip.
  console.warn(`\n[version-matrix] skipped Vite 7 dev-server tests. ${ESBUILD_BLOCKED_MESSAGE}\n`);
}