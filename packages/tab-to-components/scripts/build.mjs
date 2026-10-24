// Build the plugin with the TypeScript compiler and bundle the browser runtime
// with rolldown. Both run in-process so the build also works in sandboxes that
// block child processes (esbuild/tsup cannot run there).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { rolldown } from "rolldown";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptsDir, "..");
const distDir = path.join(packageRoot, "dist");

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const configPath = path.join(packageRoot, "tsconfig.build.json");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  fail([configFile.error]);
}
const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  packageRoot,
  undefined,
  configPath,
);
if (parsed.errors.length > 0 && parsed.fileNames.length === 0) {
  fail(parsed.errors);
}

const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options,
});
const emitResult = program.emit();
const diagnostics = ts
  .getPreEmitDiagnostics(program)
  .concat(emitResult.diagnostics);
if (diagnostics.length > 0) {
  fail(diagnostics);
}

function formatDiagnostics(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => packageRoot,
    getNewLine: () => "\n",
  });
}

function fail(diagnostics) {
  console.error(formatDiagnostics(diagnostics));
  process.exit(1);
}

const clientEntry = path.join(packageRoot, "src", "client", "index.ts");
if (!fs.existsSync(clientEntry)) {
  console.error(`tab-to-components: missing client entry ${clientEntry}`);
  process.exit(1);
}

const bundle = await rolldown({
  input: clientEntry,
  cwd: packageRoot,
  platform: "browser",
});
await bundle.write({
  dir: distDir,
  format: "esm",
  entryFileNames: "client.js",
  // The runtime is only ever served in dev, and minifying it roughly halves
  // the published artifact. String sentinels such as `__TTC_READY__` are
  // preserved, so the package checks keep working.
  minify: true,
  sourcemap: false,
});
await bundle.close();

const clientOut = path.join(distDir, "client.js");
if (!fs.existsSync(clientOut)) {
  console.error("tab-to-components: client bundle was not written");
  process.exit(1);
}

const bytes = fs.statSync(clientOut).size;
const gzipBytes = zlib.gzipSync(fs.readFileSync(clientOut), { level: 9 }).length;
console.log(
  `tab-to-components: built dist/ (client.js ${bytes} bytes, ${gzipBytes} bytes gzip)`,
);
