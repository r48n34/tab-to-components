import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: "threads",
    // The React Router dev server is heavy; run one app at a time.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
