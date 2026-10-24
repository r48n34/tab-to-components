import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ClientConfig } from "../src/types.js";
import {
  CLIENT_RESOLVED_ID,
  CLIENT_VIRTUAL_ID,
  buildClientModule,
  readClientAsset,
} from "../src/virtual.js";

const DIST_CLIENT = fileURLToPath(
  new URL("../dist/client.js", import.meta.url),
);
const HAS_CLIENT_ASSET = fs.existsSync(DIST_CLIENT);

const CONFIG: ClientConfig = {
  version: "1.2.3",
  root: "D:/proj",
  base: "/app/",
  keyboard: ["alt", "shift"],
  open: "menu",
  menu: false,
  editorEndpoint: "__ttc/open-in-editor",
};

const PRELUDE_PREFIX = "globalThis.__TTC_CONFIG__=";

function preludeOf(code: string): string {
  return code.split("\n")[0] ?? "";
}

describe("virtual client ids", () => {
  it("uses the documented public virtual id", () => {
    expect(CLIENT_VIRTUAL_ID).toBe("virtual:tab-to-components/client");
    expect(CLIENT_RESOLVED_ID).toBe(`\0${CLIENT_VIRTUAL_ID}`);
  });

  it("keeps the resolved id private to Vite's plugin container", () => {
    // A leading NUL is Vite's convention for ids that never touch the file
    // system, so no production resolver can turn this into a real module.
    expect(CLIENT_RESOLVED_ID.startsWith("\0")).toBe(true);
    expect(CLIENT_RESOLVED_ID).toContain("\0virtual:tab-to-components/");
    expect(CLIENT_RESOLVED_ID.startsWith("/")).toBe(false);
  });
});

describe.skipIf(!HAS_CLIENT_ASSET)("client runtime asset", () => {
  it("reads the built browser bundle", () => {
    const asset = readClientAsset();
    expect(asset.length).toBeGreaterThan(1_000);
    expect(asset).toContain("__TTC_READY__");
    expect(asset).toContain("data-ttc-ui");
    expect(asset).toContain("__TTC_CONFIG__");
  });

  it("caches the bundle after the first read", () => {
    expect(readClientAsset()).toBe(readClientAsset());
  });
});

describe.skipIf(!HAS_CLIENT_ASSET)("buildClientModule", () => {
  it("prepends the injected config to the exact client bundle", () => {
    const code = buildClientModule(CONFIG);
    const asset = readClientAsset();
    const prelude = preludeOf(code);

    expect(prelude.startsWith(PRELUDE_PREFIX)).toBe(true);
    expect(prelude.endsWith(";")).toBe(true);
    expect(code).toContain(asset);
    expect(code.endsWith("\n")).toBe(true);
  });

  it("serialises the whole client config as one parseable line", () => {
    const prelude = preludeOf(buildClientModule(CONFIG));
    const json = prelude.slice(
      PRELUDE_PREFIX.length,
      prelude.endsWith(";") ? -1 : undefined,
    );

    expect(JSON.parse(json)).toEqual(CONFIG);
  });

  it("escapes paths that would otherwise break the JS prelude", () => {
    const config: ClientConfig = {
      ...CONFIG,
      root: 'D:/a"b\\c\nd',
      base: "/weird\u2028base/",
    };

    const prelude = preludeOf(buildClientModule(config));
    const json = prelude.slice(PRELUDE_PREFIX.length, -1);

    // The prelude must stay a single physical line: a raw newline here would
    // turn the global assignment into a syntax error.
    expect(prelude).not.toContain("\n");
    expect(JSON.parse(json)).toEqual(config);
  });

  it("does not add the missing-asset fallback", () => {
    expect(buildClientModule(CONFIG)).not.toContain("export {};");
  });
});
