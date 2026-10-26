import { describe, expect, it } from "vitest";

import { locationFromDebugSource } from "../../lib/source/react18";

describe("locationFromDebugSource", () => {
  it("keeps Babel's 1-based line and column and the absolute path", () => {
    const location = locationFromDebugSource(
      {
        fileName: "D:/proj/src/App.tsx",
        lineNumber: 20,
        columnNumber: 9,
      },
      { projectRoot: null },
    );
    expect(location).toEqual({
      file: "D:/proj/src/App.tsx",
      relativeFile: null,
      absoluteFile: "D:/proj/src/App.tsx",
      line: 20,
      column: 9,
      source: "debug-source",
    });
  });

  it("derives the project-relative path when a root is configured", () => {
    const location = locationFromDebugSource(
      {
        fileName: "D:\\proj\\src\\components\\Button.tsx",
        lineNumber: 6,
        columnNumber: 10,
      },
      { projectRoot: "D:/proj" },
    );
    expect(location?.relativeFile).toBe("src/components/Button.tsx");
    expect(location?.absoluteFile).toBe("D:/proj/src/components/Button.tsx");
  });

  it("keeps a relative compiler filename as relative-only", () => {
    const location = locationFromDebugSource(
      { fileName: "src/App.tsx", lineNumber: 3, columnNumber: 4 },
      { projectRoot: "D:/proj" },
    );
    expect(location?.relativeFile).toBe("src/App.tsx");
    expect(location?.absoluteFile).toBeNull();
  });

  it("rejects empty, unsafe and invalid positions", () => {
    expect(
      locationFromDebugSource(
        { fileName: "", lineNumber: 1, columnNumber: 1 },
        { projectRoot: null },
      ),
    ).toBeNull();
    expect(
      locationFromDebugSource(
        { fileName: "../secret.tsx", lineNumber: 1, columnNumber: 1 },
        { projectRoot: null },
      ),
    ).toBeNull();
    expect(
      locationFromDebugSource(
        { fileName: "D:/proj/src/App.tsx", lineNumber: 0, columnNumber: 1 },
        { projectRoot: null },
      ),
    ).toBeNull();
  });
});
