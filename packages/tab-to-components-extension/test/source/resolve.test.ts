import { describe, expect, it } from "vitest";

import { createSourceResolver } from "../../lib/source/resolve";
import type { RawEntry } from "../../lib/protocol";
import { viteReact19Module as fixture } from "../fixtures/vite-react19-module";
import { viteModuleNoMapFile as noFileFixture } from "../fixtures/vite-react19-no-map-file";

const ORIGIN = "http://localhost:5173";

function fixtureFetch() {
  return async (url: string) => (url === fixture.moduleUrl ? fixture.code : null);
}

function noFileFetch() {
  return async (url: string) =>
    url === noFileFixture.moduleUrl ? noFileFixture.code : null;
}

function resolverWith(options: {
  projectRoot?: string | null;
  fetchText?: (url: string) => Promise<string | null>;
}) {
  return createSourceResolver({
    pageOrigin: ORIGIN,
    projectRoot: options.projectRoot ?? null,
    fetchText: options.fetchText ?? fixtureFetch(),
  });
}

describe("createSourceResolver", () => {
  it("resolves a Vite plugin marker and synthesizes the absolute path", async () => {
    const entry: RawEntry = {
      name: "Button",
      isHost: false,
      marker: "src/App.tsx:20:9",
    };
    const resolved = await resolverWith({ projectRoot: "D:/proj" }).resolve(entry);
    expect(resolved.name).toBe("Button");
    expect(resolved.location).toMatchObject({
      relativeFile: "src/App.tsx",
      absoluteFile: "D:/proj/src/App.tsx",
      line: 20,
      column: 9,
      source: "marker",
    });
  });

  it("resolves a React 18 _debugSource", async () => {
    const entry: RawEntry = {
      name: "Button",
      isHost: false,
      debugSource: {
        fileName: "D:/proj/src/App.tsx",
        lineNumber: 20,
        columnNumber: 9,
      },
    };
    const resolved = await resolverWith({ projectRoot: "D:/proj" }).resolve(entry);
    expect(resolved.location).toMatchObject({
      relativeFile: "src/App.tsx",
      absoluteFile: "D:/proj/src/App.tsx",
      line: 20,
      column: 9,
      source: "debug-source",
    });
  });

  it("merges a marker's relative path with the absolute path from _debugSource", async () => {
    const entry: RawEntry = {
      name: "Button",
      isHost: false,
      marker: "src/App.tsx:20:9",
      debugSource: {
        fileName: "D:/proj/src/App.tsx",
        lineNumber: 20,
        columnNumber: 9,
      },
    };
    const resolved = await resolverWith({ projectRoot: null }).resolve(entry);
    expect(resolved.location?.relativeFile).toBe("src/App.tsx");
    expect(resolved.location?.absoluteFile).toBe("D:/proj/src/App.tsx");
  });

  it("resolves a React 19 stack frame through the dev source map", async () => {
    const entry: RawEntry = {
      name: "Button",
      isHost: false,
      stackFrame: {
        url: fixture.moduleUrl,
        line: fixture.generated.line,
        column: fixture.generated.column,
      },
    };
    const resolved = await resolverWith({}).resolve(entry);
    expect(resolved.location).toMatchObject({
      relativeFile: "src/App.tsx",
      absoluteFile: "D:/proj/src/App.tsx",
      line: 20,
      column: 9,
      source: "source-map",
    });
  });

  it("returns a null location when no layer has evidence", async () => {
    const entry: RawEntry = { name: "button", isHost: true };
    const resolved = await resolverWith({}).resolve(entry);
    expect(resolved.location).toBeNull();
    expect(resolved.name).toBe("button");
  });

  it("ignores an unsafe marker", async () => {
    const entry: RawEntry = {
      name: "Button",
      isHost: false,
      marker: "../../secret.tsx:1:1",
    };
    const resolved = await resolverWith({}).resolve(entry);
    expect(resolved.location).toBeNull();
  });

  it("resolves a whole chain in order", async () => {
    const chain: RawEntry[] = [
      {
        name: "button",
        isHost: true,
        marker: "src/components/Button.tsx:6:10",
      },
      {
        name: "Button",
        isHost: false,
        marker: "src/App.tsx:20:9",
      },
    ];
    const resolved = await resolverWith({ projectRoot: "D:/proj" }).resolveChain(chain);
    expect(resolved.map((entry) => entry.name)).toEqual(["button", "Button"]);
    expect(resolved[1]?.location?.relativeFile).toBe("src/App.tsx");
  });

  it("learns the project root from a source-map frame (no map `file`, no settings)", async () => {
    const resolver = createSourceResolver({
      pageOrigin: ORIGIN,
      projectRoot: null,
      fetchText: noFileFetch(),
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

    expect(resolved.location?.relativeFile).toBe("src/App.tsx");
    expect(resolved.location?.absoluteFile).toBe(
      "C:/Users/reemo/proj/src/App.tsx",
    );
  });

  it("makes marker-only entries absolute using a root learned in the same chain", async () => {
    const resolver = createSourceResolver({
      pageOrigin: ORIGIN,
      projectRoot: null,
      fetchText: noFileFetch(),
    });
    const chain: RawEntry[] = [
      {
        name: "Button",
        isHost: false,
        stackFrame: {
          url: noFileFixture.moduleUrl,
          line: noFileFixture.generated.line,
          column: noFileFixture.generated.column,
        },
      },
      // Only a project-relative marker: the Vite plugin's `data-ttc` layer.
      { name: "button", isHost: true, marker: "src/App.tsx:20:9" },
    ];

    const resolved = await resolver.resolveChain(chain);

    expect(resolved[0]?.location?.absoluteFile).toBe(
      "C:/Users/reemo/proj/src/App.tsx",
    );
    expect(resolved[1]?.location?.relativeFile).toBe("src/App.tsx");
    expect(resolved[1]?.location?.absoluteFile).toBe(
      "C:/Users/reemo/proj/src/App.tsx",
    );
  });

  it("reuses a learned root for later clicks", async () => {
    const resolver = createSourceResolver({
      pageOrigin: ORIGIN,
      projectRoot: null,
      fetchText: noFileFetch(),
    });
    await resolver.resolve({
      name: "Button",
      isHost: false,
      stackFrame: {
        url: noFileFixture.moduleUrl,
        line: noFileFixture.generated.line,
        column: noFileFixture.generated.column,
      },
    });

    const markerOnly = await resolver.resolve({
      name: "button",
      isHost: true,
      marker: "src/components/Button.tsx:6:10",
    });

    expect(markerOnly.location?.absoluteFile).toBe(
      "C:/Users/reemo/proj/src/components/Button.tsx",
    );
  });

  it("keeps a configured project root ahead of the learned one", async () => {
    const resolver = createSourceResolver({
      pageOrigin: ORIGIN,
      projectRoot: "D:/other",
      fetchText: noFileFetch(),
    });
    const resolved = await resolver.resolve({
      name: "button",
      isHost: true,
      marker: "src/App.tsx:20:9",
    });
    expect(resolved.location?.absoluteFile).toBe("D:/other/src/App.tsx");
  });
});
