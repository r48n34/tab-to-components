import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type { ViteDevServer } from "vite";

/** Minimal structural type for a Vite module (major agnostic). */
export interface ViteModuleLike {
  version: string;
  createServer: (options: Record<string, unknown>) => Promise<ViteDevServer>;
  build: (options: Record<string, unknown>) => Promise<unknown>;
}

export interface NodeRequireLike {
  (id: string): unknown;
  resolve: (id: string) => string;
}

/**
 * Resolve the `vite` copy that a playground actually depends on (this is how a
 * Vite 5 app, a Vite 7 app and a Vite 8 app coexist in one workspace).
 */
export async function loadPlaygroundVite(
  playgroundDir: string,
): Promise<{ vite: ViteModuleLike; nodeRequire: NodeRequireLike }> {
  const nodeRequire = createRequire(
    path.join(playgroundDir, "package.json"),
  ) as unknown as NodeRequireLike;
  const entry = nodeRequire.resolve("vite");
  const loaded = (await import(pathToFileURL(entry).href)) as ViteModuleLike & {
    default?: ViteModuleLike;
  };
  // Vite 5's `require` entry resolves to its CJS bundle, so the dynamic import
  // yields a namespace whose `default` is the real module (the named `version`
  // and `createServer` re-exports are not available on the namespace). Vite 7
  // and Vite 8 resolve to ESM, where the namespace is the module itself.
  const vite = loaded.default ?? loaded;
  return { vite, nodeRequire };
}

export interface StartedApp {
  server: ViteDevServer;
  base: string;
  viteVersion: string;
  stop: () => Promise<void>;
}

export async function startPlayground(
  playgroundDir: string,
): Promise<StartedApp> {
  const { vite, nodeRequire } = await loadPlaygroundVite(playgroundDir);
  const server = await vite.createServer({
    root: playgroundDir,
    configFile: path.join(playgroundDir, "vite.config.ts"),
    logLevel: "error",
    server: { port: 0, strictPort: false, host: "127.0.0.1" },
  });
  await server.listen();
  const base = server.resolvedUrls?.local?.[0];
  if (!base) {
    await server.close();
    throw new Error(`dev server for ${playgroundDir} did not report a URL`);
  }
  return {
    server,
    base,
    viteVersion: vite.version,
    stop: async () => {
      // Vite 5 and Vite 7 keep their esbuild service alive, which can delay
      // worker exit. Closing is best-effort; stopping esbuild releases the
      // process.
      await Promise.race([
        server.close().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      try {
        const esbuild = nodeRequire("esbuild") as { stop?: () => void };
        esbuild.stop?.();
      } catch {
        // esbuild is not loaded for Vite 8 playgrounds.
      }
    },
  };
}

/** Is esbuild able to start in this environment? */
export function canSpawnEsbuild(): boolean {
  let esbuild:
    | {
        transformSync: (
          code: string,
          options: Record<string, unknown>,
        ) => unknown;
        stop: () => void;
      }
    | undefined;
  try {
    const nodeRequire = createRequire(
      path.join(process.cwd(), "package.json"),
    ) as unknown as NodeRequireLike;
    esbuild = nodeRequire("esbuild") as {
      transformSync: (code: string, options: Record<string, unknown>) => unknown;
      stop: () => void;
    };
    esbuild.transformSync("const value: number = 1;", { loader: "ts" });
    return true;
  } catch {
    return false;
  } finally {
    try {
      esbuild?.stop();
    } catch {
      // esbuild service already gone
    }
  }
}

export const ESBUILD_BLOCKED_MESSAGE =
  "Vite 5 and Vite 7 transform TypeScript with esbuild and esbuild cannot start in this sandbox " +
  "(child processes are blocked). Run the matrix suite with process access: " +
  "`pnpm test:matrix`. On a normal machine it runs confined.";

export async function fetchText(base: string, url: string): Promise<string> {
  return (await fetch(new URL(url, base))).text();
}
