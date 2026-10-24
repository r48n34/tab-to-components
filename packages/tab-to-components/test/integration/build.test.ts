import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectNoBuildLeak, packageDir, playgroundDir } from "./helpers.js";

const OUT_DIR = path.join(packageDir, ".tmp", "build-output");

function collectOutput(dir: string): { files: string[]; contents: string[] } {
  const files: string[] = [];
  const contents: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else {
        files.push(path.relative(dir, absolute).replace(/\\/g, "/"));
        contents.push(fs.readFileSync(absolute, "utf8"));
      }
    }
  };
  walk(dir);
  return { files, contents };
}

describe("production build", () => {
  it("plain Vite build contains no injected markers or dev runtime", async () => {
    const { build } = await import("vite");
    const root = playgroundDir("vite-react");
    const outDir = path.resolve(OUT_DIR, "vite-react");
    fs.rmSync(outDir, { recursive: true, force: true });

    await build({
      root,
      configFile: path.join(root, "vite.config.ts"),
      logLevel: "error",
      build: { outDir, emptyOutDir: true },
    });

    const { files, contents } = collectOutput(outDir);
    expect(files.some((file) => file.endsWith(".js"))).toBe(true);
    expectNoBuildLeak(files, contents);
  });

  // React Router owns the build directory, so clean and inspect `<app>/build`.
  it.each(["rr7", "rr8"] as const)(
    "React Router %s build contains no injected markers or dev runtime",
    async (name) => {
      const { build } = await import("vite");
      const root = playgroundDir(name);
      const buildDir = path.join(root, "build");
      fs.rmSync(buildDir, { recursive: true, force: true });

      await build({
        root,
        configFile: path.join(root, "vite.config.ts"),
        logLevel: "error",
      });

      const clientDir = path.join(buildDir, "client");
      expect(fs.existsSync(clientDir)).toBe(true);
      const { files, contents } = collectOutput(clientDir);
      expect(files.some((file) => file.endsWith(".js"))).toBe(true);
      expectNoBuildLeak(files, contents);
    },
  );
});
