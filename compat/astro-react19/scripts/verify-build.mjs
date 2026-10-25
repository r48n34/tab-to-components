// Production-build cleanliness check for the tab-to-components Astro fixture.
//
// Run after `astro build`: scans every file in dist/ for dev-only strings that
// must never reach a production artifact.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const FORBIDDEN = [
  "data-ttc",
  "virtual:tab-to-components/client",
  "__TTC_CONFIG__",
  "__TTC_READY__",
  "__TTC_INSTALLED__",
];

const dist = path.resolve(process.cwd(), "dist");
const files = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile()) files.push(full);
  }
}

let listError;
try {
  await walk(dist);
} catch (error) {
  listError = error?.stack ?? String(error);
}

const hits = [];
const scanned = [];

if (!listError) {
  for (const file of files) {
    const content = await readFile(file);
    const text = content.toString("utf8");
    scanned.push({
      file: path.relative(process.cwd(), file).replaceAll("\\", "/"),
      bytes: content.byteLength,
    });
    for (const needle of FORBIDDEN) {
      if (text.includes(needle)) {
        hits.push({
          file: path.relative(process.cwd(), file).replaceAll("\\", "/"),
          needle,
        });
      }
    }
  }
}

const ok = !listError && hits.length === 0;
console.log(
  JSON.stringify(
    {
      fixture: process.cwd(),
      dist: path.relative(process.cwd(), dist).replaceAll("\\", "/"),
      fileCount: files.length,
      scanned,
      forbidden: FORBIDDEN,
      hits,
      ...(listError ? { error: listError } : {}),
      ok,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
