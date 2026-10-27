// Publish-readiness check for the npm artifact.
//
// It answers "would `npm publish` produce a usable package?" without spawning
// child processes (some CI sandboxes block that):
//   1. validates the metadata npm requires (name, version, license, files, exports);
//   2. builds the exact file list `files` + npm always-included files produce,
//      rejecting source maps and oversized artifacts;
//   3. copies that list into a clean consumer project's node_modules;
//   4. imports the packed copy and checks the public API;
//   5. type-checks a consumer file against the packed .d.ts;
//   6. boots a Vite dev server with the *packed* copy and checks that markers,
//      the overlay import and the bundled client runtime all work;
//   7. proves the packed copy cannot leak into a production build, even when a
//      wrapper strips its `apply: "serve"` gate.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptsDir, "..");
const workspaceRoot = path.resolve(packageDir, "../..");
const playgroundDir = path.join(workspaceRoot, "playground", "vite-react");
const workDir = path.join(packageDir, ".tmp", "package-check");
const stagingDir = path.join(workDir, "staging", "package");
const consumerDir = path.join(workDir, "consumer");
const consumerPackageDir = path.join(
  consumerDir,
  "node_modules",
  "tab-to-components",
);

const failures = [];
let checks = 0;

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(absolute, base));
    else out.push(path.relative(base, absolute).replace(/\\/g, "/"));
  }
  return out;
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// ---------------------------------------------------------------------------
// 1. Metadata
// ---------------------------------------------------------------------------
console.log("\n[1/7] package metadata");
const manifestPath = path.join(packageDir, "package.json");
const manifest = readJson(manifestPath);

check("name is a valid unscoped npm name", /^[a-z0-9][a-z0-9._-]*$/.test(manifest.name ?? ""), manifest.name);
check("name is not private", manifest.private !== true);
check("version is valid semver", /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version ?? ""), manifest.version);
check("description is present", typeof manifest.description === "string" && manifest.description.length > 20);
check("license is present", Boolean(manifest.license));
check("type is module", manifest.type === "module");
check("engines.node is set", Boolean(manifest.engines?.node));
check("peerDependencies.vite is set", Boolean(manifest.peerDependencies?.vite), manifest.peerDependencies?.vite);
check("files includes dist", Array.isArray(manifest.files) && manifest.files.includes("dist"));
check("publishConfig.access is public", manifest.publishConfig?.access === "public");

// The browser runtime ships inside dist/ because the dev server serves it, but
// application code must not be able to import it as a package entry.
const exportKeys = Object.keys(manifest.exports ?? {});
check(
  "does not export the browser runtime as a subpath",
  !exportKeys.includes("./dist/client.js") && !exportKeys.includes("./client"),
  exportKeys.join(", "),
);

const requiredFiles = ["README.md", "LICENSE", "CHANGELOG.md"];
for (const file of requiredFiles) {
  check(`${file} exists in the package`, fs.existsSync(path.join(packageDir, file)));
}

const distFiles = fs.existsSync(path.join(packageDir, "dist"))
  ? walkFiles(path.join(packageDir, "dist"))
  : [];
check("dist/ is built", distFiles.length > 0, "run `pnpm build` first");
for (const file of ["index.js", "index.d.ts", "client.js"]) {
  check(`dist/${file} exists`, distFiles.includes(file));
}

const exportTargets = [];
const dotExport = manifest.exports?.["."];
if (dotExport && typeof dotExport === "object") {
  for (const value of Object.values(dotExport)) {
    if (typeof value === "string") exportTargets.push(value);
  }
}
check("exports '.' declares types + runtime", exportTargets.length >= 2, JSON.stringify(dotExport));
for (const target of exportTargets) {
  check(`exports target ${target} exists`, fs.existsSync(path.join(packageDir, target)));
}
for (const field of ["main", "types"]) {
  check(`${field} exists`, typeof manifest[field] === "string" && fs.existsSync(path.join(packageDir, manifest[field])), manifest[field]);
}

// Runtime imports must all be declared.
const declared = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
]);
const builtin = new Set(["node:fs", "node:path", "node:url", "node:module"]);
const runtimeImports = new Set();
for (const file of distFiles.filter((name) => name.endsWith(".js"))) {
  const code = fs.readFileSync(path.join(packageDir, "dist", file), "utf8");
  for (const match of code.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier || specifier.startsWith(".") || specifier.startsWith("node:") || builtin.has(specifier)) continue;
    runtimeImports.add(specifier);
  }
}
for (const specifier of runtimeImports) {
  const bare = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  check(`runtime import "${bare}" is declared`, declared.has(bare));
}
check("vite is not a hard runtime dependency", !(manifest.dependencies ?? {}).vite);

// ---------------------------------------------------------------------------
// 2. Build the file list npm would publish
// ---------------------------------------------------------------------------
console.log("\n[2/7] npm file list");
function npmFileList() {
  const files = new Set();
  for (const entry of manifest.files ?? []) {
    const absolute = path.join(packageDir, entry);
    if (!fs.existsSync(absolute)) continue;
    if (fs.statSync(absolute).isDirectory()) {
      for (const file of walkFiles(absolute)) files.add(path.posix.join(entry, file));
    } else {
      files.add(entry);
    }
  }
  for (const always of ["package.json", "README.md", "LICENSE", "CHANGELOG.md"]) {
    if (fs.existsSync(path.join(packageDir, always))) files.add(always);
  }
  return [...files].sort();
}
const publishedFiles = npmFileList();
const publishedBytes = publishedFiles.reduce(
  (sum, file) => sum + fs.statSync(path.join(packageDir, file)).size,
  0,
);
const publishedMaps = publishedFiles.filter((file) => file.endsWith(".map"));
const clientBytes = fs.existsSync(path.join(packageDir, "dist", "client.js"))
  ? fs.statSync(path.join(packageDir, "dist", "client.js")).size
  : 0;
check("published set is small (no sources/tests/maps)", publishedFiles.length < 32, `${publishedFiles.length} files`);
check("publishes no source maps", publishedMaps.length === 0, publishedMaps.join(", "));
// The unpacked payload is compiled output plus docs. Keep it comfortably small;
// changelog/README growth must not silently balloon the published artifact. The
// 0.4 source actions and the theme palette brought it to ~116 KiB; 0.4.1 added
// the hardened launcher and endpoint checks (~135 KiB); 0.5.0 adds the overlay
// icons and the expanded docs (~150 KiB); the per-IDE click actions, their icons
// and the matching docs take it to ~164 KiB. The budget tracks the current
// release line rather than the original 112 KiB.
check("published payload is small", publishedBytes <= 168 * 1024, `${(publishedBytes / 1024).toFixed(1)} KiB`);
// The browser runtime is minified by scripts/build.mjs; keep it that way so the
// tarball does not silently double in size again. The 0.5.0 icons took it to
// ~24.1 KiB; the per-IDE click actions and their four icons take it to ~25.3 KiB.
check("client runtime is minified", clientBytes > 0 && clientBytes <= 26 * 1024, `${clientBytes} bytes`);
for (const leaked of ["src/index.ts", "test/plugin.test.ts", "scripts/build.mjs"]) {
  check(`does not publish ${leaked}`, !publishedFiles.includes(leaked));
}
for (const required of ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/client.js", "dist/index.d.ts"]) {
  check(`publishes ${required}`, publishedFiles.includes(required));
}
console.log(`    ${publishedFiles.length} files, ${(publishedBytes / 1024).toFixed(1)} KiB`);

// ---------------------------------------------------------------------------
// 3. Stage a clean consumer install
// ---------------------------------------------------------------------------
console.log("\n[3/7] clean consumer install");
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
for (const file of publishedFiles) {
  copyFile(path.join(packageDir, file), path.join(stagingDir, file));
}
fs.cpSync(stagingDir, consumerPackageDir, { recursive: true });
fs.writeFileSync(
  path.join(consumerDir, "package.json"),
  JSON.stringify({ name: "pack-check-consumer", private: true, type: "module" }, null, 2),
);
check(
  "consumer has the package in node_modules",
  fs.existsSync(path.join(consumerPackageDir, "dist", "client.js")),
);

const consumerRequire = createRequire(path.join(consumerDir, "package.json"));
const resolvedEntry = consumerRequire.resolve("tab-to-components");
check(
  "exports map resolves from the consumer",
  resolvedEntry === path.join(consumerPackageDir, "dist", "index.js"),
  resolvedEntry,
);

let clientSubpathBlocked = false;
try {
  consumerRequire.resolve("tab-to-components/dist/client.js");
} catch {
  clientSubpathBlocked = true;
}
check(
  "npm exports map blocks the client runtime subpath",
  clientSubpathBlocked,
  "application code must not be able to import the dev runtime",
);

// ---------------------------------------------------------------------------
// 4. Import the packed copy and check the public API
// ---------------------------------------------------------------------------
console.log("\n[4/7] packed package API");
const packed = await import(pathToFileURL(resolvedEntry).href);
check("exports tabToComponents", typeof packed.tabToComponents === "function");
check("exports VERSION", typeof packed.VERSION === "string", packed.VERSION);
check("VERSION matches package.json", packed.VERSION === manifest.version);
const plugin = packed.tabToComponents();
check("plugin name", plugin.name === "tab-to-components", plugin.name);
check("plugin is serve-only", plugin.apply === "serve", plugin.apply);
check("plugin runs pre", plugin.enforce === "pre", plugin.enforce);
check("exports types helper constants", packed.MARKER_ATTR === "data-ttc" && packed.NAME_ATTR === "data-ttc-name");

// ---------------------------------------------------------------------------
// 5. Type-check a consumer file against the packed declarations
// ---------------------------------------------------------------------------
console.log("\n[5/7] consumer TypeScript");
const consumerTypeFile = path.join(consumerDir, "typecheck.ts");
fs.writeFileSync(
  consumerTypeFile,
  [
    'import { tabToComponents, type TabToComponentsOptions } from "tab-to-components";',
    "const options: TabToComponentsOptions = {",
    '  keyboard: ["alt", "meta"],',
    '  open: "element",',
    "  menu: false,",
    "  ssr: false,",
    "  include: [/^app\\//],",
    "};",
    "const plugin = tabToComponents(options);",
    "export const pluginName: string = plugin.name;",
    "",
  ].join("\n"),
);
const program = ts.createProgram({
  rootNames: [consumerTypeFile],
  options: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  },
});
const typeDiagnostics = ts.getPreEmitDiagnostics(program);
if (typeDiagnostics.length > 0) {
  console.log(
    ts.formatDiagnosticsWithColorAndContext(typeDiagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => consumerDir,
      getNewLine: () => "\n",
    }),
  );
}
check("consumer type-checks against the packed .d.ts", typeDiagnostics.length === 0, `${typeDiagnostics.length} diagnostics`);

// ---------------------------------------------------------------------------
// 6. Run the packed copy in a real Vite dev server
// ---------------------------------------------------------------------------
console.log("\n[6/7] packed package in a Vite dev server");
const { createServer } = await import("vite");
const reactPlugin = (await import("@vitejs/plugin-react")).default;
const server = await createServer({
  root: playgroundDir,
  configFile: false,
  logLevel: "error",
  plugins: [reactPlugin(), packed.tabToComponents()],
  server: { port: 0, strictPort: false, host: "127.0.0.1" },
});
try {
  await server.listen();
  const base = server.resolvedUrls?.local?.[0];
  check("dev server starts with the packed plugin", Boolean(base), base);
  const code = await (await fetch(new URL("/src/App.tsx", base))).text();
  check("app module carries source markers", code.includes("data-ttc"));
  check("app module imports the virtual client runtime", code.includes("virtual:tab-to-components/client"));

  const clientResponse = await fetch(
    new URL("/@id/__x00__virtual:tab-to-components/client", base),
  );
  const clientCode = await clientResponse.text();
  check("virtual client module is served", clientResponse.status === 200, `status ${clientResponse.status}`);
  check("client bundle comes from the packed dist/client.js", clientCode.includes("__TTC_READY__"));
  check(
    "client config points at the project root",
    clientCode.includes(encodeURI(playgroundDir.replace(/\\/g, "/")).slice(0, 12)) ||
      clientCode.includes(playgroundDir.replace(/\\/g, "/")),
  );
} finally {
  await server.close();
}

// ---------------------------------------------------------------------------
// 7. The packed copy cannot leak into a production build
// ---------------------------------------------------------------------------
console.log("\n[7/7] packed package in a production build");
const buildEntry = path.join(consumerDir, "src", "main.jsx");
fs.mkdirSync(path.dirname(buildEntry), { recursive: true });
fs.writeFileSync(
  buildEntry,
  'export const App = () => <main><button type="button">hello</button></main>;\n',
  "utf8",
);

const DEV_LEAKS = [
  "data-ttc",
  "virtual:tab-to-components/client",
  "__TTC_CONFIG__",
  "__TTC_READY__",
  "__TTC_INSTALLED__",
];

function flattenBuildOutput(result) {
  const bundles = Array.isArray(result) ? result : [result];
  const parts = [];
  for (const bundle of bundles) {
    if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.output)) {
      continue;
    }
    for (const item of bundle.output) {
      if (item?.type === "chunk" && typeof item.code === "string") {
        parts.push(item.code);
      } else if (item?.type === "asset") {
        parts.push(
          typeof item.source === "string"
            ? item.source
            : Buffer.from(item.source).toString("utf8"),
        );
      }
    }
  }
  return parts;
}

function checkNoDevLeak(label, parts) {
  const code = parts.join("\n");
  const leaked = DEV_LEAKS.find((marker) => code.includes(marker));
  check(
    `${label} production build has output and no dev runtime`,
    parts.length > 0 && leaked === undefined,
    leaked
      ? `build output contains ${JSON.stringify(leaked)}`
      : "build produced no inspectable chunks",
  );
}

function forceIntoBuild(plugin) {
  const copy = { ...plugin };
  delete copy.apply;
  return copy;
}

async function buildConsumer(entry, plugins) {
  const { build } = await import("vite");
  return build({
    root: consumerDir,
    configFile: false,
    logLevel: "silent",
    plugins,
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ["es"], fileName: "bundle" },
    },
  });
}

checkNoDevLeak(
  "apply-serve-filtered",
  flattenBuildOutput(
    await buildConsumer(buildEntry, [
      reactPlugin(),
      packed.tabToComponents({ log: false }),
    ]),
  ),
);

checkNoDevLeak(
  "forced-into-build",
  flattenBuildOutput(
    await buildConsumer(buildEntry, [
      reactPlugin(),
      forceIntoBuild(packed.tabToComponents({ log: false })),
    ]),
  ),
);

const virtualEntry = path.join(consumerDir, "src", "virtual.js");
fs.writeFileSync(
  virtualEntry,
  'import "virtual:tab-to-components/client";\nexport const value = 1;\n',
  "utf8",
);
let virtualBuildFailed = false;
let virtualBuildMessage = "";
try {
  await buildConsumer(virtualEntry, [
    reactPlugin(),
    forceIntoBuild(packed.tabToComponents({ log: false })),
  ]);
} catch (error) {
  virtualBuildFailed = true;
  virtualBuildMessage = String(error?.message ?? error);
}
check(
  "production build cannot resolve the dev client module",
  virtualBuildFailed &&
    /virtual:tab-to-components\/client|could not resolve|failed to resolve/i.test(
      virtualBuildMessage,
    ),
  virtualBuildFailed ? virtualBuildMessage.slice(0, 200) : "build unexpectedly resolved it",
);

// ---------------------------------------------------------------------------
console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${checks - failures.length}/${checks} checks passed`,
);
if (failures.length > 0) {
  console.error("\nFailed checks:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("The package is ready to publish (npm publish --dry-run will upload exactly this file set).\n");
