import { describe, expect, it } from "vitest";

import {
  DEFAULT_EDITOR_SETTING,
  EDITOR_PRESETS,
  LaunchLimiter,
  buildEditorUrl,
  editorPresetLabel,
  encodePathForUrl,
  expandEditorUrl,
  isAllowedEditorScheme,
  isAllowedEditorUrl,
  isEditorPresetId,
  resolveEditorTemplate,
  toFileUri,
} from "../lib/editor";
import type { SourceLocation } from "../lib/source/location";
import { createSourceResolver } from "../lib/source/resolve";
import { viteModuleNoMapFile as noFileFixture } from "./fixtures/vite-react19-no-map-file";

function location(overrides: Partial<SourceLocation> = {}): SourceLocation {
  return {
    file: "src/App.tsx",
    relativeFile: "src/App.tsx",
    absoluteFile: "D:/proj/src/App.tsx",
    line: 12,
    column: 5,
    source: "marker",
    ...overrides,
  };
}

describe("editor presets", () => {
  it("lists the supported presets and validates ids", () => {
    const ids = EDITOR_PRESETS.map((preset) => preset.id);
    expect(ids).toContain("vscode");
    expect(ids).toContain("cursor");
    expect(ids).toContain("custom");
    expect(isEditorPresetId("zed")).toBe(true);
    expect(isEditorPresetId("nope")).toBe(false);
    expect(editorPresetLabel({ preset: "vscode", template: "" })).toBe("VS Code");
  });

  it("resolves preset templates and custom templates", () => {
    expect(resolveEditorTemplate({ preset: "vscode", template: "" })).toBe(
      "vscode://file/{path}:{line}:{column}",
    );
    expect(resolveEditorTemplate({ preset: "custom", template: "  " })).toBeNull();
    expect(
      resolveEditorTemplate({ preset: "custom", template: "x://{path}" }),
    ).toBe("x://{path}");
  });
});

describe("expandEditorUrl", () => {
  it("builds a VS Code URL from an absolute path", () => {
    const result = expandEditorUrl("vscode://file/{path}:{line}:{column}", {
      location: location(),
      root: null,
    });
    expect(result).toEqual({ url: "vscode://file/D:/proj/src/App.tsx:12:5" });
  });

  it("keeps the full Windows absolute path requested by VS Code", () => {
    const result = expandEditorUrl("vscode://file/{path}:{line}:{column}", {
      location: location({
        file: "popup.tsx",
        relativeFile: "packages/tab-to-components-extension/popup.tsx",
        absoluteFile:
          "C:/Users/reemo/Documents/GitHub/tab-to-components/packages/tab-to-components-extension/popup.tsx",
      }),
      root: null,
    });
    expect(result).toEqual({
      url: "vscode://file/C:/Users/reemo/Documents/GitHub/tab-to-components/packages/tab-to-components-extension/popup.tsx:12:5",
    });
    if ("url" in result) expect(isAllowedEditorUrl(result.url)).toBe(true);
  });

  it("percent-encodes spaces and unicode in the path", () => {
    const result = expandEditorUrl("vscode://file/{path}:{line}:{column}", {
      location: location({ absoluteFile: "D:/proj/my app/src/héllo.tsx" }),
      root: null,
    });
    expect("url" in result && result.url).toBe(
      "vscode://file/D:/proj/my%20app/src/h%C3%A9llo.tsx:12:5",
    );
  });

  it("builds the absolute path from a configured project root", () => {
    const result = buildEditorUrl(
      { preset: "vscode", template: "" },
      {
        location: location({ absoluteFile: null }),
        root: "D:/proj",
      },
    );
    expect("url" in result && result.url).toBe(
      "vscode://file/D:/proj/src/App.tsx:12:5",
    );
  });

  it("requires a project root for templates that need an absolute path", () => {
    const result = expandEditorUrl("vscode://file/{path}:{line}:{column}", {
      location: location({ absoluteFile: null }),
      root: null,
    });
    expect("error" in result && result.error).toMatch(/project root/i);
  });

  it("supports relative and file-URI placeholders", () => {
    const relative = expandEditorUrl("myide://open?file={file}&line={line}", {
      location: location(),
      root: null,
    });
    expect("url" in relative && relative.url).toBe(
      "myide://open?file=src/App.tsx&line=12",
    );
    const fileUri = expandEditorUrl("myide://open?url={fileUri}", {
      location: location(),
      root: null,
    });
    expect("url" in fileUri && fileUri.url).toBe(
      "myide://open?url=file:///D:/proj/src/App.tsx",
    );
  });

  it("rejects script schemes, scheme-less templates and over-long URLs", () => {
    expect(
      "error" in
        expandEditorUrl("javascript:alert(1)", { location: location(), root: null }),
    ).toBe(true);
    expect(
      "error" in expandEditorUrl("no-scheme-here", { location: location(), root: null }),
    ).toBe(true);
    expect(
      "error" in
        expandEditorUrl("x://{path}".concat("a".repeat(5000)), {
          location: location(),
          root: null,
        }),
    ).toBe(true);
    expect(expandEditorUrl("   ", { location: location(), root: null })).toEqual({
      error: "No editor URL template is configured.",
    });
  });
});

describe("Open in IDE with a React 19 / Vite location", () => {
  it("builds vscode://file/<absolute> without a configured project root", async () => {
    const resolver = createSourceResolver({
      pageOrigin: "http://localhost:5173",
      projectRoot: null,
      fetchText: async (url) =>
        url === noFileFixture.moduleUrl ? noFileFixture.code : null,
    });
    const resolved = await resolver.resolve({
      name: "Button",
      isHost: false,
      stackFrame: {
        url: noFileFixture.moduleUrl,
        line: noFileFixture.generated.line,
        column: noFileFixture.generated.column,
      },
    });
    if (resolved.location === null) throw new Error("expected a location");

    const result = buildEditorUrl(DEFAULT_EDITOR_SETTING, {
      location: resolved.location,
      root: null,
    });

    expect(result).toEqual({
      url: `vscode://file/${noFileFixture.expected.absoluteFile}:20:9`,
    });
  });
});

describe("scheme helpers", () => {  it("allows editor schemes and blocks script/navigation schemes", () => {
    expect(isAllowedEditorScheme("vscode")).toBe(true);
    expect(isAllowedEditorScheme("cursor")).toBe(true);
    expect(isAllowedEditorScheme("javascript")).toBe(false);
    expect(isAllowedEditorScheme("data")).toBe(false);
    expect(isAllowedEditorScheme("file")).toBe(false);
    expect(isAllowedEditorScheme("https")).toBe(false);
    expect(isAllowedEditorUrl("vscode://file/D:/proj/src/App.tsx:1:1")).toBe(true);
    expect(isAllowedEditorUrl("javascript:alert(1)")).toBe(false);
  });

  it("encodes paths and file URIs", () => {
    expect(encodePathForUrl("D:\\proj\\my app\\a.tsx")).toBe(
      "D:/proj/my%20app/a.tsx",
    );
    expect(toFileUri("D:/proj/src/App.tsx")).toBe("file:///D:/proj/src/App.tsx");
    expect(toFileUri("/home/dev/src/App.tsx")).toBe(
      "file:///home/dev/src/App.tsx",
    );
    expect(toFileUri("//server/share/a.tsx")).toBeNull();
  });
});

describe("LaunchLimiter", () => {
  it("coalesces duplicate and in-flight launches", () => {
    let now = 0;
    const limiter = new LaunchLimiter(() => now);
    expect(limiter.reserve("a")).toBe("allow");
    expect(limiter.reserve("a")).toBe("duplicate");
    limiter.release("a");
    expect(limiter.reserve("a")).toBe("duplicate");
    now = 600;
    expect(limiter.reserve("a")).toBe("allow");
  });

  it("caps launches per window", () => {
    const now = 5_000;
    const limiter = new LaunchLimiter(() => now);
    for (let index = 0; index < 10; index += 1) {
      expect(limiter.reserve(`target-${index}`)).toBe("allow");
      limiter.release(`target-${index}`);
    }
    expect(limiter.reserve("one-too-many")).toBe("limited");
  });

  it("allows launches again after the window passes", () => {
    let now = 0;
    const limiter = new LaunchLimiter(() => now);
    for (let index = 0; index < 10; index += 1) {
      expect(limiter.reserve(`target-${index}`)).toBe("allow");
      limiter.release(`target-${index}`);
    }
    expect(limiter.reserve("one-too-many")).toBe("limited");
    now = 70_000;
    expect(limiter.reserve("one-too-many")).toBe("allow");
  });
});

describe("DEFAULT_EDITOR_SETTING", () => {
  it("defaults to VS Code", () => {
    expect(DEFAULT_EDITOR_SETTING).toEqual({ preset: "vscode", template: "" });
  });
});
