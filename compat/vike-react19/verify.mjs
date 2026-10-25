#!/usr/bin/env node
// Reusable verification for the Vike + React 19 compatibility fixture.
//
// Starts Vike's dev server through its documented JavaScript API (the same
// `dev()` that `$ vike dev` calls), asserts the tab-to-components dev behavior,
// closes the server, then (with --scan-build) scans Vike's production client
// output for dev-only leakage.
//
// Usage:
//   node --import file:///<repo>/scripts/sandbox-shim.mjs verify.mjs
//   node --import file:///<repo>/scripts/sandbox-shim.mjs verify.mjs --scan-build
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dev } from "vike/api";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_URL = "/@id/__x00__virtual:tab-to-components/client";
const PAGE_FILE = "pages/index/+Page.tsx";
const COMPONENT_FILE = "src/components/Button.tsx";
const FORBIDDEN_BUILD_STRINGS = [
  "data-ttc",
  "virtual:tab-to-components/client",
  "__TTC_CONFIG__",
  "__TTC_READY__",
  "__TTC_INSTALLED__",
];

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
}

function fail(message) {
  throw new Error(message);
}

/** Compute the exact `file:line:column` marker the transform must inject. */
function markerOf(relFile, jsxTag) {
  const lines = fs.readFileSync(path.join(DIR, relFile), "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(jsxTag);
    if (column !== -1) return `${relFile}:${index + 1}:${column + 1}`;
  }
  fail(`could not find ${jsxTag} in ${relFile}`);
}

async function fetchText(base, url) {
  const response = await fetch(new URL(url, base), {
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, text: await response.text() };
}

function expectIncludes(text, needle, label) {
  if (!text.includes(needle)) fail(`${label} is missing ${JSON.stringify(needle)}`);
}

function scanBuildOutput(dir) {
  if (!fs.existsSync(dir)) fail(`build output directory ${path.relative(DIR, dir)} is missing`);
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else files.push(absolute);
    }
  };
  walk(dir);
  const scanned = files.filter((file) => !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf)$/i.test(file));
  if (scanned.length === 0) fail(`no text files in ${path.relative(DIR, dir)}`);
  const leaks = [];
  for (const file of scanned) {
    const code = fs.readFileSync(file, "utf8");
    for (const forbidden of FORBIDDEN_BUILD_STRINGS) {
      if (code.includes(forbidden)) leaks.push(`${path.relative(dir, file)}: ${forbidden}`);
    }
  }
  if (leaks.length > 0) fail(`production client output contains dev-only strings: ${leaks.join("; ")}`);
  return scanned.length;
}

async function runDevChecks() {
  const startedAt = Date.now();
  const { viteServer } = await dev({
    startupLog: true,
    viteConfig: {
      root: DIR,
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    },
  });
  try {
    const base = viteServer.resolvedUrls?.local?.[0];
    if (!base) fail("Vike dev server reported no local URL");
    console.log(`\nVike dev server ready at ${base} (${Date.now() - startedAt} ms)\n`);

    const mainMarker = markerOf(PAGE_FILE, "<main");
    const usageMarker = markerOf(PAGE_FILE, "<Button");
    const hostMarker = markerOf(COMPONENT_FILE, "<button");

    // 1. SSR document contains both source sites plus the component name.
    const page = await fetchText(base, "/");
    if (page.status !== 200) fail(`GET / returned HTTP ${page.status}`);
    expectIncludes(page.text, `data-ttc="${mainMarker}"`, "SSR HTML");
    expectIncludes(page.text, `data-ttc="${hostMarker}"`, "SSR HTML");
    expectIncludes(page.text, 'data-ttc-name="Button"', "SSR HTML");
    expectIncludes(page.text, "Vike + React 19", "SSR HTML");
    record(
      "SSR HTML",
      true,
      `GET / 200; main ${mainMarker}; host button ${hostMarker}; data-ttc-name="Button"`,
    );

    // 2. Served page module is instrumented and imports the overlay runtime.
    const pageModule = await fetchText(base, `/${PAGE_FILE}`);
    if (pageModule.status !== 200) fail(`GET /${PAGE_FILE} returned HTTP ${pageModule.status}`);
    expectIncludes(pageModule.text, `"data-ttc": "${mainMarker}"`, `served ${PAGE_FILE}`);
    expectIncludes(pageModule.text, `"data-ttc": "${usageMarker}"`, `served ${PAGE_FILE}`);
    expectIncludes(pageModule.text, 'data-ttc-name": "Button"', `served ${PAGE_FILE}`);
    expectIncludes(pageModule.text, "virtual:tab-to-components/client", `served ${PAGE_FILE}`);
    record(
      "served page module",
      true,
      `GET /${PAGE_FILE} 200; HTML main marker ${mainMarker}, <Button> usage marker ${usageMarker}, virtual client import present`,
    );

    // 3. The virtual client runtime is served with its injected config.
    const client = await fetchText(base, CLIENT_URL);
    if (client.status !== 200) fail(`GET ${CLIENT_URL} returned HTTP ${client.status}`);
    expectIncludes(client.text, "__TTC_CONFIG__", CLIENT_URL);
    expectIncludes(client.text, '"clickActions":["open"]', CLIENT_URL);
    expectIncludes(client.text, '"root":"', CLIENT_URL);
    expectIncludes(client.text, "__TTC_READY__", CLIENT_URL);
    record(
      "virtual client module",
      true,
      `GET ${CLIENT_URL} 200; __TTC_CONFIG__ with clickActions:["open"] and the bundled runtime`,
    );
  } finally {
    await viteServer.close();
    console.log("\nVike dev server closed");
  }
}

async function main() {
  const scanBuild = process.argv.includes("--scan-build");
  if (scanBuild) {
    const clientDir = path.join(DIR, "dist", "client");
    const serverDir = path.join(DIR, "dist", "server");
    const clientCount = scanBuildOutput(clientDir);
    record("production client output", true, `${clientCount} text files, no dev-only strings`);
    const serverCount = scanBuildOutput(serverDir);
    record("production server output", true, `${serverCount} text files, no dev-only strings`);
    console.log(`\nScanned ${path.relative(process.cwd(), clientDir)} and dist/server`);
    return;
  }
  await runDevChecks();
}

try {
  await main();
  if (!results.every((result) => result.ok)) process.exitCode = 1;
  const mode = process.argv.includes("--scan-build") ? "build" : "dev-server";
  console.log(`\nAll ${mode} checks passed`);
} catch (error) {
  console.error(`\nVERIFICATION FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
