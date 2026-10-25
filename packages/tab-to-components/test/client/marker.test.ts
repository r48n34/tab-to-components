import { describe, expect, it } from "vitest";

import {
  fileNameOf,
  formatEntryLabel,
  formatMarker,
  formatNameLabel,
  isSafeSourceFile,
  parseMarker,
  resolveFullPath,
} from "../../src/client/index";

describe("parseMarker", () => {
  it("parses a relative posix path with 1-based line and column", () => {
    expect(parseMarker("app/routes/home.tsx:19:7")).toEqual({
      file: "app/routes/home.tsx",
      line: 19,
      column: 7,
    });
  });

  it("keeps colons that belong to the file portion", () => {
    expect(parseMarker("D:/work/app/components/Button.tsx:3:12")).toEqual({
      file: "D:/work/app/components/Button.tsx",
      line: 3,
      column: 12,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseMarker("  app/root.tsx:1:1  ")).toEqual({
      file: "app/root.tsx",
      line: 1,
      column: 1,
    });
  });

  it.each([
    "no-markers-here",
    "app/root.tsx",
    "app/root.tsx:1",
    "app/root.tsx:0:1",
    "app/root.tsx:1:0",
    "app/root.tsx:-1:1",
    "app/root.tsx:1:-1",
    "app/root.tsx:x:1",
    "app/root.tsx:1:x",
    "app/root.tsx:1.5:2",
    ":1:2",
    "app/root.tsx::2",
    "",
    "   ",
  ])("rejects malformed marker %j", (value) => {
    expect(parseMarker(value)).toBeNull();
  });

  it("rejects missing values without throwing", () => {
    expect(parseMarker(null)).toBeNull();
    expect(parseMarker(undefined)).toBeNull();
  });
});

describe("isSafeSourceFile", () => {
  it("accepts project-relative paths", () => {
    expect(isSafeSourceFile("app/routes/home.tsx")).toBe(true);
    expect(isSafeSourceFile("app/components/MyBox.tsx")).toBe(true);
    expect(isSafeSourceFile("src\\windows\\style.tsx")).toBe(true);
    expect(isSafeSourceFile("file.tsx")).toBe(true);
  });

  it("rejects paths that escape or name an absolute location", () => {
    for (const file of [
      "../outside.tsx",
      "app/../../outside.tsx",
      "app/../outside.tsx",
      "/etc/passwd",
      "\\\\server\\share\\file.tsx",
      "//server/share/file.tsx",
      "D:/outside/file.tsx",
      "C:\\outside\\file.tsx",
      "",
    ]) {
      expect(isSafeSourceFile(file), file).toBe(false);
    }
  });
});

describe("label formatting", () => {
  it("formats a source marker", () => {
    expect(formatMarker({ file: "app/components/Button.tsx", line: 6, column: 10 })).toBe(
      "app/components/Button.tsx:6:10",
    );
  });

  it("formats a JSX-style name label for host elements and components", () => {
    expect(formatNameLabel("button")).toBe("<button />");
    expect(formatNameLabel("Foo.Bar")).toBe("<Foo.Bar />");
  });

  it("formats a full menu/label entry", () => {
    expect(
      formatEntryLabel({
        name: "Button",
        marker: { file: "app/routes/home.tsx", line: 19, column: 7 },
      }),
    ).toBe("<Button />  app/routes/home.tsx:19:7");
  });

  it("extracts the bare file name of a marker", () => {
    expect(
      fileNameOf({ file: "app/components/MyBox.tsx", line: 1, column: 1 }),
    ).toBe("MyBox.tsx");
    expect(fileNameOf({ file: "MyBox.tsx", line: 1, column: 1 })).toBe(
      "MyBox.tsx",
    );
    expect(
      fileNameOf({ file: "app\\components\\MyBox.tsx", line: 1, column: 1 }),
    ).toBe("MyBox.tsx");
  });

  it("resolves an absolute file path from the injected root", () => {
    const marker = {
      file: "app/components/MyBox.tsx",
      line: 12,
      column: 5,
    };
    expect(resolveFullPath(marker, "D:/proj")).toBe(
      "D:/proj/app/components/MyBox.tsx",
    );
    expect(resolveFullPath(marker, "D:\\proj\\")).toBe(
      "D:/proj/app/components/MyBox.tsx",
    );
    expect(resolveFullPath(marker, "/home/dev/proj/")).toBe(
      "/home/dev/proj/app/components/MyBox.tsx",
    );
    expect(resolveFullPath(marker, "/")).toBe(
      "/app/components/MyBox.tsx",
    );
    expect(
      resolveFullPath(
        { file: "app\\components\\MyBox.tsx", line: 1, column: 1 },
        "D:/proj",
      ),
    ).toBe("D:/proj/app/components/MyBox.tsx");
  });
});
