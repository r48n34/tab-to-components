import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, install, resolveConfig } from "../../src/client/index";

describe("resolveConfig", () => {
  it("falls back to the documented defaults", () => {
    expect(resolveConfig()).toEqual(DEFAULT_CONFIG);
    expect(resolveConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it("normalizes base to start and end with a slash", () => {
    expect(resolveConfig({ base: "/app" }).base).toBe("/app/");
    expect(resolveConfig({ base: "app" }).base).toBe("/app/");
    expect(resolveConfig({ base: "/" }).base).toBe("/");
    expect(resolveConfig({ base: "  " }).base).toBe("/");
  });

  it("normalizes the project root to forward slashes without a trailing slash", () => {
    expect(resolveConfig({ root: "D:\\work\\project\\" }).root).toBe("D:/work/project");
    expect(resolveConfig({ root: "/home/dev/project/" }).root).toBe("/home/dev/project");
  });

  it("keeps only known modifier keys and dedupes them", () => {
    expect(resolveConfig({ keyboard: ["alt", "shift", "alt"] }).keyboard).toEqual([
      "alt",
      "shift",
    ]);
    expect(resolveConfig({ keyboard: ["hyper"] as never }).keyboard).toEqual(["alt"]);
    expect(resolveConfig({ keyboard: [] }).keyboard).toEqual(["alt"]);
  });

  it("normalizes the open mode and endpoint", () => {
    expect(resolveConfig({ open: "element" }).open).toBe("element");
    expect(resolveConfig({ open: "bogus" as never }).open).toBe("component");
    expect(resolveConfig({ editorEndpoint: "/__open-in-editor" }).editorEndpoint).toBe(
      "__open-in-editor",
    );
    expect(resolveConfig({ editorEndpoint: "" }).editorEndpoint).toBe("__open-in-editor");
  });

  it("coerces the menu flag and keeps a version string", () => {
    expect(resolveConfig({ menu: false }).menu).toBe(false);
    expect(resolveConfig({ menu: true }).menu).toBe(true);
    expect(resolveConfig({ version: "1.2.3" }).version).toBe("1.2.3");
  });
});

describe("install without a DOM", () => {
  it("is a no-op outside the browser", () => {
    expect(typeof window).toBe("undefined");
    const cleanup = install({ root: "D:/proj" });
    expect(typeof cleanup).toBe("function");
    cleanup();
    expect(globalThis.__TTC_READY__).toBeUndefined();
    expect(globalThis.__TTC_INSTALLED__).toBeUndefined();
  });
});
