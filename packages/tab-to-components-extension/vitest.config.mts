import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 15_000,
    // `forks` would spawn child processes; the sandbox this repo is developed
    // in blocks spawn, and threads are faster anyway.
    pool: "threads",
    setupFiles: ["test/setup.ts"],
  },
});
