import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Integration and version-matrix suites boot real dev servers and have
    // their own configs/scripts (`test:integration`, `test:matrix`).
    exclude: ["test/integration/**", "test/version-matrix/**", "node_modules/**"],
    environment: "node",
    testTimeout: 30_000,
    // `forks` would spawn child processes; the sandbox this repo is developed
    // in blocks spawn, and threads are faster anyway.
    pool: "threads",
  },
});
