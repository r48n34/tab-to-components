import { describe, expect, it } from "vitest";

import {
  buildOpenEditorRequest,
  formatEditorTarget,
  normalizePluginBase,
  normalizePluginEndpoint,
  normalizePluginRoot,
  parsePluginInfo,
  pluginOpenFailureMessage,
  readPluginInfo,
  type PluginInfo,
} from "../lib/plugin-editor";

const PLUGIN: PluginInfo = {
  base: "/",
  editorEndpoint: "__ttc/open-in-editor",
  root: "D:/projects/app",
};

describe("normalizePluginBase", () => {
  it("accepts dev-server bases with leading and trailing slashes", () => {
    expect(normalizePluginBase("/")).toBe("/");
    expect(normalizePluginBase("/app/")).toBe("/app/");
    expect(normalizePluginBase("/nested/app/")).toBe("/nested/app/");
  });

  it("rejects bases the plugin could not have produced", () => {
    expect(normalizePluginBase("")).toBeNull();
    expect(normalizePluginBase("app/")).toBeNull();
    expect(normalizePluginBase("/app")).toBeNull();
    expect(normalizePluginBase("//app/")).toBeNull();
    expect(normalizePluginBase("/../app/")).toBeNull();
    expect(normalizePluginBase("/app x/")).toBeNull();
    expect(normalizePluginBase(42)).toBeNull();
    expect(normalizePluginBase(`/${"a".repeat(300)}/`)).toBeNull();
  });
});

describe("normalizePluginEndpoint", () => {
  it("trims and strips a leading slash", () => {
    expect(normalizePluginEndpoint("__ttc/open-in-editor")).toBe(
      "__ttc/open-in-editor",
    );
    expect(normalizePluginEndpoint("/__ttc/open-in-editor")).toBe(
      "__ttc/open-in-editor",
    );
    expect(normalizePluginEndpoint("  __open-in-editor  ")).toBe(
      "__open-in-editor",
    );
  });

  it("rejects empty, traversal and oversized endpoints", () => {
    expect(normalizePluginEndpoint("")).toBeNull();
    expect(normalizePluginEndpoint("/")).toBeNull();
    expect(normalizePluginEndpoint("a//b")).toBeNull();
    expect(normalizePluginEndpoint("../editor")).toBeNull();
    expect(normalizePluginEndpoint("a b")).toBeNull();
    expect(normalizePluginEndpoint("x".repeat(300))).toBeNull();
  });
});

describe("normalizePluginRoot", () => {
  it("normalizes separators and drops a trailing slash", () => {
    expect(normalizePluginRoot("D:\\projects\\app\\")).toBe("D:/projects/app");
    expect(normalizePluginRoot("/home/dev/app/")).toBe("/home/dev/app");
    expect(normalizePluginRoot("/")).toBe("/");
  });

  it("rejects relative roots and non-strings", () => {
    expect(normalizePluginRoot("src")).toBeNull();
    expect(normalizePluginRoot("")).toBeNull();
    expect(normalizePluginRoot(null)).toBeNull();
  });
});

describe("parsePluginInfo", () => {
  it("reads the three fields the extension needs", () => {
    expect(
      parsePluginInfo({
        version: "0.1.0",
        base: "/",
        root: "D:/projects/app",
        editorEndpoint: "__ttc/open-in-editor",
      }),
    ).toEqual(PLUGIN);
  });

  it("returns null when a required field is missing or invalid", () => {
    expect(parsePluginInfo(null)).toBeNull();
    expect(parsePluginInfo("config")).toBeNull();
    expect(parsePluginInfo({ base: "/", root: "D:/projects/app" })).toBeNull();
    expect(
      parsePluginInfo({
        base: "app",
        root: "D:/projects/app",
        editorEndpoint: "__ttc/open-in-editor",
      }),
    ).toBeNull();
  });
});

describe("readPluginInfo", () => {
  it("reads the config the plugin injects into the page", () => {
    expect(
      readPluginInfo({
        __TTC_CONFIG__: {
          base: "/",
          editorEndpoint: "__ttc/open-in-editor",
          root: "D:/projects/app",
        },
      }),
    ).toEqual(PLUGIN);  });

  it("returns null for pages without the plugin", () => {
    expect(readPluginInfo(globalThis)).toBeNull();
    expect(readPluginInfo({ __TTC_CONFIG__: {} })).toBeNull();
  });
});

describe("formatEditorTarget", () => {
  it("prefers an absolute path over the project-relative one", () => {
    expect(
      formatEditorTarget(
        {
          file: "src/App.tsx",
          relativeFile: "src/App.tsx",
          absoluteFile: "D:/projects/app/src/App.tsx",
          line: 20,
          column: 9,
        },
        PLUGIN.root,
      ),
    ).toBe("D:/projects/app/src/App.tsx:20:9");
  });

  it("joins a relative path onto the plugin root", () => {
    expect(
      formatEditorTarget(
        {
          file: "src/App.tsx",
          relativeFile: "src/App.tsx",
          absoluteFile: null,
          line: 3,
          column: 1,
        },
        "D:/projects/app/",
      ),
    ).toBe("D:/projects/app/src/App.tsx:3:1");
  });

  it("returns null without a usable path or position", () => {
    expect(
      formatEditorTarget(
        {
          file: "src/App.tsx",
          relativeFile: "src/App.tsx",
          absoluteFile: null,
          line: 1,
          column: 1,
        },
        null,
      ),
    ).toBeNull();
    expect(
      formatEditorTarget(
        {
          file: "/home/dev/app/src/App.tsx",
          relativeFile: null,
          absoluteFile: "/home/dev/app/src/App.tsx",
          line: 0,
          column: 1,
        },
        PLUGIN.root,
      ),
    ).toBeNull();
  });
});

describe("buildOpenEditorRequest", () => {
  it("points at the endpoint below the dev-server base", () => {
    const target = "D:/projects/app/src/App.tsx:20:9";
    expect(buildOpenEditorRequest(PLUGIN, target)).toBe(
      `/${PLUGIN.editorEndpoint}?file=${encodeURIComponent(target)}`,
    );
    expect(
      buildOpenEditorRequest({ ...PLUGIN, base: "/app/" }, "D:/a.tsx:1:2"),
    ).toBe(
      `/app/${PLUGIN.editorEndpoint}?file=${encodeURIComponent("D:/a.tsx:1:2")}`,
    );
  });
});

describe("pluginOpenFailureMessage", () => {
  it("explains the common endpoint rejections", () => {
    expect(pluginOpenFailureMessage(400)).toMatch(/project root/);
    expect(pluginOpenFailureMessage(403)).toMatch(/refused this page/);
    expect(pluginOpenFailureMessage(405)).toMatch(/method/);
    expect(pluginOpenFailureMessage(500)).toBe(
      "The Vite plugin could not open the file (HTTP 500).",
    );
  });
});
