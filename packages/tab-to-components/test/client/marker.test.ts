import { describe, expect, it } from "vitest";

import {
  formatEntryLabel,
  formatMarker,
  formatNameLabel,
  parseMarker,
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
});
