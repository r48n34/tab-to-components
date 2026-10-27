import { defineConfig } from "vitest/config";

/**
 * Version-matrix suite: runs the plugin against the other Vite majors the
 * package supports next to the main integration suite (Vite 5 and Vite 7 next
 * to Vite 8).
 *
 * Vite 5 and Vite 7 transform TypeScript with esbuild, which cannot start in
 * every sandboxed environment; `test/version-matrix/matrix.test.ts` detects
 * that and skips the esbuild-dependent tiers with an explanatory message. The
 * Vite 5 virtual-client/editor-middleware test is unguarded (it disables
 * esbuild), so real Vite 5 interop still runs there. Run the whole suite with
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
