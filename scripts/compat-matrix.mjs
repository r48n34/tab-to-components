#!/usr/bin/env node
// Framework / React compatibility matrix for `tab-to-components`.
//
// For every viable combination of React 18/19 and Vite / React Router v6/v7/v8
// / TanStack Start / Remix v2 this harness:
//   1. resolves the *installed* versions and proves each framework package
//      resolves the intended React copy (not a hoisted one from another major),
//   2. boots the fixture's own Vite dev server in-process and checks source
//      markers, the overlay import and the virtual client runtime,
//   3. checks SSR markup for framework-mode apps,
//   4. exercises the real-React fiber walk and Alt+click with happy-dom,
//   5. builds the fixture for production and scans the output for dev leakage,
//   6. optionally runs the existing headless-Chrome e2e runner.
//
// Cells that are impossible upstream (React Router v8 needs React >= 19.2.7,
// Remix v2 needs React ^18, Remix v1 has no Vite plugin) are reported as
// unsupported / not applicable instead of being silently skipped.
//
// Usage (from the repo root, after `pnpm build`):
//   node scripts/compat-matrix.mjs
//   node scripts/compat-matrix.mjs --browser --write-doc
//   node scripts/compat-matrix.mjs --no-build --only rr7-react18
// Must run before Vite is imported: it makes Vite's Windows `net use` probe
// fall back to a plain realpath in sandboxes that block child processes.
import "./sandbox-shim.mjs";

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const PACKAGE_DIR = path.join(ROOT, "packages", "tab-to-components");
const PACKAGE_JSON = path.join(PACKAGE_DIR, "package.json");
const TMP_DIR = path.join(PACKAGE_DIR, ".tmp");
const RESULTS_JSON = path.join(TMP_DIR, "compat-results.json");
const DOC_PATH = path.join(ROOT, "docs", "compatibility-matrix.md");
const CLIENT_ID = "/@id/__x00__virtual:tab-to-components/client";
const FORBIDDEN_BUILD_STRINGS = [
  "data-ttc",
  "virtual:tab-to-components/client",
  "__TTC_CONFIG__",
  "__TTC_READY__",
  "__TTC_INSTALLED__",
];

const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
const PACKAGE_VERSION = packageJson.version;
const ROOT_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const PNPM_VERSION =
  typeof ROOT_MANIFEST.packageManager === "string"
    ? ROOT_MANIFEST.packageManager.replace(/^pnpm@/, "")
    : "unknown";
const IS_RUNTIME_WORKER = !isMainThread && workerData?.runtimeWorker === true;

/** One cell of the matrix. `dir` is relative to the repo root. */
const MATRIX = [
  {
    id: "vite-react18",
    framework: "Vite + @vitejs/plugin-react",
    frameworkShort: "Vite",
    reactMajor: 18,
    dir: "compat/react18/apps/vite",
    pageModule: "/src/App.tsx",
    pageFile: "src/App.tsx",
    componentFile: "src/components/Button.tsx",
    ssr: false,
    build: "out-dir",
    expectedVersions: {
      react: "18.3.1",
      "react-dom": "18.3.1",
      vite: "8.3.5",
      "@vitejs/plugin-react": "6.1.2",
    },
    reactPeers: ["@vitejs/plugin-react"],
  },
  {
    id: "rr6-react18",
    framework: "React Router v6 (SPA)",
    frameworkShort: "React Router v6",
    reactMajor: 18,
    dir: "compat/react18-rr6",
    pageModule: "/src/App.tsx",
    pageFile: "src/App.tsx",
    componentFile: "src/components/Button.tsx",
    ssr: false,
    build: "out-dir",
    expectedVersions: {
      react: "18.3.1",
      "react-dom": "18.3.1",
      vite: "8.3.5",
      "@vitejs/plugin-react": "6.1.2",
      "react-router-dom": "6.30.6",
    },
    reactPeers: ["react-router-dom"],
    dependencyChecks: {
      "react-router-dom": { name: "react-router", version: "6.30.6" },
    },
  },
  {
    id: "rr7-react18",
    framework: "React Router v7 (framework, SSR)",
    frameworkShort: "React Router v7",
    reactMajor: 18,
    dir: "compat/react18/apps/rr7",
    pageModule: "/app/routes/home.tsx",
    pageFile: "app/routes/home.tsx",
    componentFile: "app/components/Button.tsx",
    ssr: true,
    probeNodeModules: false,
    build: "react-router",
    expectedVersions: {
      react: "18.3.1",
      "react-dom": "18.3.1",
      vite: "8.3.5",
      "react-router": "7.18.4",
      "@react-router/dev": "7.18.4",
    },
    reactPeers: ["react-router", "@react-router/dev"],
  },
  {
    id: "tanstack-start-react18",
    framework: "TanStack Start",
    frameworkShort: "TanStack Start",
    reactMajor: 18,
    dir: "compat/react18/apps/tanstack-start",
    pageModule: "/src/routes/index.tsx",
    pageModuleCandidates: [
      "/src/routes/index.tsx?tsr-split=component",
      "/src/routes/index.tsx",
    ],
    probeNodeModules: false,
    pageFile: "src/routes/index.tsx",
    componentFile: "src/components/Button.tsx",
    ssr: true,
    build: "tanstack-start",
    buildOutputs: [".output/public", "dist/client", "dist"],
    expectedVersions: {
      react: "18.3.1",
      "react-dom": "18.3.1",
      vite: "8.3.5",
      "@vitejs/plugin-react": "6.1.2",
      "@tanstack/react-start": "1.169.4",
      "@tanstack/react-router": "1.170.46",
    },
    reactPeers: ["@tanstack/react-start", "@tanstack/react-router"],
  },
  {
    id: "remix2-react18",
    framework: "Remix v2 (Vite 6, SSR)",
    frameworkShort: "Remix v2",
    reactMajor: 18,
    dir: "compat/remix2-react18",
    pageModule: "/app/routes/_index.tsx",
    pageFile: "app/routes/_index.tsx",
    componentFile: "app/components/Button.tsx",
    ssr: true,
    build: "remix",
    probeNodeModules: false,
    needsEsbuild: true,
    expectedVersions: {
      react: "18.3.1",
      "react-dom": "18.3.1",
      vite: "6.4.5",
      "@remix-run/dev": "2.17.5",
      "@remix-run/react": "2.17.5",
    },
    reactPeers: ["@remix-run/react", "@remix-run/dev"],
  },
  {
    id: "vite-react19",
    framework: "Vite + @vitejs/plugin-react",
    frameworkShort: "Vite",
    reactMajor: 19,
    dir: "playground/vite-react",
    pageModule: "/src/App.tsx",
    pageFile: "src/App.tsx",
    componentFile: "src/components/Button.tsx",
    ssr: false,
    build: "out-dir",
    expectedVersions: {
      react: "19.3.1",
      "react-dom": "19.3.1",
      vite: "8.3.5",
      "@vitejs/plugin-react": "6.1.2",
    },
    reactPeers: ["@vitejs/plugin-react"],
  },
  {
    id: "rr6-react19",
    framework: "React Router v6 (SPA)",
    frameworkShort: "React Router v6",
    reactMajor: 19,
    dir: "compat/react19-rr6",
    pageModule: "/src/App.tsx",
    pageFile: "src/App.tsx",
    componentFile: "src/components/Button.tsx",
    ssr: false,
    build: "out-dir",
    expectedVersions: {
      react: "19.3.1",
      "react-dom": "19.3.1",
      vite: "8.3.5",
      "@vitejs/plugin-react": "6.1.2",
      "react-router-dom": "6.30.6",
    },
    reactPeers: ["react-router-dom"],
    dependencyChecks: {
      "react-router-dom": { name: "react-router", version: "6.30.6" },
    },
  },
  {
    id: "rr7-react19",
    framework: "React Router v7 (framework, SSR)",
    frameworkShort: "React Router v7",
    reactMajor: 19,
    dir: "playground/rr7",
    pageModule: "/app/routes/home.tsx",
    pageFile: "app/routes/home.tsx",
    componentFile: "app/components/Button.tsx",
    ssr: true,
    probeNodeModules: false,
    build: "react-router",
    expectedVersions: {
      react: "19.3.1",
      "react-dom": "19.3.1",
      vite: "8.3.5",
      "react-router": "7.18.4",
      "@react-router/dev": "7.18.4",
    },
    reactPeers: ["react-router", "@react-router/dev"],
  },
  {
    id: "rr8-react19",
    framework: "React Router v8 (framework, SSR)",
    frameworkShort: "React Router v8",
    reactMajor: 19,
    dir: "playground/rr8",
    pageModule: "/app/routes/home.tsx",
    pageFile: "app/routes/home.tsx",
    componentFile: "app/components/Button.tsx",
    ssr: true,
    probeNodeModules: false,
    build: "react-router",
    expectedVersions: {
      react: "19.3.1",
      "react-dom": "19.3.1",
      vite: "8.3.5",
      "react-router": "8.5.0",
      "@react-router/dev": "8.5.0",
    },
    reactPeers: ["react-router", "@react-router/dev"],
  },
  {
    id: "tanstack-start-react19",
    framework: "TanStack Start",
    frameworkShort: "TanStack Start",
    reactMajor: 19,
    dir: "playground/compat-tanstack-start-react19",
    pageModule: "/src/routes/index.tsx",
    pageModuleCandidates: [
      "/src/routes/index.tsx?tsr-split=component",
      "/src/routes/index.tsx",
    ],
    probeNodeModules: false,
    pageFile: "src/routes/index.tsx",
    componentFile: "src/components/Button.tsx",
    ssr: true,
    build: "tanstack-start",
    buildOutputs: [".output/public", "dist/client", "dist"],
    expectedVersions: {
      react: "19.3.1",
      "react-dom": "19.3.1",
      vite: "8.3.5",
      "@vitejs/plugin-react": "6.1.2",
      "@tanstack/react-start": "1.169.4",
      "@tanstack/react-router": "1.170.46",
    },
    reactPeers: ["@tanstack/react-start", "@tanstack/react-router"],
  },
  {
    id: "rr8-react18",
    framework: "React Router v8 (framework, SSR)",
    frameworkShort: "React Router v8",
    reactMajor: 18,
    status: "unsupported",
    reason:
      "react-router@8.5.0 declares peer react >=19.2.7 (and react-dom >=19.2.7), so React 18 cannot be installed without forcing peers.",
    peer: "react >=19.2.7",
  },
  {
    id: "remix2-react19",
    framework: "Remix v2 (Vite 6, SSR)",
    frameworkShort: "Remix v2",
    reactMajor: 19,
    status: "unsupported",
    reason:
      "@remix-run/react@2.17.5 declares peer react ^18.0.0, so React 19 is outside its supported range.",
    peer: "react ^18.0.0",
  },
  {
    id: "remix1-react18",
    framework: "Remix v1 (classic compiler)",
    frameworkShort: "Remix v1",
    reactMajor: 18,
    status: "not-applicable",
    reason:
      "@remix-run/dev@1.19.1 has no Vite plugin (its classic esbuild compiler is not Vite), so a Vite plugin cannot run in a Remix v1 app.",
  },
  {
    id: "remix1-react19",
    framework: "Remix v1 (classic compiler)",
    frameworkShort: "Remix v1",
    reactMajor: 19,
    status: "not-applicable",
    reason:
      "@remix-run/dev@1.19.1 has no Vite plugin (its classic esbuild compiler is not Vite), so a Vite plugin cannot run in a Remix v1 app.",
  },
];

const FRAMEWORK_ROWS = [
  { key: "vite", label: "Vite + @vitejs/plugin-react (SPA)" },
  { key: "rr6", label: "React Router v6 (SPA)" },
  { key: "rr7", label: "React Router v7 (framework, SSR)" },
  { key: "rr8", label: "React Router v8 (framework, SSR)" },
  { key: "tanstack", label: "TanStack Start (SSR)" },
  { key: "remix1", label: "Remix v1 (classic compiler)" },
  { key: "remix2", label: "Remix v2 (Vite 6, SSR)" },
];

const STATUS = {
  pass: "pass",
  fail: "fail",
  skip: "skip",
  na: "n/a",
};

const SYMBOL = {
  works: "✅",
  "works-not-verified": "⚠️",
  failed: "❌",
  unsupported: "⛔",
  "not-applicable": "—",
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    browser: false,
    writeDoc: false,
    build: true,
    only: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--browser") options.browser = true;
    else if (arg === "--write-doc") options.writeDoc = true;
    else if (arg === "--no-build") options.build = false;
    else if (arg === "--only") {
      options.only = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/compat-matrix.mjs [--browser] [--write-doc] [--no-build] [--only <cell-id>]",
    "",
    "  --browser    also run the headless-Chrome Alt+click e2e for every cell",
    "  --write-doc  write docs/compatibility-matrix.md from this run",
    "  --no-build   skip production-build checks",
    "  --only <id>  run a single cell (repeatable via distinct invocations)",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function toPosix(value) {
  return String(value).replace(/\\/g, "/");
}

function requireFrom(fixtureDir) {
  return createRequire(path.join(fixtureDir, "package.json"));
}

function fixtureDir(cell) {
  return path.resolve(ROOT, cell.dir);
}

function findPackageJsonForEntry(entryPath, name) {
  let dir = path.dirname(entryPath);
  for (;;) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      const manifest = readJson(candidate);
      if (manifest.name === name) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolvePackage(fixtureDirPath, name) {
  const req = requireFrom(fixtureDirPath);
  let packageJsonPath;
  try {
    packageJsonPath = req.resolve(`${name}/package.json`);
  } catch {
    // Some packages (for example @vitejs/plugin-react 6) do not export
    // `./package.json`; resolve the entry point and walk up to its manifest.
    let entry;
    try {
      entry = req.resolve(name);
    } catch {
      return null;
    }
    packageJsonPath = findPackageJsonForEntry(entry, name);
    if (!packageJsonPath) return null;
  }
  const manifest = readJson(packageJsonPath);
  return { name, version: manifest.version, packageJsonPath, require: createRequire(packageJsonPath) };
}

function resolveReactVersion(fixtureDirPath, fromPackageJsonPath) {
  const req = createRequire(fromPackageJsonPath);
  return readJson(req.resolve("react/package.json")).version;
}

function majorOf(version) {
  return String(version).split(".")[0];
}

function expectedMarker(root, relativePath, jsxTag) {
  const lines = fs.readFileSync(path.join(root, relativePath), "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const column = (lines[index] ?? "").indexOf(jsxTag);
    if (column !== -1) return `${relativePath}:${index + 1}:${column + 1}`;
  }
  throw new Error(`could not find ${jsxTag} in ${relativePath}`);
}

function passed(detail) {
  return { status: STATUS.pass, detail };
}

function failed(detail) {
  return { status: STATUS.fail, detail };
}

function skipped(detail) {
  return { status: STATUS.skip, detail };
}

function notApplicable(detail = "") {
  return { status: STATUS.na, detail };
}

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchText(base, url) {
  const response = await fetch(new URL(url, base), {
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, text: await response.text() };
}

/**
 * Can this process spawn a child process with piped stdio? Vite 6/7 use
 * esbuild for TypeScript; sandboxes that deny spawn cannot run those fixtures.
 */
function canSpawnChildProcess() {
  try {
    const result = spawnSync(process.execPath, ["-e", "0"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      const code = String(result.error.code ?? "");
      return !(code === "EPERM" || code === "EACCES");
    }
    return true;
  } catch (error) {
    const code = String(error?.code ?? "");
    return !(code === "EPERM" || code === "EACCES");
  }
}

function canSpawnEsbuild(fixtureDirPath) {
  if (!canSpawnChildProcess()) return false;
  try {
    const req = requireFrom(fixtureDirPath);
    const esbuild = req("esbuild");
    esbuild.transformSync("const value: number = 1;", { loader: "ts" });
    esbuild.stop?.();
    return true;
  } catch {
    return false;
  }
}

async function closeServer(server, fixtureDirPath) {
  try {
    await Promise.race([
      server.close().catch(() => undefined),
      delay(8_000),
    ]);
  } catch {
    // The server may already be gone.
  }
  try {
    const req = requireFrom(fixtureDirPath);
    const esbuild = req("esbuild");
    esbuild.stop?.();
  } catch {
    // Vite 8 (rolldown) fixtures have no esbuild.
  }
}

async function loadVite(fixtureDirPath) {
  const req = requireFrom(fixtureDirPath);
  const viteEntry = req.resolve("vite");
  return await import(pathToFileURL(viteEntry).href);
}

function normalizeBase(base) {
  return base.endsWith("/") ? base : `${base}/`;
}

// ---------------------------------------------------------------------------
// Version + isolation checks
// ---------------------------------------------------------------------------

function checkVersions(cell) {
  const dir = fixtureDir(cell);
  const result = {
    versions: {},
    detail: [],
  };
  const problems = [];

  for (const [name, expected] of Object.entries(cell.expectedVersions)) {
    const resolved = resolvePackage(dir, name);
    if (!resolved) {
      problems.push(`${name}: not installed`);
      continue;
    }
    result.versions[name] = resolved.version;
    if (resolved.version !== expected) {
      problems.push(`${name}: expected ${expected}, installed ${resolved.version}`);
    }
  }

  const appReact = resolvePackage(dir, "react");
  if (appReact && majorOf(appReact.version) !== String(cell.reactMajor)) {
    problems.push(`react: expected major ${cell.reactMajor}, installed ${appReact.version}`);
  }

  for (const name of cell.reactPeers ?? []) {
    const resolved = resolvePackage(dir, name);
    if (!resolved) {
      problems.push(`${name}: not installed`);
      continue;
    }
    try {
      const reactVersion = resolveReactVersion(dir, resolved.packageJsonPath);
      if (majorOf(reactVersion) !== String(cell.reactMajor)) {
        problems.push(
          `${name} resolves react ${reactVersion} (expected major ${cell.reactMajor})`,
        );
      }
    } catch (error) {
      problems.push(`${name}: cannot resolve its react copy (${errorDetail(error)})`);
    }
  }

  for (const [owner, check] of Object.entries(cell.dependencyChecks ?? {})) {
    const ownerPackage = resolvePackage(dir, owner);
    if (!ownerPackage) {
      problems.push(`${owner}: not installed`);
      continue;
    }
    try {
      const dependencyVersion = readJson(
        ownerPackage.require.resolve(`${check.name}/package.json`),
      ).version;
      if (dependencyVersion !== check.version) {
        problems.push(
          `${owner} depends on ${check.name}@${dependencyVersion}, expected ${check.version}`,
        );
      }
    } catch (error) {
      problems.push(`${owner} -> ${check.name}: ${errorDetail(error)}`);
    }
  }

  let pluginVersion = null;
  try {
    pluginVersion = resolvePackage(dir, "tab-to-components")?.version ?? null;
    if (pluginVersion !== PACKAGE_VERSION) {
      problems.push(
        `tab-to-components: expected ${PACKAGE_VERSION}, installed ${pluginVersion}`,
      );
    }
  } catch {
    problems.push("tab-to-components: cannot resolve the plugin from the fixture");
  }

  result.pluginVersion = pluginVersion;
  result.ok = problems.length === 0;
  result.detail = problems.length > 0 ? problems.join("; ") : "exact versions resolve as pinned";
  return result;
}

// ---------------------------------------------------------------------------
// Dev-server checks
// ---------------------------------------------------------------------------

async function runDevChecks(cell) {
  const dir = fixtureDir(cell);
  const checks = {
    devServer: failed("not run"),
    markers: failed("not run"),
    overlayModule: failed("not run"),
    ssrMarkup: cell.ssr ? failed("not run") : notApplicable("SPA"),
    nodeModulesUntouched: notApplicable("not checked"),
  };

  const vite = await loadVite(dir);
  const server = await vite.createServer({
    root: dir,
    configFile: path.join(dir, "vite.config.ts"),
    logLevel: "error",
    server: { port: 0, strictPort: false, host: "127.0.0.1" },
  });

  try {
    await server.listen();
    const base = server.resolvedUrls?.local?.[0];
    if (!base) throw new Error("the dev server reported no local URL");
    const normalizedBase = normalizeBase(base);
    const rootPosix = toPosix(dir);

    const page = await fetchText(normalizedBase, "/");
    if (page.status !== 200) {
      checks.devServer = failed(`GET / returned HTTP ${page.status}`);
    } else if (cell.ssr) {
      checks.devServer = passed("SSR document served");
    } else if (page.text.includes('id="root"') || page.text.includes("id='root'")) {
      checks.devServer = passed("SPA shell served");
    } else {
      checks.devServer = failed('SPA shell has no #root mount point');
    }

    const pageMarker = expectedMarker(dir, cell.pageFile, "<Button");
    const candidates = cell.pageModuleCandidates ?? [cell.pageModule];
    const markerProblems = [];
    let matchedModule = candidates[0];
    let moduleMatched = false;
    for (const candidate of candidates) {
      const pageModule = await fetchText(normalizedBase, candidate);
      if (pageModule.status !== 200) {
        markerProblems.push(`${candidate} returned HTTP ${pageModule.status}`);
        continue;
      }
      const candidateProblems = [];
      if (!pageModule.text.includes(pageMarker)) {
        candidateProblems.push(`missing the <Button> marker ${pageMarker}`);
      }
      if (!pageModule.text.includes("data-ttc")) {
        candidateProblems.push("no data-ttc marker");
      }
      if (!pageModule.text.includes("data-ttc-name")) {
        candidateProblems.push("no data-ttc-name attribute");
      }
      if (!pageModule.text.includes("virtual:tab-to-components/client")) {
        candidateProblems.push("no overlay client import");
      }
      if (candidateProblems.length === 0) {
        moduleMatched = true;
        matchedModule = candidate;
        break;
      }
      markerProblems.push(`${candidate}: ${candidateProblems.join(", ")}`);
    }
    checks.markers = moduleMatched
      ? passed(`<Button> marker ${pageMarker} + overlay import present (${matchedModule})`)
      : failed(markerProblems.join("; "));

    const client = await fetchText(normalizedBase, CLIENT_ID);
    if (client.status !== 200) {
      checks.overlayModule = failed(`virtual client returned HTTP ${client.status}`);
    } else {
      const problems = [];
      for (const needle of ["__TTC_CONFIG__", "__TTC_READY__", "__ttc/open-in-editor", rootPosix]) {
        if (!client.text.includes(needle)) problems.push(`missing ${needle}`);
      }
      checks.overlayModule =
        problems.length === 0
          ? passed("config + bundled overlay runtime served")
          : failed(problems.join("; "));
    }

    if (cell.probeNodeModules === false) {
      checks.nodeModulesUntouched = notApplicable("framework router owns this URL space");
    } else {
      let nodeModules = null;
      try {
        nodeModules = await fetchText(normalizedBase, "/node_modules/react/index.js");
      } catch {
        nodeModules = null;
      }
      if (nodeModules && nodeModules.status === 200) {
        checks.nodeModulesUntouched = nodeModules.text.includes("data-ttc")
          ? failed("node_modules/react was instrumented")
          : passed("node_modules/react left untouched");
      } else {
        checks.nodeModulesUntouched = notApplicable("dependency module is not served as a file");
      }
    }

    if (cell.ssr) {
      const ssrProblems = [];
      if (!page.text.includes('data-ttc="')) {
        ssrProblems.push("SSR HTML has no data-ttc markers");
      }
      const mainMarker = expectedMarker(dir, cell.pageFile, "<main");
      const buttonMarker = expectedMarker(dir, cell.componentFile, "<button");
      if (!page.text.includes(`data-ttc="${mainMarker}"`)) {
        ssrProblems.push(`SSR HTML lacks the <main> marker ${mainMarker}`);
      }
      if (!page.text.includes(`data-ttc="${buttonMarker}"`)) {
        ssrProblems.push(`SSR HTML lacks the <button> marker ${buttonMarker}`);
      }
      checks.ssrMarkup =
        ssrProblems.length === 0
          ? passed(`<main> and <button> markers are server-rendered`)
          : failed(ssrProblems.join("; "));
    }
  } finally {
    await closeServer(server, dir);
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Production build checks
// ---------------------------------------------------------------------------

function collectBuildFiles(dir) {
  const files = [];
  const contents = [];
  if (!fs.existsSync(dir)) return { files, contents };
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else {
        files.push(path.relative(dir, absolute).replace(/\\/g, "/"));
        contents.push(fs.readFileSync(absolute, "utf8"));
      }
    }
  };
  walk(dir);
  return { files, contents };
}

function scanBuildOutput(dir) {
  const { files, contents } = collectBuildFiles(dir);
  const js = files.filter((file) => /\.(js|mjs|cjs|html)$/.test(file));
  if (js.length === 0) {
    throw new Error(`build output in ${toPosix(path.relative(ROOT, dir))} has no js/html files`);
  }
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!/\.(js|mjs|cjs|html)$/.test(file)) continue;
    const code = contents[index] ?? "";
    for (const forbidden of FORBIDDEN_BUILD_STRINGS) {
      if (code.includes(forbidden)) {
        throw new Error(
          `build output ${file} contains the dev-only string ${JSON.stringify(forbidden)}`,
        );
      }
    }
  }
  return js.length;
}

async function runBuildCheck(cell) {
  const dir = fixtureDir(cell);
  if (cell.needsEsbuild && !canSpawnEsbuild(dir)) {
    return skipped(
      "Vite 6 transforms TypeScript with esbuild, which this sandbox blocks (spawn EPERM); run with process access",
    );
  }

  const vite = await loadVite(dir);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    if (cell.build === "out-dir") {
      const outDir = path.join(TMP_DIR, "compat-build", cell.id);
      fs.rmSync(outDir, { recursive: true, force: true });
      await vite.build({
        root: dir,
        configFile: path.join(dir, "vite.config.ts"),
        logLevel: "error",
        build: { outDir, emptyOutDir: true },
      });
      const count = scanBuildOutput(outDir);
      return passed(`clean production build (${count} js/html files)`);
    }

    if (cell.build === "react-router" || cell.build === "remix") {
      const buildDir = path.join(dir, "build");
      fs.rmSync(buildDir, { recursive: true, force: true });
      await vite.build({
        root: dir,
        configFile: path.join(dir, "vite.config.ts"),
        logLevel: "error",
      });
      const clientDir = path.join(buildDir, "client");
      const count = scanBuildOutput(clientDir);
      return passed(`clean ${path.relative(dir, clientDir)} build (${count} js/html files)`);
    }

    if (cell.build === "tanstack-start") {
      for (const relative of cell.buildOutputs ?? []) {
        fs.rmSync(path.join(dir, relative), { recursive: true, force: true });
      }
      await vite.build({
        root: dir,
        configFile: path.join(dir, "vite.config.ts"),
        logLevel: "error",
      });
      const outputs = (cell.buildOutputs ?? []).filter((relative) =>
        fs.existsSync(path.join(dir, relative)),
      );
      if (outputs.length === 0) {
        return failed(
          `no TanStack Start build output found (looked for ${(cell.buildOutputs ?? []).join(", ")})`,
        );
      }
      let scanned = 0;
      for (const relative of outputs) {
        try {
          scanned += scanBuildOutput(path.join(dir, relative));
        } catch (error) {
          if (String(error.message).includes("has no js/html files")) continue;
          throw error;
        }
      }
      if (scanned === 0) {
        return failed(`TanStack Start build outputs contained no client js/html files`);
      }
      return passed(`clean ${outputs.join(", ")} build (${scanned} js/html files)`);
    }

    return skipped(`unknown build mode ${cell.build}`);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

// ---------------------------------------------------------------------------
// Real-React fiber/click check (happy-dom)
// ---------------------------------------------------------------------------

function unwrapModule(module) {
  return module && module.default !== undefined ? module.default : module;
}

async function waitForFetch(calls, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (calls.length > 0) return true;
    await delay(25);
  }
  return false;
}

async function runRuntimeChecks() {
  const results = {};
  let GlobalRegistrator;
  try {
    ({ GlobalRegistrator } = await import("@happy-dom/global-registrator"));
  } catch (error) {
    const detail = `@happy-dom/global-registrator is not installed (${errorDetail(error)}); run pnpm install`;
    results[18] = failed(detail);
    results[19] = failed(detail);
    return results;
  }

  const clientEntry = path.join(PACKAGE_DIR, "dist", "client.js");
  if (!fs.existsSync(clientEntry)) {
    const detail = "packages/tab-to-components/dist/client.js is missing; run pnpm build first";
    results[18] = failed(detail);
    results[19] = failed(detail);
    return results;
  }

  GlobalRegistrator.register({ url: "http://localhost/" });
  let client;
  try {
    client = await import(pathToFileURL(clientEntry).href);
  } catch (error) {
    GlobalRegistrator.unregister();
    const detail = `could not import the built client runtime: ${errorDetail(error)}`;
    results[18] = failed(detail);
    results[19] = failed(detail);
    return results;
  }

  const reactFixtures = {
    18: path.resolve(ROOT, "compat/react18/apps/vite"),
    19: path.resolve(ROOT, "playground/vite-react"),
  };

  try {
    for (const reactMajor of [18, 19]) {
      const dir = reactFixtures[reactMajor];
      const req = requireFrom(dir);
      const react = unwrapModule(await import(pathToFileURL(req.resolve("react")).href));
      const reactDom = unwrapModule(
        await import(pathToFileURL(req.resolve("react-dom")).href),
      );
      const reactDomClient = unwrapModule(
        await import(pathToFileURL(req.resolve("react-dom/client")).href),
      );

      const markerUsage = "src/App.tsx:20:9";
      const markerHost = "src/components/Button.tsx:6:10";
      const rootPath = toPosix(dir);

      function Button({ children, onClick }) {
        return react.createElement(
          "button",
          { type: "button", "data-ttc": markerHost, onClick },
          children,
        );
      }
      function App() {
        const [count, setCount] = react.useState(0);
        return react.createElement(
          "main",
          { "data-ttc": "src/App.tsx:10:5" },
          react.createElement(
            Button,
            {
              "data-ttc": markerUsage,
              "data-ttc-name": "Button",
              onClick: () => setCount((value) => value + 1),
            },
            `count is ${count}`,
          ),
        );
      }

      const container = document.createElement("div");
      document.body.append(container);
      const reactRoot = reactDomClient.createRoot(container);
      try {
        reactDom.flushSync(() => reactRoot.render(react.createElement(App)));
        await delay(0);

        const button = document.querySelector("button");
        if (!button) throw new Error("React rendered no <button>");

        const fiberKeys = Object.keys(button).filter(
          (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"),
        );
        if (fiberKeys.length === 0) {
          throw new Error("React did not attach a fiber to the rendered button");
        }

        const calls = [];
        const previousFetch = globalThis.fetch;
        globalThis.fetch = async (url) => {
          calls.push(String(url));
          return { ok: true, status: 200 };
        };
        globalThis.__TTC_CONFIG__ = {
          version: PACKAGE_VERSION,
          root: rootPath,
          base: "/",
          keyboard: ["alt"],
          open: "component",
          // This check isolates the fiber walk + editor click: a single action
          // skips the action picker and keeps the pre-picker behavior.
          clickActions: ["open"],
          menu: true,
          editorEndpoint: "__ttc/open-in-editor",
        };
        const cleanup = client.install();
        try {
          if (globalThis.__TTC_READY__ !== true) {
            throw new Error("install() did not set __TTC_READY__");
          }
          if (!document.querySelector("[data-ttc-ui]")) {
            throw new Error("install() did not create the overlay host");
          }
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Alt",
              altKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
          button.dispatchEvent(
            new MouseEvent("mousedown", {
              altKey: true,
              button: 0,
              bubbles: true,
              cancelable: true,
            }),
          );
          button.dispatchEvent(
            new MouseEvent("click", {
              altKey: true,
              button: 0,
              bubbles: true,
              cancelable: true,
            }),
          );
          const fetched = await waitForFetch(calls);
          if (!fetched) throw new Error("Alt+click did not call the editor endpoint");
          const opened = decodeURIComponent(calls[0]);
          if (!opened.includes(`${rootPath}/${markerUsage}`)) {
            throw new Error(
              `editor URL opened ${opened}; expected the <Button> usage marker ${markerUsage}`,
            );
          }
          if (button.textContent !== "count is 0") {
            throw new Error("Alt+click reached the app's own click handler");
          }
          results[reactMajor] = passed(
            `fiber walk found the <Button> usage and suppressed the app click`,
          );
        } finally {
          cleanup();
          globalThis.fetch = previousFetch;
          delete globalThis.__TTC_CONFIG__;
          delete globalThis.__TTC_READY__;
          delete globalThis.__TTC_INSTALLED__;
          delete globalThis.__TTC_VERSION__;
        }
      } finally {
        reactRoot.unmount();
        container.remove();
        document.body.innerHTML = "";
      }
    }
  } catch (error) {
    for (const reactMajor of [18, 19]) {
      if (!results[reactMajor]) results[reactMajor] = failed(errorDetail(error));
    }
  } finally {
    // Deliberately do not unregister: React's scheduler can still run an
    // immediate callback that reads `window.event`. This whole function only
    // runs in a short-lived worker thread, so the worker exit cleans it up.
  }

  return results;
}

/** Run the happy-dom/React check in an isolated worker so DOM globals never
 * shadow the Node globals the dev-server/build checks need. */
function runRuntimeChecksInWorker() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (results) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(results);
    };
    const timer = setTimeout(() => {
      finish({
        18: failed("runtime check timed out after 120s"),
        19: failed("runtime check timed out after 120s"),
      });
    }, 120_000);

    let worker;
    try {
      worker = new Worker(new URL(import.meta.url), {
        workerData: { runtimeWorker: true },
      });
    } catch (error) {
      finish({
        18: failed(`could not start the runtime worker: ${errorDetail(error)}`),
        19: failed(`could not start the runtime worker: ${errorDetail(error)}`),
      });
      return;
    }

    worker.on("message", (message) => {
      if (message?.ok && message.results) finish(message.results);
      else
        finish({
          18: failed(message?.error ?? "runtime worker failed"),
          19: failed(message?.error ?? "runtime worker failed"),
        });
    });
    worker.on("error", (error) => {
      finish({
        18: failed(`runtime worker crashed: ${errorDetail(error)}`),
        19: failed(`runtime worker crashed: ${errorDetail(error)}`),
      });
    });
    worker.on("exit", (code) => {
      if (!settled && code !== 0) {
        finish({
          18: failed(`runtime worker exited with code ${code}`),
          19: failed(`runtime worker exited with code ${code}`),
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Browser checks (reuse scripts/e2e.mjs)
// ---------------------------------------------------------------------------

async function runBrowserChecks(cells) {
  const outcomes = {};
  let e2e;
  try {
    e2e = await import(pathToFileURL(path.join(SCRIPT_DIR, "e2e.mjs")).href);
  } catch (error) {
    for (const cell of cells) outcomes[cell.id] = skipped(`could not import e2e runner: ${errorDetail(error)}`);
    return outcomes;
  }

  const chromePath =
    process.env.CHROME_PATH?.trim() ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  if (!fs.existsSync(chromePath)) {
    for (const cell of cells) {
      outcomes[cell.id] = skipped(`Chrome executable not found at ${chromePath}`);
    }
    return outcomes;
  }

  e2e.installFakeCodeBinary();
  for (const cell of cells) {
    const dir = fixtureDir(cell);
    try {
      const result = await e2e.runPlaygroundInBrowser({
        name: cell.id,
        description: `${cell.framework} / React ${cell.reactMajor}`,
        dir,
        pageFile: cell.pageFile,
        componentFile: cell.componentFile,
      });
      outcomes[cell.id] = result.passed
        ? passed("headless Chrome Alt+click opened the expected source location")
        : failed(result.error ?? "browser e2e failed");
    } catch (error) {
      if (error instanceof e2e.ChromeUnavailableError) {
        outcomes[cell.id] = skipped(`Chrome could not run here: ${errorDetail(error)}`);
      } else if (error instanceof e2e.HarnessError) {
        outcomes[cell.id] = skipped(errorDetail(error));
      } else {
        outcomes[cell.id] = failed(errorDetail(error));
      }
    }
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// Verdicts + reporting
// ---------------------------------------------------------------------------

function cellKey(cell) {
  return `${cell.frameworkShort}|${cell.reactMajor}`;
}

function computeVerdict(cell) {
  if (cell.status === "unsupported") return "unsupported";
  if (cell.status === "not-applicable") return "not-applicable";
  const checks = cell.checks ?? {};
  const failing = Object.entries(checks).filter(
    ([, value]) => value?.status === STATUS.fail,
  );
  if (failing.length > 0) return "failed";
  const core = ["versions", "devServer", "markers", "overlayModule"];
  const skippedCore = core.filter((key) => checks[key]?.status === STATUS.skip);
  if (skippedCore.length > 0) return "works-not-verified";
  return "works";
}

function formatCell(cell) {
  if (cell.status === "unsupported") return `${SYMBOL.unsupported} upstream`;
  if (cell.status === "not-applicable") return `${SYMBOL["not-applicable"]} N/A`;
  const verdict = cell.verdict;
  if (verdict === "failed") return `${SYMBOL.failed} fails`;
  if (verdict === "works-not-verified") return `${SYMBOL["works-not-verified"]} not verified here`;
  return `${SYMBOL.works} works`;
}

function statusText(check) {
  if (!check) return "—";
  if (check.status === STATUS.pass) return "✅";
  if (check.status === STATUS.fail) return "❌";
  if (check.status === STATUS.skip) return "⏭";
  return "—";
}

function cellNote(cell) {
  if (cell.status === "unsupported") return cell.reason;
  if (cell.status === "not-applicable") return cell.reason;
  const failing = Object.entries(cell.checks ?? {})
    .filter(([, value]) => value?.status === STATUS.fail)
    .map(([key, value]) => `${key}: ${value.detail}`);
  if (failing.length > 0) return failing.join(" | ");
  const skippedChecks = Object.entries(cell.checks ?? {})
    .filter(([, value]) => value?.status === STATUS.skip)
    .map(([key, value]) => `${key}: ${value.detail}`);
  if (skippedChecks.length > 0) return skippedChecks.join(" | ");
  return "";
}

function buildReport(cells, options) {
  const byShortAndReact = new Map();
  for (const cell of cells) {
    byShortAndReact.set(`${cell.frameworkShort}|${cell.reactMajor}`, cell);
  }

  const mainRows = FRAMEWORK_ROWS.map((row) => {
    const short = {
      vite: "Vite",
      rr6: "React Router v6",
      rr7: "React Router v7",
      rr8: "React Router v8",
      tanstack: "TanStack Start",
      remix1: "Remix v1",
      remix2: "Remix v2",
    }[row.key];
    const react18 = byShortAndReact.get(`${short}|18`);
    const react19 = byShortAndReact.get(`${short}|19`);
    return {
      label: row.label,
      react18: react18 ? formatCell(react18) : "—",
      react19: react19 ? formatCell(react19) : "—",
      react18Detail: react18 ? cellNote(react18) : "",
      react19Detail: react19 ? cellNote(react19) : "",
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    node: process.version,
    pnpm: PNPM_VERSION,
    platform: `${process.platform} ${process.arch}`,
    packageVersion: PACKAGE_VERSION,
    options,
    mainRows,
    cells: cells.map((cell) => ({
      id: cell.id,
      framework: cell.framework,
      frameworkShort: cell.frameworkShort,
      reactMajor: cell.reactMajor,
      dir: cell.dir ?? null,
      status: cell.status ?? "tested",
      reason: cell.reason ?? null,
      peer: cell.peer ?? null,
      versions: cell.versions ?? {},
      checks: cell.checks ?? {},
      verdict: cell.verdict,
    })),
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# tab-to-components compatibility matrix");
  lines.push("");
  lines.push(
    `Generated from a real run of \`node scripts/compat-matrix.mjs\` on ${report.generatedAt.slice(0, 10)}.`,
  );
  lines.push("");
  lines.push(
    `Environment: Node ${report.node}, pnpm ${report.pnpm}, ${report.platform}, package \`tab-to-components@${report.packageVersion}\`.`,
  );
  lines.push("");
  lines.push("## Matrix");
  lines.push("");
  lines.push("| Framework | React 18.3.1 | React 19.3.1 |");
  lines.push("| --- | --- | --- |");
  for (const row of report.mainRows) {
    lines.push(`| ${row.label} | ${row.react18} | ${row.react19} |`);
  }
  lines.push("");
  lines.push(
    "Legend: ✅ works (all applicable checks pass) · ⚠️ upstream-supported but not verified in this environment · ❌ tested and failing · ⛔ unsupported upstream · — not applicable.",
  );
  lines.push("");
  lines.push("## Details");
  lines.push("");
  lines.push(
    "| React | Framework | Resolved versions | Versions | Dev server | Markers | Overlay module | SSR markup | Runtime | Build | Browser | Verdict |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const cell of report.cells) {
    if (cell.status !== "tested") {
      const versions = cell.peer ? `peer ${cell.peer}` : "—";
      lines.push(
        `| ${cell.reactMajor} | ${cell.framework} | ${versions} | ${cell.reason ?? ""} | — | — | — | — | — | — | — | ${cell.verdict} |`,
      );
      continue;
    }
    const versions = Object.entries(cell.versions)
      .map(([name, version]) => `${name}@${version}`)
      .join("<br>");
    const checks = cell.checks ?? {};
    lines.push(
      `| ${cell.reactMajor} | ${cell.framework} | ${versions} | ${statusText(checks.versions)} | ${statusText(checks.devServer)} | ${statusText(checks.markers)} | ${statusText(checks.overlayModule)} | ${statusText(checks.ssrMarkup)} | ${statusText(checks.runtime)} | ${statusText(checks.build)} | ${statusText(checks.browser)} | ${cell.verdict} |`,
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- **React Router v8 + React 18 is blocked upstream**: `react-router@8.5.0` declares `peer react >=19.2.7`.",
  );
  lines.push(
    "- **Remix v2 + React 19 is blocked upstream**: `@remix-run/react@2.17.5` declares `peer react ^18.0.0`. Remix v2 also supports only Vite 5/6, so it is tested on Vite 6.4.5.",
  );
  lines.push(
    "- **Remix v1 has no Vite integration** (`@remix-run/dev@1.19.1` uses its classic esbuild compiler), so this Vite plugin cannot run there.",
  );
  lines.push(
    "- **TanStack** is tested as TanStack Start (the Vite-based SSR framework); TanStack Router in SPA mode follows the same plain-Vite path as the Vite row.",
  );
  lines.push(
    '- "Works" means the pinned combination passed the version/isolation checks, dev-server marker + overlay injection checks, any applicable SSR-markup check, the real-React fiber/Alt+click check, and the production-build cleanliness check. The browser column is only filled when the run includes `--browser`.',
  );
  lines.push(
    "- Vite 7 is covered separately by `pnpm test:matrix` (React 19 only); this table pins Vite 8 for the Vite/React Router/TanStack rows and Vite 6 for Remix v2, matching each framework's current supported range.",
  );
  if (report.options?.browser) {
    lines.push(
      "- This run included the headless-Chrome tier: for every tested cell, Alt+click opened the expected `<Button>` usage site and the app's own click handler did not run.",
    );
  }
  lines.push("");
  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("pnpm install");
  lines.push("pnpm install:compat");
  lines.push("pnpm build");
  lines.push("pnpm test:compat              # dev-server + build matrix");
  lines.push("pnpm test:compat:full         # + headless Chrome; writes this file");
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function printSummary(report) {
  console.log("\nCompatibility matrix");
  console.log("====================");
  console.log(`package: ${report.packageVersion}   node: ${report.node}   ${report.platform}`);
  console.log("");
  const header = ["Framework".padEnd(38), "React 18".padEnd(22), "React 19".padEnd(22)];
  console.log(header.join(" "));
  console.log("-".repeat(86));
  for (const row of report.mainRows) {
    console.log(
      `${row.label.padEnd(38)} ${row.react18.padEnd(22)} ${row.react19.padEnd(22)}`,
    );
  }
  console.log("");

  const tested = report.cells.filter((cell) => cell.status === "tested");
  const failing = tested.filter((cell) => cell.verdict === "failed");
  const unverified = tested.filter((cell) => cell.verdict === "works-not-verified");
  const works = tested.filter((cell) => cell.verdict === "works");
  console.log(
    `tested: ${tested.length}   works: ${works.length}   not verified here: ${unverified.length}   failing: ${failing.length}`,
  );
  for (const cell of unverified) {
    console.log(`  ⚠️  ${cell.id}: ${cellNote(cell)}`);
  }
  for (const cell of failing) {
    console.log(`  ❌ ${cell.id}: ${cellNote(cell)}`);
  }
  const skippedBrowser = tested.filter((cell) => cell.checks?.browser?.status === STATUS.skip);
  if (skippedBrowser.length > 0) {
    console.log(
      `  ⏭ browser: not run for ${skippedBrowser.length} cell(s) (${skippedBrowser[0].checks.browser.detail})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }

  if (!fs.existsSync(path.join(PACKAGE_DIR, "dist", "index.js"))) {
    console.error("compat-matrix: packages/tab-to-components/dist is missing. Run `pnpm build` first.");
    return 2;
  }

  const selected = options.only
    ? MATRIX.filter((cell) => cell.id === options.only)
    : MATRIX;
  if (selected.length === 0) {
    console.error(`compat-matrix: no matrix cell matches --only ${options.only}`);
    return 2;
  }

  const runtimeResults = await runRuntimeChecksInWorker();
  const testedCells = selected.filter((cell) => !cell.status);
  const hasEsbuild = testedCells.some((cell) => cell.needsEsbuild);
  const esbuildAvailable = hasEsbuild ? canSpawnEsbuild(fixtureDir(testedCells.find((cell) => cell.needsEsbuild))) : true;

  const cells = [];
  for (const definition of selected) {
    const cell = { ...definition };
    if (cell.status) {
      cell.verdict = cell.status;
      cells.push(cell);
      continue;
    }

    console.log(`\n=== ${cell.id} — ${cell.framework} / React ${cell.reactMajor} ===`);
    const versions = checkVersions(cell);
    cell.versions = versions.versions;
    cell.checks = {
      versions: versions.ok ? passed(versions.detail) : failed(versions.detail),
    };
    if (cell.status === undefined && cell.needsEsbuild && !esbuildAvailable) {
      const reason =
        "Vite 6 transforms TypeScript with esbuild, which this sandbox blocks (spawn EPERM); run with process access";
      cell.checks.devServer = skipped(reason);
      cell.checks.markers = skipped(reason);
      cell.checks.overlayModule = skipped(reason);
      cell.checks.ssrMarkup = skipped(reason);
      cell.checks.nodeModulesUntouched = skipped(reason);
      cell.checks.build = skipped(reason);
      cell.checks.browser = skipped(reason);
      cell.checks.runtime = runtimeResults[cell.reactMajor] ?? skipped("runtime check did not run");
      cell.environmentSkipped = true;
      console.log(`  version checks: ${versions.ok ? "ok" : versions.detail}`);
      console.log("  dev server: skipped (esbuild cannot spawn in this environment)");
      cell.verdict = computeVerdict(cell);
      cells.push(cell);
      continue;
    }

    try {
      const dev = await runDevChecks(cell);
      Object.assign(cell.checks, dev);
    } catch (error) {
      const detail = errorDetail(error);
      cell.checks.devServer = failed(detail);
      cell.checks.markers = failed("dev server did not start");
      cell.checks.overlayModule = failed("dev server did not start");
      if (cell.ssr) cell.checks.ssrMarkup = failed("dev server did not start");
    }

    if (options.build) {
      try {
        cell.checks.build = await runBuildCheck(cell);
      } catch (error) {
        cell.checks.build = failed(errorDetail(error));
      }
    } else {
      cell.checks.build = skipped("--no-build");
    }

    cell.checks.runtime = runtimeResults[cell.reactMajor] ?? skipped("runtime check did not run");
    if (cell.checks.browser === undefined) {
      cell.checks.browser = skipped(
        options.browser
          ? "browser tier runs after the server/build checks"
          : "run pnpm test:compat:full for the Chrome tier",
      );
    }
    cell.verdict = computeVerdict(cell);
    console.log(
      `  result: ${cell.verdict}${cellNote(cell) ? ` — ${cellNote(cell)}` : ""}`,
    );
    cells.push(cell);
  }

  if (options.browser) {
    const browserTargets = cells.filter(
      (cell) =>
        !cell.status &&
        cell.checks?.devServer?.status !== STATUS.skip &&
        cell.checks?.browser?.status === STATUS.skip,
    );
    if (browserTargets.length > 0) {
      console.log(`\nRunning headless-Chrome e2e for ${browserTargets.length} cell(s)…`);
      const outcomes = await runBrowserChecks(browserTargets);
      for (const cell of browserTargets) {
        const outcome = outcomes[cell.id] ?? skipped("browser tier did not run");
        cell.checks.browser = outcome;
        cell.verdict = computeVerdict(cell);
      }
    }
  }

  const report = buildReport(cells, options);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  printSummary(report);
  console.log(`\nJSON report: ${toPosix(path.relative(ROOT, RESULTS_JSON))}`);

  if (options.writeDoc) {
    fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
    fs.writeFileSync(DOC_PATH, renderMarkdown(report), "utf8");
    console.log(`Doc:         ${toPosix(path.relative(ROOT, DOC_PATH))}`);
  }

  const failing = cells.filter((cell) => cell.verdict === "failed");
  if (failing.length > 0) {
    console.error(`\n${failing.length} compatibility cell(s) failed.`);
    return 1;
  }
  return 0;
}

if (IS_RUNTIME_WORKER) {
  runRuntimeChecks()
    .then((results) => {
      parentPort.postMessage({ ok: true, results });
    })
    .catch((error) => {
      parentPort.postMessage({ ok: false, error: errorDetail(error) });
    })
    .finally(() => {
      // The worker's only job is done; do not let React scheduler timers keep
      // the thread alive.
      setTimeout(() => process.exit(0), 25);
    });
} else if (isMainThread) {
  main()
    .then((code) => {
      process.exitCode = code;
      // Vite 6 (Remix) keeps an esbuild service child alive; exit explicitly so
      // the matrix command always terminates after writing its reports.
      setTimeout(() => process.exit(code), 100);
    })
    .catch((error) => {
      console.error(`\ncompat-matrix harness error: ${errorDetail(error)}`);
      if (error?.stack) console.error(error.stack);
      setTimeout(() => process.exit(2), 100);
    });
}
