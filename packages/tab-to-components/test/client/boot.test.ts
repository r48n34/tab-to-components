// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uninstall, type ClientConfig } from "../../src/client/index";

const CONFIG: ClientConfig = {
  version: "9.9.9",
  root: "D:/proj",
  base: "/",
  keyboard: ["alt"],
  open: "component",
  clickActions: ["open", "copy-file"],
  menu: true,
  theme: "dark",
  editorEndpoint: "__open-in-editor",
};

beforeEach(() => {
  uninstall();
  globalThis.__TTC_CONFIG__ = undefined;
  globalThis.__TTC_READY__ = undefined;
  globalThis.__TTC_VERSION__ = undefined;
  document.body.innerHTML = "";
});

afterEach(() => {
  uninstall();
  globalThis.__TTC_CONFIG__ = undefined;
  globalThis.__TTC_READY__ = undefined;
  globalThis.__TTC_VERSION__ = undefined;
  vi.resetModules();
});

describe("client entry boot", () => {
  it("installs automatically when the plugin's config prelude has run", async () => {
    globalThis.__TTC_CONFIG__ = CONFIG;
    vi.resetModules();

    await import("../../src/client/index");

    expect(globalThis.__TTC_READY__).toBe(true);
    expect(globalThis.__TTC_INSTALLED__).toBe(true);
    expect(globalThis.__TTC_VERSION__).toBe(CONFIG.version);
    expect(document.querySelector("[data-ttc-ui]")).not.toBeNull();
  });

  it("does nothing when the config prelude is absent", async () => {
    vi.resetModules();

    await import("../../src/client/index");

    expect(globalThis.__TTC_READY__).not.toBe(true);
    expect(globalThis.__TTC_INSTALLED__).not.toBe(true);
    expect(globalThis.__TTC_VERSION__).toBeUndefined();
    expect(document.querySelector("[data-ttc-ui]")).toBeNull();
  });

  it("remains a single overlay when the module is evaluated twice", async () => {
    globalThis.__TTC_CONFIG__ = CONFIG;

    vi.resetModules();
    await import("../../src/client/index");
    vi.resetModules();
    await import("../../src/client/index");

    expect(document.querySelectorAll("[data-ttc-ui]")).toHaveLength(1);
    expect(globalThis.__TTC_READY__).toBe(true);
  });
});
