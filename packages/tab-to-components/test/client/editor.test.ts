import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildEditorUrl,
  openInEditor,
  resolveConfig,
  resolveEditorPath,
  resolveEditorTarget,
  type ClientConfig,
  type EditorIde,
  type SourceMarker,
} from "../../src/client/index";

const MARKER: SourceMarker = {
  file: "app/routes/home.tsx",
  line: 19,
  column: 7,
};

const PLAIN_URL =
  "/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7";
const FULL_PATH = "D:/proj/app/routes/home.tsx:19:7";

function ideUrl(ide: EditorIde, base = "/__open-in-editor"): string {
  return `${base}?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7&ide=${ide}`;
}

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

  it("appends the ide as the only extra query parameter", () => {
    expect(buildEditorUrl(MARKER, makeConfig(), "webstorm")).toBe(
      ideUrl("webstorm"),
    );
    expect(buildEditorUrl(MARKER, makeConfig(), "code")).toBe(ideUrl("code"));
  });

  it("keeps the plain url byte-identical when no ide is requested", () => {
    expect(buildEditorUrl(MARKER, makeConfig())).toBe(PLAIN_URL);
    expect(buildEditorUrl(MARKER, makeConfig(), undefined)).toBe(PLAIN_URL);
    expect(buildEditorUrl(MARKER, makeConfig(), null)).toBe(PLAIN_URL);
  });

  it("respects a non-root base and a custom endpoint when an ide is given", () => {
    expect(
      buildEditorUrl(
        MARKER,
        makeConfig({ base: "/app/", editorEndpoint: "editor" }),
        "cursor",
      ),
    ).toBe(ideUrl("cursor", "/app/editor"));
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

  it("carries the ide into the resolved target", () => {
    for (const ide of ["code", "cursor", "webstorm", "trae"] as EditorIde[]) {
      expect(resolveEditorTarget(makeConfig(), MARKER, ide), ide).toEqual({
        url: ideUrl(ide),
        fullPath: FULL_PATH,
      });
    }
  });

  it("leaves the resolved target untouched without an ide", () => {
    expect(resolveEditorTarget(makeConfig(), MARKER, undefined)).toEqual(
      resolveEditorTarget(makeConfig(), MARKER),
    );
    expect(resolveEditorTarget(makeConfig(), MARKER, null)).toEqual(
      resolveEditorTarget(makeConfig(), MARKER),
    );
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

  it("passes the ide through as the only extra fetch argument", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(
      openInEditor(makeConfig(), MARKER, { fetchImpl, ide: "cursor" }),
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toEqual([ideUrl("cursor")]);
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

  it("names the chosen IDE in the non-OK message", async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }));
    await expect(
      openInEditor(makeConfig(), MARKER, { fetchImpl, onError, ide: "webstorm" }),
    ).resolves.toBe(false);

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0] as [string])[0]).toBe(
      `Could not open in WebStorm. Copy: ${FULL_PATH}`,
    );
  });

  it("names the chosen IDE in the network-error message", async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(
      openInEditor(makeConfig(), MARKER, { fetchImpl, onError, ide: "webstorm" }),
    ).resolves.toBe(false);

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0] as [string])[0]).toBe(
      `Could not open in WebStorm (network down). Copy: ${FULL_PATH}`,
    );
  });

  it("names the chosen IDE when fetch is unavailable", async () => {
    vi.stubGlobal("fetch", undefined);
    const onError = vi.fn();
    await expect(
      openInEditor(makeConfig(), MARKER, { onError, ide: "webstorm" }),
    ).resolves.toBe(false);

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0] as [string])[0]).toBe(
      `Could not open in WebStorm (fetch unavailable). Copy: ${FULL_PATH}`,
    );
  });

  it("keeps the plain error messages without an ide", async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }));
    await expect(
      openInEditor(makeConfig(), MARKER, { fetchImpl, onError }),
    ).resolves.toBe(false);
    expect((onError.mock.calls[0] as [string])[0]).toBe(
      `Could not open editor. Copy: ${FULL_PATH}`,
    );

    vi.stubGlobal("fetch", undefined);
    const onNoFetchError = vi.fn();
    await expect(
      openInEditor(makeConfig(), MARKER, { onError: onNoFetchError }),
    ).resolves.toBe(false);
    expect((onNoFetchError.mock.calls[0] as [string])[0]).toBe(
      `Could not open editor (fetch unavailable). Copy: ${FULL_PATH}`,
    );
  });

  it("refuses traversal and absolute markers without calling fetch", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const onError = vi.fn();

    for (const file of [
      "../outside.tsx",
      "app/../../outside.tsx",
      "/etc/passwd",
      "D:/outside/file.tsx",
      "C:\\outside\\file.tsx",
    ]) {
      await expect(
        openInEditor(
          makeConfig(),
          { file, line: 1, column: 1 },
          { fetchImpl, onError },
        ),
        file,
      ).resolves.toBe(false);
    }

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(5);
    expect(String(onError.mock.calls[0]?.[0] ?? "")).toContain(
      "invalid source location",
    );
  });

  it("refuses markers with an invalid line or column", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const onError = vi.fn();

    await expect(
      openInEditor(
        makeConfig(),
        { file: "app/routes/home.tsx", line: 0, column: 7 },
        { fetchImpl, onError },
      ),
    ).resolves.toBe(false);
    await expect(
      openInEditor(
        makeConfig(),
        { file: "app/routes/home.tsx", line: 1.5, column: 7 },
        { fetchImpl, onError },
      ),
    ).resolves.toBe(false);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
