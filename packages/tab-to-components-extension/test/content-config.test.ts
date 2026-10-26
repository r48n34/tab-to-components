import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LOCAL_DEV_MATCHES } from "../lib/origin";

/**
 * Plasmo parses the content-script `config` export statically with the
 * TypeScript AST: imported constants and spread elements are not evaluated
 * (a spread yields an empty `matches` array, which Chrome rejects). The two
 * entry points therefore keep a local literal list, and this test fails if it
 * drifts from the canonical LOCAL_DEV_MATCHES used by the inspector runtime.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEntry(relativePath: string): string {
  return fs.readFileSync(path.join(packageRoot, relativePath), "utf8");
}

function literalMatches(source: string): string[] | null {
  const block = /const MATCHES = \[([\s\S]*?)\];/.exec(source);
  if (block === null || block[1] === undefined) return null;
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
}

describe.each(["contents/agent.ts", "contents/inspector.ts"])(
  "%s",
  (entry) => {
    it("uses a local literal match list equal to LOCAL_DEV_MATCHES", () => {
      const matches = literalMatches(readEntry(entry));
      expect(matches).toEqual([...LOCAL_DEV_MATCHES]);
    });

    it("runs in every frame on a supported schedule", () => {
      const source = readEntry(entry);
      expect(source).toMatch(/all_frames: true/);
      expect(source).toMatch(/run_at: "(document_start|document_idle)"/);
    });
  },
);

describe("content-script worlds", () => {
  it("registers the agent in the MAIN world", () => {
    expect(readEntry("contents/agent.ts")).toMatch(/world: "MAIN"/);
  });

  it("keeps the inspector in the isolated world", () => {
    expect(readEntry("contents/inspector.ts")).not.toMatch(/world:/);
  });
});
