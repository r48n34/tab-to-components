import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export const packageDir = path.resolve(here, "../..");
export const repoRoot = path.resolve(packageDir, "../..");

export type PlaygroundName =
  | "vite-react"
  | "vite-react-vite7"
  | "rr7"
  | "rr7-vite7"
  | "rr8";

export function playgroundDir(name: PlaygroundName): string {
  return path.join(repoRoot, "playground", name);
}

export interface RunningServer {
  server: ViteDevServer;
  base: string;
  close: () => Promise<void>;
}

export async function startDevServer(root: string): Promise<RunningServer> {
  const { createServer } = await import("vite");
  const server = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
    logLevel: "error",
    server: {
      port: 0,
      strictPort: false,
      host: "127.0.0.1",
    },
  });
  await server.listen();
  const base = server.resolvedUrls?.local?.[0];
  if (!base) {
    await server.close();
    throw new Error(`dev server for ${root} did not report a local URL`);
  }
  return {
    server,
    base,
    close: async () => {
      await server.close();
    },
  };
}

export async function fetchText(base: string, url: string): Promise<string> {
  const response = await fetch(new URL(url, base));
  return response.text();
}

export function readSource(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

export function relativePosix(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).replace(/\\/g, "/");
}

/**
 * The exact marker value the plugin should inject for the first occurrence of
 * `jsxTag` in a source file: `<path>:<1-based line>:<1-based column of "<">`.
 */
export function expectedMarker(
  root: string,
  relativePath: string,
  jsxTag: string,
): string {
  const lines = readSource(root, relativePath).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const column = (lines[index] ?? "").indexOf(jsxTag);
    if (column !== -1) {
      return `${relativePath}:${index + 1}:${column + 1}`;
    }
  }
  throw new Error(`could not find ${jsxTag} in ${relativePath}`);
}

export function expectNoBuildLeak(files: string[], contents: string[]): void {
  const forbiddens = [
    "data-ttc",
    "virtual:tab-to-components/client",
    "__TTC_CONFIG__",
    "__TTC_READY__",
  ];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index] ?? "";
    const code = contents[index] ?? "";
    if (!/\.(js|mjs|cjs)$/.test(file)) continue;
    for (const forbidden of forbiddens) {
      if (code.includes(forbidden)) {
        throw new Error(
          `build output ${file} contains the dev-only marker ${JSON.stringify(forbidden)}`,
        );
      }
    }
  }
}
