import { describe, expect, it, vi } from "vitest";

import {
  createSourceMapResolver,
  decodeDataUrl,
  extractSourceMapUrl,
  parseSourceMap,
  pathsFromSource,
} from "../../lib/source/sourcemap";
import { viteReact19Module as fixture } from "../fixtures/vite-react19-module";

const ORIGIN = "http://localhost:5173";

function fixtureFetch() {
  return vi.fn(async (url: string) =>
    url === fixture.moduleUrl ? fixture.code : null,
  );
}

describe("source-map resolution with a real Vite module", () => {
  it("maps the generated jsxDEV call site to the original JSX location", async () => {
    const fetchText = fixtureFetch();
    const resolver = createSourceMapResolver({
      pageOrigin: ORIGIN,
      projectRoot: null,
      fetchText,
    });

    const location = await resolver.resolveFrame({
      url: fixture.moduleUrl,
      line: fixture.generated.line,
      column: fixture.generated.column,
    });

    expect(location).not.toBeNull();
    expect(location?.relativeFile).toBe(fixture.expected.relativeFile);
    expect(location?.absoluteFile).toBe(fixture.expected.absoluteFile);
    expect(location?.line).toBe(fixture.expected.line);
    expect(location?.column).toBe(fixture.expected.column);
    expect(location?.source).toBe("source-map");
    expect(location?.file).toBe("src/App.tsx");
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it("maps every JSX site in the fixture to the plugin's marker positions", async () => {
    const resolver = createSourceMapResolver({
      pageOrigin: ORIGIN,
      projectRoot: null,
      fetchText: fixtureFetch(),
    });
    for (const translation of fixture.translations) {
      const location = await resolver.resolveFrame({
        url: fixture.moduleUrl,
        line: translation.generated.line,
        column: translation.generated.column,
      });
      expect(location?.line).toBe(translation.original.line);
      expect(location?.column).toBe(translation.original.column);
    }
  });

  it("caches the fetched module and map per URL", async () => {
    const fetchText = fixtureFetch();
    const resolver = createSourceMapResolver({
      pageOrigin: ORIGIN,
      projectRoot: null,
      fetchText,
    });
    await resolver.resolveFrame({
      url: fixture.moduleUrl,
      line: fixture.generated.line,
      column: fixture.generated.column,
    });
    await resolver.resolveFrame({
      url: fixture.moduleUrl,
      line: fixture.generated.line,
      column: fixture.generated.column,
    });
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it("refetches when Vite's HMR timestamp changes the module URL", async () => {
    const fetchText = vi.fn(async (url: string) =>
      url.startsWith(`${ORIGIN}/src/App.tsx`) ? fixture.code : null,
    );
    const resolver = createSourceMapResolver({
      pageOrigin: ORIGIN,
      projectRoot: null,
      fetchText,
    });
    const frame = {
      line: fixture.generated.line,
      column: fixture.generated.column,
    };
    await resolver.resolveFrame({ url: `${ORIGIN}/src/App.tsx?t=1`, ...frame });
    await resolver.resolveFrame({ url: `${ORIGIN}/src/App.tsx?t=2`, ...frame });
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  it("never fetches a cross-origin frame", async () => {
    const fetchText = fixtureFetch();
    const resolver = createSourceMapResolver({
      pageOrigin: ORIGIN,
      projectRoot: null,
      fetchText,
    });
    const location = await resolver.resolveFrame({
      url: "http://evil.example/src/App.tsx",
      line: 1,
      column: 1,
    });
    expect(location).toBeNull();
    expect(fetchText).not.toHaveBeenCalled();
  });

  it("resolves an external sourceMappingURL file", async () => {
    const inlineUrl = extractSourceMapUrl(fixture.code);
    if (inlineUrl === null) throw new Error("fixture has no inline map");
    const mapJson = decodeDataUrl(inlineUrl);
    if (mapJson === null) throw new Error("fixture map does not decode");
    const code = fixture.code.replace(
      /\/\/# sourceMappingURL=\S+\s*$/,
      "//# sourceMappingURL=App.tsx.map",
    );
    const fetchText = vi.fn(async (url: string) => {
      if (url === fixture.moduleUrl) return code;
      if (url === `${ORIGIN}/src/App.tsx.map`) return mapJson;
      return null;
    });
    const resolver = createSourceMapResolver({
      pageOrigin: ORIGIN,
      projectRoot: null,
      fetchText,
    });
    const location = await resolver.resolveFrame({
      url: fixture.moduleUrl,
      line: fixture.generated.line,
      column: fixture.generated.column,
    });
    expect(location?.line).toBe(fixture.expected.line);
    expect(location?.column).toBe(fixture.expected.column);
  });

  it("returns null when the module or map is unavailable", async () => {
    const resolver = createSourceMapResolver({
      pageOrigin: ORIGIN,
      projectRoot: null,
      fetchText: async () => null,
    });
    expect(
      await resolver.resolveFrame({
        url: fixture.moduleUrl,
        line: 1,
        column: 1,
      }),
    ).toBeNull();
  });
});

describe("decodeDataUrl", () => {
  it("decodes base64 payloads including non-ASCII content", () => {
    const text = '{"sources":["héllo.tsx"]}';
    const encoded = Buffer.from(text, "utf8").toString("base64");
    expect(decodeDataUrl(`data:application/json;base64,${encoded}`)).toBe(text);
    expect(
      decodeDataUrl(`data:application/json;charset=utf-8;base64,${encoded}`),
    ).toBe(text);
  });

  it("decodes percent-encoded payloads", () => {
    expect(
      decodeDataUrl(
        `data:application/json;charset=utf-8,${encodeURIComponent('{"a":1}')}`,
      ),
    ).toBe('{"a":1}');
  });

  it("returns null for non-data or malformed URLs", () => {
    expect(decodeDataUrl("https://example.com/a.map")).toBeNull();
    expect(decodeDataUrl("data:application/json")).toBeNull();
  });
});

describe("extractSourceMapUrl", () => {
  it("returns the last sourceMappingURL comment", () => {
    const code = "a\n//# sourceMappingURL=one.map\nb\n//# sourceMappingURL=two.map\n";
    expect(extractSourceMapUrl(code)).toBe("two.map");
  });

  it("returns null when the module has no map", () => {
    expect(extractSourceMapUrl("const a = 1;\n")).toBeNull();
  });
});

describe("parseSourceMap", () => {
  it("accepts a version 3 map and rejects invalid payloads", () => {
    expect(
      parseSourceMap('{"version":3,"sources":["a.tsx"],"mappings":"AAAA"}')?.sources,
    ).toEqual(["a.tsx"]);
    expect(parseSourceMap("not json")).toBeNull();
    expect(parseSourceMap('{"version":2,"sources":[],"mappings":""}')).toBeNull();
    expect(parseSourceMap('{"version":3,"sources":[]}')).toBeNull();
    expect(parseSourceMap("")).toBeNull();
  });
});

describe("pathsFromSource", () => {
  const moduleUrl = `${ORIGIN}/src/App.tsx?t=1`;

  it("turns server-relative sources into project-relative paths", () => {
    expect(pathsFromSource("App.tsx", moduleUrl, "/")).toEqual({
      relativeFile: "src/App.tsx",
      absoluteFile: null,
    });
    expect(pathsFromSource("/src/App.tsx", moduleUrl, "/")).toEqual({
      relativeFile: "src/App.tsx",
      absoluteFile: null,
    });
  });

  it("strips the configured Vite base", () => {
    expect(
      pathsFromSource("/app/src/App.tsx", `${ORIGIN}/app/src/App.tsx`, "/app/"),
    ).toEqual({ relativeFile: "src/App.tsx", absoluteFile: null });
  });

  it("recovers /@fs/ and file:// absolute paths", () => {
    expect(
      pathsFromSource("/@fs/D:/proj/src/App.tsx", moduleUrl, "/"),
    ).toEqual({ relativeFile: null, absoluteFile: "D:/proj/src/App.tsx" });
    expect(
      pathsFromSource("file:///home/dev/app/src/App.tsx", moduleUrl, "/"),
    ).toEqual({ relativeFile: null, absoluteFile: "/home/dev/app/src/App.tsx" });
  });

  it("normalizes webpack namespaces", () => {
    expect(pathsFromSource("webpack://app/./src/App.tsx", moduleUrl, "/")).toEqual(
      { relativeFile: "src/App.tsx", absoluteFile: null },
    );
    expect(pathsFromSource("webpack:///./src/App.tsx", moduleUrl, "/")).toEqual({
      relativeFile: "src/App.tsx",
      absoluteFile: null,
    });
  });

  it("rejects unknown schemes and empty sources", () => {
    expect(pathsFromSource("data:text/plain,hello", moduleUrl, "/")).toEqual({
      relativeFile: null,
      absoluteFile: null,
    });
    expect(pathsFromSource("", moduleUrl, "/")).toEqual({
      relativeFile: null,
      absoluteFile: null,
    });
  });
});
