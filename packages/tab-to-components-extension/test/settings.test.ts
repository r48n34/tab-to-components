import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  createChromeSettingsStore,
  createDefaultSettings,
  createMemorySettingsStore,
  isOriginDisabled,
  normalizeSettings,
  projectRootFor,
  setOriginDisabled,
  type ChromeStorageLike,
  type Settings,
  type StorageListener,
} from "../lib/settings";

describe("normalizeSettings", () => {
  it("returns the documented defaults for missing input", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(createDefaultSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and falls back for invalid ones", () => {
    const settings = normalizeSettings({
      enabled: false,
      keyboard: ["ctrl", "ctrl", "bogus", "shift"],
      open: "element",
      clickActions: ["copy-location", "copy-location", "nope"],
      menu: false,
      theme: "light",
      showWhenVitePluginActive: true,
      debug: true,
    });
    expect(settings.enabled).toBe(false);
    expect(settings.keyboard).toEqual(["ctrl", "shift"]);
    expect(settings.open).toBe("element");
    expect(settings.clickActions).toEqual(["copy-location"]);
    expect(settings.menu).toBe(false);
    expect(settings.theme).toBe("light");
    expect(settings.showWhenVitePluginActive).toBe(true);
    expect(settings.debug).toBe(true);
  });

  it("ignores unknown open modes, themes and action lists", () => {
    const settings = normalizeSettings({
      open: "nonsense",
      theme: "rainbow",
      clickActions: [],
      keyboard: [],
    });
    expect(settings.open).toBe(DEFAULT_SETTINGS.open);
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(settings.clickActions).toEqual(DEFAULT_SETTINGS.clickActions);
    expect(settings.keyboard).toEqual(DEFAULT_SETTINGS.keyboard);
  });

  it("normalizes editors", () => {
    expect(normalizeSettings({ editor: { preset: "cursor" } }).editor).toEqual({
      preset: "cursor",
      template: "",
    });
    expect(
      normalizeSettings({ editor: { preset: "custom", template: "  myide://{path}  " } })
        .editor,
    ).toEqual({ preset: "custom", template: "myide://{path}" });
    // An empty custom template is useless: fall back to the default editor.
    expect(normalizeSettings({ editor: { preset: "custom", template: "" } }).editor).toEqual(
      DEFAULT_SETTINGS.editor,
    );
    expect(normalizeSettings({ editor: { preset: "unknown" } }).editor).toEqual(
      DEFAULT_SETTINGS.editor,
    );
  });

  it("validates project roots and origins", () => {
    const settings = normalizeSettings({
      disabledOrigins: [
        "http://localhost:5173",
        "http://localhost:5173",
        "not a url::",
      ],
      projectRoots: {
        "http://localhost:5173": "D:\\proj\\app\\",
        "http://127.0.0.1:3000": "relative/path",
        "bogus": "D:/proj",
        "http://localhost:4000": "/home/dev/app",
      },
    });
    expect(settings.disabledOrigins).toEqual(["http://localhost:5173"]);
    expect(settings.projectRoots).toEqual({
      "http://localhost:5173": "D:/proj/app",
      "http://localhost:4000": "/home/dev/app",
      // A bare host is normalized to an http origin rather than dropped.
      "http://bogus": "D:/proj",
    });
  });
});

describe("settings helpers", () => {
  const settings: Settings = normalizeSettings({
    disabledOrigins: ["http://localhost:3000"],
    projectRoots: { "http://localhost:5173": "D:/proj" },
  });

  it("knows whether an origin is disabled", () => {
    expect(isOriginDisabled(settings, "http://localhost:3000")).toBe(true);
    expect(isOriginDisabled(settings, "http://localhost:5173")).toBe(false);
    expect(isOriginDisabled(settings, null)).toBe(false);
    expect(isOriginDisabled({ ...settings, enabled: false }, "http://localhost:5173")).toBe(
      true,
    );
  });

  it("resolves configured project roots", () => {
    expect(projectRootFor(settings, "http://localhost:5173")).toBe("D:/proj");
    expect(projectRootFor(settings, "http://localhost:9999")).toBeNull();
    expect(projectRootFor(settings, null)).toBeNull();
  });

  it("adds and removes disabled origins", () => {
    const disabled = setOriginDisabled(settings, "http://127.0.0.1:5173", true);
    expect(disabled.disabledOrigins).toContain("http://127.0.0.1:5173");
    const enabled = setOriginDisabled(disabled, "http://127.0.0.1:5173", false);
    expect(enabled.disabledOrigins).not.toContain("http://127.0.0.1:5173");
    // An invalid origin is ignored rather than corrupting the list.
    expect(setOriginDisabled(settings, "not a url::", true)).toBe(settings);
  });
});

describe("settings stores", () => {
  it("saves, loads and notifies through the memory store", async () => {
    const store = createMemorySettingsStore({ theme: "light" });
    const seen: Settings[] = [];
    const stop = store.watch((next) => seen.push(next));
    expect((await store.load()).theme).toBe("light");
    await store.save({ ...DEFAULT_SETTINGS, theme: "dark" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.theme).toBe("dark");
    stop();
    await store.save({ ...DEFAULT_SETTINGS, theme: "light" });
    expect(seen).toHaveLength(1);
  });

  it("round-trips settings through a chrome.storage-like API", async () => {
    const stored = new Map<string, unknown>();
    const listeners: StorageListener[] = [];
    const api: ChromeStorageLike = {
      local: {
        async get(keys) {
          const key = Array.isArray(keys) ? keys[0] : keys;
          return key !== undefined && stored.has(key)
            ? { [key]: stored.get(key) }
            : {};
        },
        async set(items) {
          for (const [key, value] of Object.entries(items)) stored.set(key, value);
        },
      },
      onChanged: {
        addListener(listener) {
          listeners.push(listener);
        },
        removeListener(listener) {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
      },
    };
    const store = createChromeSettingsStore(api);

    await store.save({ ...DEFAULT_SETTINGS, theme: "light", debug: true });
    expect(stored.has(SETTINGS_KEY)).toBe(true);
    const loaded = await store.load();
    expect(loaded.theme).toBe("light");
    expect(loaded.debug).toBe(true);

    const seen: Settings[] = [];
    const stop = store.watch((next) => seen.push(next));
    const listener = listeners[0];
    if (listener === undefined) throw new Error("watch did not register a listener");
    listener({ [SETTINGS_KEY]: { newValue: { theme: "dark" } } }, "local");
    expect(seen[0]?.theme).toBe("dark");
    // Changes outside the local area are ignored.
    listener({ [SETTINGS_KEY]: { newValue: { theme: "light" } } }, "sync");
    expect(seen).toHaveLength(1);
    stop();
    expect(listeners).toHaveLength(0);
  });
});
