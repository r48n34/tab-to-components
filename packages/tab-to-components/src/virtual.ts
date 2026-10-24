import fs from "node:fs";
import type { ClientConfig } from "./types.js";

export const CLIENT_VIRTUAL_ID = "virtual:tab-to-components/client";
export const CLIENT_RESOLVED_ID = `\0${CLIENT_VIRTUAL_ID}`;

let cachedClientAsset: string | undefined;

/**
 * The client runtime is bundled to a single ESM file by `scripts/build.mjs`.
 * Resolve it from both the published layout (`dist/index.js` next to
 * `dist/client.js`) and the source layout used by tests (`src/` with a sibling
 * `dist/`).
 */
export function readClientAsset(): string {
  if (cachedClientAsset !== undefined) return cachedClientAsset;
  const candidates = [
    "./client.js",
    "../dist/client.js",
    "./client/index.js",
  ];
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, import.meta.url);
      const content = fs.readFileSync(url, "utf8");
      cachedClientAsset = content;
      return content;
    } catch (error) {
      failures.push(`${candidate}: ${(error as Error).message}`);
    }
  }
  throw new Error(
    [
      "tab-to-components: the client runtime asset is missing.",
      "Run `pnpm build` (or `node scripts/build.mjs`) in the plugin package first.",
      ...failures.map((failure) => `  - ${failure}`),
    ].join("\n"),
  );
}

/**
 * The virtual module served to the browser: it publishes the config on the
 * global object and then evaluates the bundled client runtime.
 */
export function buildClientModule(config: ClientConfig): string {
  return [
    `globalThis.__TTC_CONFIG__=${JSON.stringify(config)};`,
    readClientAsset(),
    "",
  ].join("\n");
}
