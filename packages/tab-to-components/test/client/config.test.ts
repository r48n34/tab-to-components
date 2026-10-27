import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  install,
  isModifierHeld,
  resolveConfig,
} from "../../src/client/index";

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

  it("defaults the overlay to the dark theme and accepts light", () => {
    expect(DEFAULT_CONFIG.theme).toBe("dark");
    expect(resolveConfig().theme).toBe("dark");
    expect(resolveConfig({ theme: "light" }).theme).toBe("light");
    expect(resolveConfig({ theme: "dark" }).theme).toBe("dark");
  });

  it("falls back to dark for an unknown theme", () => {
    expect(resolveConfig({ theme: "solarized" as never }).theme).toBe("dark");
  });

  it("defaults the click action picker to open, file name and full path", () => {
    expect(DEFAULT_CONFIG.clickActions).toEqual([
      "open",
      "copy-file",
      "copy-full-path",
    ]);
    expect(resolveConfig().clickActions).toEqual([
      "open",
      "copy-file",
      "copy-full-path",
    ]);
  });

  it("keeps known click actions in order and dedupes them", () => {
    expect(
      resolveConfig({
        clickActions: [
          "copy-file",
          "open",
          "copy-file",
          "copy-path",
          "copy-full-path",
        ],
      }).clickActions,
    ).toEqual(["copy-file", "open", "copy-path", "copy-full-path"]);
  });

  it("keeps the per-IDE open actions in order and dedupes them", () => {
    expect(
      resolveConfig({
        clickActions: [
          "open-cursor",
          "open-code",
          "open-webstorm",
          "open-trae",
        ],
      }).clickActions,
    ).toEqual(["open-cursor", "open-code", "open-webstorm", "open-trae"]);

    expect(
      resolveConfig({
        clickActions: [
          "open-trae",
          "copy-file",
          "open-trae",
          "open-code",
          "open-trae",
        ],
      }).clickActions,
    ).toEqual(["open-trae", "copy-file", "open-code"]);
  });

  it("accepts a single per-IDE open action as a shorthand", () => {
    expect(
      resolveConfig({ clickActions: "open-webstorm" as never }).clickActions,
    ).toEqual(["open-webstorm"]);
  });

  it("drops unknown click actions and falls back to the defaults", () => {
    expect(
      resolveConfig({ clickActions: ["nope" as never] }).clickActions,
    ).toEqual(["open", "copy-file", "copy-full-path"]);
    expect(resolveConfig({ clickActions: [] }).clickActions).toEqual([
      "open",
      "copy-file",
      "copy-full-path",
    ]);
  });

  it("drops an unknown action without resetting the known ones", () => {
    expect(
      resolveConfig({ clickActions: ["open-cursor", "open-sidebar"] as never })
        .clickActions,
    ).toEqual(["open-cursor"]);
  });

  it("accepts a single action as a shorthand", () => {
    expect(
      resolveConfig({ clickActions: "open" as never }).clickActions,
    ).toEqual(["open"]);
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

describe("isModifierHeld", () => {
  const held = (keys: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>>) => ({
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...keys,
  });

  it("returns false for an empty keyboard configuration", () => {
    expect(isModifierHeld(held({ altKey: true }), [])).toBe(false);
  });

  it("requires every configured modifier", () => {
    expect(isModifierHeld(held({ altKey: true }), ["alt"])).toBe(true);
    expect(isModifierHeld(held({ altKey: true }), ["alt", "shift"])).toBe(false);
    expect(
      isModifierHeld(held({ altKey: true, shiftKey: true }), ["alt", "shift"]),
    ).toBe(true);
  });

  it("ignores modifiers that are not configured", () => {
    expect(
      isModifierHeld(
        held({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true }),
        ["alt"],
      ),
    ).toBe(true);
  });

  it("supports every documented modifier", () => {
    expect(isModifierHeld(held({ ctrlKey: true }), ["ctrl"])).toBe(true);
    expect(isModifierHeld(held({ metaKey: true }), ["meta"])).toBe(true);
    expect(isModifierHeld(held({ shiftKey: true }), ["shift"])).toBe(true);
    expect(isModifierHeld(held({}), ["ctrl"])).toBe(false);
    expect(isModifierHeld(held({}), ["meta"])).toBe(false);
    expect(isModifierHeld(held({}), ["shift"])).toBe(false);
  });
});
