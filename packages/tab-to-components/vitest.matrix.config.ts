import { defineConfig } from "vitest/config";

/**
 * Version-matrix suite: runs the plugin against a different Vite major than the
 * main integration suite (Vite 7 next to Vite 8).
 *
 * Vite 7 transforms TypeScript with esbuild, which cannot start in every
 * sandboxed environment; `test/version-matrix/matrix.test.ts` detects that and
 * skips itself with an explanatory message instead of failing. Run it with
 * `pnpm test:matrix`.
 */
export default defineConfig({
  test: {
    include: ["test/version-matrix/**/*.test.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: "threads",
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
