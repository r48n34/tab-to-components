import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildEditorUrl,
  openInEditor,
  resolveConfig,
  resolveEditorPath,
  resolveEditorTarget,
  type ClientConfig,
  type SourceMarker,
} from "../../src/client/index";

const MARKER: SourceMarker = {
  file: "app/routes/home.tsx",
  line: 19,
  column: 7,
};

function makeConfig(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return resolveConfig({
    version: "0.1.0",
    root: "D:/proj",
    base: "/",
    editorEndpoint: "__open-in-editor",
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildEditorUrl", () => {
  it("builds the exact Vite open-in-editor GET url", () => {
    expect(buildEditorUrl(MARKER, makeConfig())).toBe(
      "/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7",
    );
  });

  it("accepts a chain entry as well as a bare marker", () => {
    const entry = { name: "Button", isHost: false, marker: MARKER };
    expect(buildEditorUrl(entry, makeConfig())).toBe(
      buildEditorUrl(MARKER, makeConfig()),
    );
  });

  it("respects a non-root base and a custom endpoint", () => {
    expect(
      buildEditorUrl(MARKER, makeConfig({ base: "/app/", editorEndpoint: "editor" })),
    ).toBe("/app/editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7");
  });

  it("normalizes a missing trailing base slash and a leading endpoint slash", () => {
    expect(
      buildEditorUrl(MARKER, {
        root: "D:/proj",
        base: "/app",
        editorEndpoint: "/__open-in-editor",
      } as never),
    ).toBe("/app/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7");
  });

  it("joins root and relative path with forward slashes", () => {
    expect(
      buildEditorUrl(
        { file: "app/components/Button.tsx", line: 6, column: 10 },
        { root: "D:\\proj\\", base: "/", editorEndpoint: "__open-in-editor" },
      ),
    ).toBe("/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Fcomponents%2FButton.tsx%3A6%3A10");
  });
});

describe("resolveEditorPath / resolveEditorTarget", () => {
  it("returns the full path:line:column sent to the editor server", () => {
    expect(resolveEditorPath(MARKER, makeConfig())).toBe(
      "D:/proj/app/routes/home.tsx:19:7",
    );
    expect(resolveEditorTarget(makeConfig(), MARKER)).toEqual({
      url: "/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7",
      fullPath: "D:/proj/app/routes/home.tsx:19:7",
    });
  });
});

describe("openInEditor", () => {
  it("calls fetch once with the url and no other parameters", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(
      openInEditor(makeConfig(), MARKER, { fetchImpl }),
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toEqual([
      "/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7",
    ]);
    expect(fetchImpl.mock.calls[0]).toHaveLength(1);
  });

  it("reports non-OK responses without throwing and includes the copyable path", async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }));
    await expect(
      openInEditor(makeConfig(), MARKER, { fetchImpl, onError }),
    ).resolves.toBe(false);

    expect(onError).toHaveBeenCalledTimes(1);
    const [message] = onError.mock.calls[0] as [string];
    expect(message).toContain("D:/proj/app/routes/home.tsx:19:7");
  });

  it("swallows network errors and still reports the path", async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(
      openInEditor(makeConfig(), MARKER, { fetchImpl, onError }),
    ).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0] as [string])[0]).toContain(
      "D:/proj/app/routes/home.tsx:19:7",
    );
  });

  it("never throws when fetch is unavailable", async () => {
    vi.stubGlobal("fetch", undefined);
    const onError = vi.fn();
    await expect(openInEditor(makeConfig(), MARKER, { onError })).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
