#!/usr/bin/env node
/**
 * Verify the production Plasmo build.
 *
 * Run after `pnpm --filter tab-to-components-extension build`:
 *   node packages/tab-to-components-extension/scripts/verify-build.mjs
 *
 * These checks encode the extension's security and behavior contract: MV3,
 * narrow localhost-only permissions, both content scripts present (the
 * MAIN-world agent is registered by the service worker through
 * chrome.scripting), popup/options pages wired, and no remote code.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const buildDir = path.join(packageRoot, "build", "chrome-mv3-prod");
const manifestPath = path.join(buildDir, "manifest.json");

const EXPECTED_HOST_PERMISSIONS = [
  "http://localhost/*",
  "https://localhost/*",
  "http://127.0.0.1/*",
  "https://127.0.0.1/*",
  "http://[::1]/*",
  "https://[::1]/*",
];

const EXPECTED_PERMISSIONS = ["clipboardWrite", "scripting", "storage"];

const failures = [];

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`cannot read ${file}: ${error.message}`);
    return null;
  }
}

function listFiles(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory()
          ? listFiles(path.join(dir, entry.name)).map((child) =>
              path.join(entry.name, child),
            )
          : [entry.name],
      );
  } catch (error) {
    fail(`cannot list ${dir}: ${error.message}`);
    return [];
  }
}

if (!fs.existsSync(buildDir)) {
  console.error(
    `missing build directory: ${buildDir}\nRun "pnpm --filter tab-to-components-extension build" first.`,
  );
  process.exit(1);
}

const manifest = readJson(manifestPath);
if (manifest === null) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const files = listFiles(buildDir);
const fileSet = new Set(files.map((file) => file.replace(/\\/g, "/")));

check(manifest.manifest_version === 3, "manifest_version must be 3");
check(
  typeof manifest.name === "string" && manifest.name.length > 0,
  "manifest name must be set",
);
check(
  typeof manifest.version === "string" && /^\d+\.\d+\.\d+/.test(manifest.version),
  "manifest version must be semver-like",
);
check(
  typeof manifest.description === "string" && manifest.description.length > 0,
  "manifest description must be set",
);

const permissions = [...(manifest.permissions ?? [])].sort();
check(
  JSON.stringify(permissions) === JSON.stringify(EXPECTED_PERMISSIONS),
  `permissions must be exactly ${EXPECTED_PERMISSIONS.join(", ")} (got ${permissions.join(", ")})`,
);
check(
  !permissions.includes("tabs"),
  "the extension must not request the tabs permission",
);

const hostPermissions = [...(manifest.host_permissions ?? [])].sort();
const expectedHosts = [...EXPECTED_HOST_PERMISSIONS].sort();
check(
  JSON.stringify(hostPermissions) === JSON.stringify(expectedHosts),
  `host_permissions must be the localhost set (got ${hostPermissions.join(", ")})`,
);

const serializedManifest = JSON.stringify(manifest);
check(
  !serializedManifest.includes("<all_urls>"),
  "the manifest must not request <all_urls>",
);
check(
  !serializedManifest.includes("content_security_policy"),
  "the manifest must not override the default MV3 CSP",
);

// --- isolated-world inspector content script -------------------------------
const contentScripts = Array.isArray(manifest.content_scripts)
  ? manifest.content_scripts
  : [];
check(contentScripts.length === 1, "exactly one declarative content script expected");
const inspector = contentScripts[0];
if (inspector !== undefined) {
  const matches = [...(inspector.matches ?? [])].sort();
  check(
    JSON.stringify(matches) === JSON.stringify(expectedHosts),
    "the inspector content script must match the localhost set",
  );
  check(inspector.all_frames === true, "the inspector must run in all frames");
  check(
    inspector.run_at === "document_idle",
    "the inspector must run at document_idle",
  );
  check(
    inspector.world === undefined || inspector.world === "ISOLATED",
    "the inspector must run in the isolated world",
  );
  for (const script of inspector.js ?? []) {
    check(fileSet.has(script), `missing content script bundle: ${script}`);
  }
}

// --- MAIN-world agent (registered by the service worker) -------------------
const background = manifest.background?.service_worker;
check(
  typeof background === "string" && background.length > 0,
  "the manifest must declare a service worker",
);
if (typeof background === "string") {
  check(fileSet.has(background), `missing service worker bundle: ${background}`);
  const backgroundSource = fs.readFileSync(path.join(buildDir, background), "utf8");
  check(
    backgroundSource.includes("registerContentScripts"),
    "the service worker must register the MAIN-world agent",
  );
  check(
    /world:?\s*"MAIN"/.test(backgroundSource) || /"world":"MAIN"/.test(backgroundSource),
    "the MAIN-world agent registration must declare world: MAIN",
  );
  const agentBundles = files.filter((file) => /(^|[\\/])agent\..*\.js$/.test(file));
  check(agentBundles.length > 0, "missing the MAIN-world agent bundle");
  for (const bundle of agentBundles) {
    check(
      backgroundSource.includes(path.basename(bundle)),
      `the service worker must load ${path.basename(bundle)}`,
    );
  }
  for (const match of EXPECTED_HOST_PERMISSIONS) {
    check(
      backgroundSource.includes(match),
      `the MAIN-world agent registration is missing the match pattern ${match}`,
    );
  }
  check(
    backgroundSource.includes('"allFrames":true') ||
      /allFrames:\s*!0/.test(backgroundSource),
    "the MAIN-world agent registration must use allFrames",
  );
  check(
    backgroundSource.includes('"runAt":"document_start"') ||
      /runAt:\s*"document_start"/.test(backgroundSource),
    "the MAIN-world agent registration must run at document_start",
  );
}

// --- extension pages -------------------------------------------------------
const popup = manifest.action?.default_popup;
check(typeof popup === "string", "the manifest must declare a popup page");
if (typeof popup === "string") {
  check(fileSet.has(popup), `missing popup page: ${popup}`);
}
const optionsPage = manifest.options_ui?.page ?? manifest.options_page;
check(
  typeof optionsPage === "string",
  "the manifest must declare the options page",
);
if (typeof optionsPage === "string") {
  check(fileSet.has(optionsPage), `missing options page: ${optionsPage}`);
}

// --- icons -----------------------------------------------------------------
const icons = manifest.icons ?? {};
for (const size of [16, 32, 48, 64, 128]) {
  const icon = icons[String(size)];
  check(typeof icon === "string", `missing ${size}px icon in the manifest`);
  if (typeof icon === "string") {
    check(fileSet.has(icon), `missing icon file: ${icon}`);
  }
}

// --- no remote code / eval --------------------------------------------------
const jsFiles = files.filter((file) => file.endsWith(".js"));
for (const file of jsFiles) {
  const source = fs.readFileSync(path.join(buildDir, file), "utf8");
  check(
    !/\beval\s*\(/.test(source),
    `unexpected eval() usage in ${file.replace(/\\/g, "/")}`,
  );
  check(
    !/new\s+Function\s*\(/.test(source),
    `unexpected new Function() usage in ${file.replace(/\\/g, "/")}`,
  );
  check(
    !/https?:\/\/[^\s"']+\/[^\s"']*\.js/.test(source) ||
      !source.includes("importScripts("),
    `unexpected remote script loading in ${file.replace(/\\/g, "/")}`,
  );
}

if (failures.length > 0) {
  console.error("verify-build failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const totalBytes = files.reduce(
  (sum, file) => sum + fs.statSync(path.join(buildDir, file)).size,
  0,
);
console.log(
  `verify-build OK: MV3 extension, ${files.length} files, ${(
    totalBytes / 1024
  ).toFixed(1)} KiB, agent registered in the MAIN world.`,
);
