import { describe, expect, it } from "vitest";

import {
  applyPluginSettings,
  parsePluginConfig,
  readPluginConfig,
} from "../lib/plugin-config";
import { DEFAULT_SETTINGS, normalizeSettings } from "../lib/settings";

const RAW = {
  base: "/app/",
  editorEndpoint: "__ttc/open-in-editor",
  root: "D:/projects/app",
  keyboard: ["ctrl", "ctrl", "shift"],
  open: "element",
  clickActions: ["open", "copy-file", "open", "nope"],
  menu: false,
  theme: "light",
  crosshair: "x",
  crosshairUnit: ["px", "cm", "px"],
  crosshairLineColor: " #ff3355 ",
  crosshairTextColor: "tomato",
  crosshairPointKey: " P ",
};

describe("parsePluginConfig", () => {
  it("reads the full plugin configuration", () => {
    expect(parsePluginConfig(RAW)).toEqual({
      base: "/app/",
      editorEndpoint: "__ttc/open-in-editor",
      root: "D:/projects/app",
      keyboard: ["ctrl", "shift"],
      open: "element",
      clickActions: ["open", "copy-file"],
      menu: false,
      theme: "light",
      crosshair: "x",
      crosshairUnit: ["px", "cm"],
      crosshairLineColor: "#ff3355",
      crosshairTextColor: "tomato",
      crosshairPointKey: "p",
    });
  });

  it("falls back to the extension defaults for missing or invalid options", () => {
    const parsed = parsePluginConfig({
      base: "/",
      editorEndpoint: "__ttc/open-in-editor",
      root: "D:/projects/app",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.keyboard).toEqual(DEFAULT_SETTINGS.keyboard);
    expect(parsed?.open).toBe(DEFAULT_SETTINGS.open);
    expect(parsed?.clickActions).toEqual(DEFAULT_SETTINGS.clickActions);
    expect(parsed?.menu).toBe(DEFAULT_SETTINGS.menu);
    expect(parsed?.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(parsed?.crosshair).toBe(DEFAULT_SETTINGS.crosshair);
    expect(parsed?.crosshairUnit).toEqual(DEFAULT_SETTINGS.crosshairUnit);
    expect(parsed?.crosshairPointKey).toBe(DEFAULT_SETTINGS.crosshairPointKey);
  });

  it("drops plugin-only click actions the extension cannot perform", () => {
    const parsed = parsePluginConfig({
      ...RAW,
      clickActions: ["open-code", "copy-location"],
    });
    expect(parsed?.clickActions).toEqual(["copy-location"]);
    expect(
      parsePluginConfig({ ...RAW, clickActions: ["open-code"] })?.clickActions,
    ).toEqual(DEFAULT_SETTINGS.clickActions);
  });

  it("rejects values without a usable endpoint configuration", () => {
    expect(parsePluginConfig(null)).toBeNull();
    expect(parsePluginConfig("nope")).toBeNull();
    expect(parsePluginConfig({ ...RAW, base: "app/" })).toBeNull();
    expect(parsePluginConfig({ base: "/", root: "D:/projects/app" })).toBeNull();
  });
});

describe("readPluginConfig", () => {
  it("reads __TTC_CONFIG__ from the page scope", () => {
    expect(readPluginConfig({ __TTC_CONFIG__: RAW })?.base).toBe("/app/");
    expect(readPluginConfig({})).toBeNull();
    expect(readPluginConfig(null)).toBeNull();
  });
});

describe("applyPluginSettings", () => {
  it("borrows only the plugin's overlay options", () => {
    const settings = normalizeSettings({
      enabled: false,
      disabledOrigins: ["http://localhost:5173"],
      projectRoots: { "http://localhost:5173": "D:/proj" },
      debug: true,
      settingsSource: "plugin",
    });
    const parsed = parsePluginConfig(RAW);
    if (parsed === null) throw new Error("expected plugin config");

    const merged = applyPluginSettings(settings, parsed);
    expect(merged.keyboard).toEqual(["ctrl", "shift"]);
    expect(merged.open).toBe("element");
    expect(merged.clickActions).toEqual(["open", "copy-file"]);
    expect(merged.menu).toBe(false);
    expect(merged.theme).toBe("light");
    expect(merged.crosshair).toBe("x");
    expect(merged.crosshairUnit).toEqual(["px", "cm"]);
    expect(merged.crosshairLineColor).toBe("#ff3355");
    expect(merged.crosshairTextColor).toBe("tomato");
    expect(merged.crosshairPointKey).toBe("p");
    // Local state stays local.
    expect(merged.enabled).toBe(false);
    expect(merged.disabledOrigins).toEqual(["http://localhost:5173"]);
    expect(merged.projectRoots).toEqual({ "http://localhost:5173": "D:/proj" });
    expect(merged.debug).toBe(true);
    expect(merged.settingsSource).toBe("plugin");
    // No mutation of the stored settings.
    expect(settings.keyboard).toEqual(DEFAULT_SETTINGS.keyboard);
  });

  it("clears extension-local colors when the plugin does not set them", () => {
    const parsed = parsePluginConfig({
      base: "/",
      editorEndpoint: "__ttc/open-in-editor",
      root: "D:/projects/app",
    });
    if (parsed === null) throw new Error("expected plugin config");
    const merged = applyPluginSettings(
      {
        ...DEFAULT_SETTINGS,
        crosshairLineColor: "#123456",
        crosshairTextColor: "#abcdef",
      },
      parsed,
    );
    expect(merged.crosshairLineColor).toBeUndefined();
    expect(merged.crosshairTextColor).toBeUndefined();
  });
});
