import { describe, expect, it } from "vitest";

import {
  alignModulePath,
  createLocation,
  displayFileOf,
  fileNameOf,
  formatEntryLabel,
  formatLocation,
  formatMarker,
  formatNameLabel,
  isSafeAbsolutePath,
  isSafeRelativeFile,
  isValidPosition,
  joinRoot,
  normalizeAbsolutePath,
  normalizeSlashes,
  parseMarker,
  projectRootFrom,
  resolveAbsoluteLocation,
  stripRoot,
} from "../../lib/source/location";

describe("isSafeRelativeFile", () => {
  it("accepts plain project-relative paths", () => {
    expect(isSafeRelativeFile("src/App.tsx")).toBe(true);
    expect(isSafeRelativeFile("app/routes/home.tsx")).toBe(true);
    expect(isSafeRelativeFile("src\\components\\Button.tsx")).toBe(true);
  });

  it("rejects absolute, parent-traversing and control-character paths", () => {
    expect(isSafeRelativeFile("/src/App.tsx")).toBe(false);
    expect(isSafeRelativeFile("D:/proj/App.tsx")).toBe(false);
    expect(isSafeRelativeFile("../secret.txt")).toBe(false);
    expect(isSafeRelativeFile("src/../secret.txt")).toBe(false);
    expect(isSafeRelativeFile("")).toBe(false);
    expect(isSafeRelativeFile("bad\u0000name.tsx")).toBe(false);
    expect(isSafeRelativeFile("x".repeat(2000))).toBe(false);
    expect(isSafeRelativeFile(42)).toBe(false);
  });
});

describe("isSafeAbsolutePath", () => {
  it("accepts Windows, POSIX and UNC paths", () => {
    expect(isSafeAbsolutePath("D:/proj/src/App.tsx")).toBe(true);
    expect(isSafeAbsolutePath("D:\\proj\\src\\App.tsx")).toBe(true);
    expect(isSafeAbsolutePath("/home/dev/app/src/App.tsx")).toBe(true);
    expect(isSafeAbsolutePath("//server/share/App.tsx")).toBe(true);
  });

  it("rejects relative paths, URL schemes and control characters", () => {
    expect(isSafeAbsolutePath("src/App.tsx")).toBe(false);
    expect(isSafeAbsolutePath("C:relative")).toBe(false);
    expect(isSafeAbsolutePath("javascript:alert(1)")).toBe(false);
    expect(isSafeAbsolutePath("/https://evil.example/x")).toBe(false);
    expect(isSafeAbsolutePath("bad\u001fname")).toBe(false);
    expect(isSafeAbsolutePath("")).toBe(false);
  });
});

describe("normalizeAbsolutePath", () => {
  it("normalizes separators and file URLs", () => {
    expect(normalizeAbsolutePath("D:\\proj\\src\\App.tsx")).toBe(
      "D:/proj/src/App.tsx",
    );
    expect(normalizeAbsolutePath("file:///D:/proj/src/App.tsx")).toBe(
      "D:/proj/src/App.tsx",
    );
    expect(normalizeAbsolutePath("file:///home/dev/src/App.tsx")).toBe(
      "/home/dev/src/App.tsx",
    );
    expect(normalizeAbsolutePath("/D:/proj/src/App.tsx")).toBe(
      "D:/proj/src/App.tsx",
    );
  });

  it("returns null for unsafe values", () => {
    expect(normalizeAbsolutePath("src/App.tsx")).toBeNull();
    expect(normalizeAbsolutePath("")).toBeNull();
    expect(normalizeAbsolutePath(null)).toBeNull();
  });
});

describe("parseMarker", () => {
  it("parses <path>:<line>:<column>", () => {
    expect(parseMarker("src/App.tsx:20:9")).toEqual({
      file: "src/App.tsx",
      line: 20,
      column: 9,
    });
  });

  it("rejects malformed or unsafe markers", () => {
    expect(parseMarker("src/App.tsx:20")).toBeNull();
    expect(parseMarker("src/App.tsx:0:9")).toBeNull();
    expect(parseMarker("src/App.tsx:20:abc")).toBeNull();
    expect(parseMarker("../secret.tsx:1:1")).toBeNull();
    expect(parseMarker("/abs/App.tsx:1:1")).toBeNull();
    expect(parseMarker(undefined)).toBeNull();
  });
});

describe("formatting and path joining", () => {
  it("formats locations, markers and labels", () => {
    expect(formatLocation({ file: "src/App.tsx", line: 20, column: 9 })).toBe(
      "src/App.tsx:20:9",
    );
    expect(formatMarker({ file: "src/App.tsx", line: 20, column: 9 })).toBe(
      "src/App.tsx:20:9",
    );
    expect(formatNameLabel("Button")).toBe("<Button />");
    expect(
      formatEntryLabel({
        name: "Button",
        location: {
          file: "src/App.tsx",
          relativeFile: "src/App.tsx",
          absoluteFile: null,
          line: 20,
          column: 9,
          source: "marker",
        },
      }),
    ).toBe("<Button />  src/App.tsx:20:9");
  });

  it("returns the bare file name for either separator", () => {
    expect(fileNameOf("app/routes/home.tsx")).toBe("home.tsx");
    expect(fileNameOf("app\\routes\\home.tsx")).toBe("home.tsx");
    expect(fileNameOf("home.tsx")).toBe("home.tsx");
  });

  it("joins a root and strips it case-insensitively", () => {
    expect(joinRoot("D:/proj", "src/App.tsx")).toBe("D:/proj/src/App.tsx");
    expect(joinRoot("D:/proj/", "/src/App.tsx")).toBe("D:/proj/src/App.tsx");
    expect(joinRoot("/home/dev/app", "src/App.tsx")).toBe(
      "/home/dev/app/src/App.tsx",
    );
    expect(joinRoot("D:/proj", "../secret")).toBeNull();
    expect(joinRoot("", "src/App.tsx")).toBeNull();

    expect(stripRoot("D:/proj/src/App.tsx", "d:/PROJ")).toBe("src/App.tsx");
    expect(stripRoot("D:/proj/src/App.tsx", null)).toBeNull();
    expect(stripRoot("D:/other/src/App.tsx", "D:/proj")).toBeNull();
  });
});

describe("projectRootFrom", () => {
  it("is the inverse of stripRoot for Windows and POSIX paths", () => {
    expect(projectRootFrom("C:/Users/reemo/proj/src/App.tsx", "src/App.tsx")).toBe(
      "C:/Users/reemo/proj",
    );
    expect(
      projectRootFrom("D:/proj/app/routes/home.tsx", "app/routes/home.tsx"),
    ).toBe("D:/proj");
    expect(projectRootFrom("/home/dev/app/src/App.tsx", "src/App.tsx")).toBe(
      "/home/dev/app",
    );
    // Case-insensitive on the shared suffix, like stripRoot.
    expect(projectRootFrom("C:/Proj/SRC/App.tsx", "src/App.tsx")).toBe("C:/Proj");
  });

  it("returns null when the paths do not agree", () => {
    expect(projectRootFrom("D:/proj/src/App.tsx", "src/Other.tsx")).toBeNull();
    expect(projectRootFrom("D:/proj/src/App.tsx", "../App.tsx")).toBeNull();
    expect(projectRootFrom("src/App.tsx", "src/App.tsx")).toBeNull();
    expect(projectRootFrom(null, "src/App.tsx")).toBeNull();
    expect(projectRootFrom("D:/proj/src/App.tsx", null)).toBeNull();
    // A bare drive/filesystem root cannot round-trip through joinRoot.
    expect(projectRootFrom("C:/App.tsx", "App.tsx")).toBeNull();
  });
});

describe("alignModulePath", () => {
  it("recovers the project-relative path and a non-root base prefix", () => {
    expect(
      alignModulePath(
        "/cats/app/routes/home.tsx",
        "C:/Users/reemo/proj/app/routes/home.tsx",
      ),
    ).toEqual({ relativeFile: "app/routes/home.tsx", basePrefix: "/cats/" });
    expect(
      alignModulePath("/cats/src/app.tsx", "/home/dev/proj/src/app.tsx"),
    ).toEqual({ relativeFile: "src/app.tsx", basePrefix: "/cats/" });
  });

  it("reports a root base when the URL path already matches the file", () => {
    expect(
      alignModulePath("/src/App.tsx", "C:/Users/reemo/proj/src/App.tsx"),
    ).toEqual({ relativeFile: "src/App.tsx", basePrefix: "/" });
    // Case-insensitive on Windows-style paths.
    expect(
      alignModulePath("/SRC/app.tsx", "C:/Users/reemo/proj/src/App.tsx"),
    ).toEqual({ relativeFile: "SRC/app.tsx", basePrefix: "/" });
  });

  it("returns null when nothing lines up or inputs are unusable", () => {
    expect(alignModulePath("/cats/src/App.tsx", "D:/other/Notes.md")).toBeNull();
    expect(alignModulePath("/src/App.tsx", null)).toBeNull();
    expect(alignModulePath("src/App.tsx", "C:/proj/src/App.tsx")).toBeNull();
    expect(alignModulePath("/src/App.tsx", "src/App.tsx")).toBeNull();
  });
});

describe("createLocation", () => {
  it("prefers the relative path for display", () => {
    const location = createLocation({
      relativeFile: "src/App.tsx",
      absoluteFile: "D:/proj/src/App.tsx",
      line: 20,
      column: 9,
      source: "source-map",
    });
    expect(location).not.toBeNull();
    if (location === null) throw new Error("expected a location");
    expect(displayFileOf(location)).toBe("src/App.tsx");
    expect(resolveAbsoluteLocation(location, null)).toBe("D:/proj/src/App.tsx");
  });

  it("synthesizes the absolute path from a configured root", () => {
    const location = createLocation({
      relativeFile: "src/App.tsx",
      absoluteFile: null,
      line: 20,
      column: 9,
      source: "marker",
    });
    if (location === null) throw new Error("expected a location");
    expect(resolveAbsoluteLocation(location, "D:/proj")).toBe(
      "D:/proj/src/App.tsx",
    );
    expect(resolveAbsoluteLocation(location, null)).toBeNull();
  });

  it("returns null without a usable path or position", () => {
    expect(
      createLocation({
        relativeFile: null,
        absoluteFile: null,
        line: 1,
        column: 1,
        source: "marker",
      }),
    ).toBeNull();
    expect(
      createLocation({
        relativeFile: "src/App.tsx",
        absoluteFile: null,
        line: 0,
        column: 1,
        source: "marker",
      }),
    ).toBeNull();
    expect(isValidPosition(1, 1)).toBe(true);
    expect(isValidPosition(0, 1)).toBe(false);
    expect(normalizeSlashes("a\\b")).toBe("a/b");
  });
});
