import { describe, expect, it } from "vitest";

import {
  NO_LOCATION_DETAIL,
  SET_PROJECT_ROOT_DETAIL,
  sourceActionAvailable,
  sourceActionCopy,
  sourceActionDetail,
  sourceActionLabel,
} from "../lib/actions";
import { createLocation, type SourceLocation } from "../lib/source/location";
import type { ResolvedEntry } from "../lib/source/types";
import type { ClickAction } from "../lib/types";

const ROOT = "D:/proj";
const RELATIVE = "app/components/MyBox.tsx";
const ABSOLUTE = "D:/proj/app/components/MyBox.tsx";
const LINE = 12;
const COLUMN = 5;

const ACTIONS: ClickAction[] = [
  "open",
  "copy-file",
  "copy-path",
  "copy-full-path",
  "copy-location",
];

const COPY_ACTIONS: ClickAction[] = [
  "copy-file",
  "copy-path",
  "copy-full-path",
  "copy-location",
];

function loc(input: {
  relativeFile?: string | null;
  absoluteFile?: string | null;
  line?: number;
  column?: number;
} = {}): SourceLocation {
  const location = createLocation({
    relativeFile: input.relativeFile ?? null,
    absoluteFile: input.absoluteFile ?? null,
    line: input.line ?? LINE,
    column: input.column ?? COLUMN,
    source: "debug-source",
  });
  if (location === null) throw new Error("test fixture location is unusable");
  return location;
}

function entry(
  location: SourceLocation | null,
  overrides: Partial<Omit<ResolvedEntry, "location">> = {},
): ResolvedEntry {
  return { name: "Button", isHost: false, location, ...overrides };
}

const RELATIVE_ONLY = entry(loc({ relativeFile: RELATIVE }));
const BOTH = entry(loc({ relativeFile: RELATIVE, absoluteFile: ABSOLUTE }));
const ABSOLUTE_ONLY = entry(loc({ absoluteFile: ABSOLUTE }));
const NO_LOCATION = entry(null);

describe("sourceActionLabel", () => {
  it("labels every action for the picker", () => {
    expect(ACTIONS.map((action) => sourceActionLabel(action))).toEqual([
      "Open in IDE",
      "Copy file name",
      "Copy relative path",
      "Copy full path",
      "Copy file:line:column",
    ]);
  });
});

describe("sourceActionDetail", () => {
  it("shows the value each row would copy", () => {
    expect(ACTIONS.map((action) => sourceActionDetail(action, RELATIVE_ONLY, ROOT))).toEqual([
      "app/components/MyBox.tsx:12:5",
      "MyBox.tsx",
      "app/components/MyBox.tsx",
      "D:/proj/app/components/MyBox.tsx",
      "app/components/MyBox.tsx:12:5",
    ]);
  });

  it("prefers the known absolute file over the project root", () => {
    expect(sourceActionDetail("copy-full-path", BOTH, "D:/other")).toBe(ABSOLUTE);
  });

  it("falls back to the absolute path for every path detail when no relative path exists", () => {
    expect(sourceActionDetail("copy-file", ABSOLUTE_ONLY, null)).toBe("MyBox.tsx");
    expect(sourceActionDetail("copy-path", ABSOLUTE_ONLY, null)).toBe(ABSOLUTE);
    expect(sourceActionDetail("copy-full-path", ABSOLUTE_ONLY, null)).toBe(ABSOLUTE);
    expect(sourceActionDetail("open", ABSOLUTE_ONLY, null)).toBe(`${ABSOLUTE}:12:5`);
    expect(sourceActionDetail("copy-location", ABSOLUTE_ONLY, null)).toBe(`${ABSOLUTE}:12:5`);
  });

  it("asks for a project root when the full path cannot be produced", () => {
    expect(sourceActionDetail("copy-full-path", RELATIVE_ONLY, null)).toBe(
      SET_PROJECT_ROOT_DETAIL,
    );
  });

  it("normalizes a trailing-slash/backslash root and relative path", () => {
    const windowsEntry = entry(
      loc({ relativeFile: "app\\components\\MyBox.tsx" }),
    );
    expect(sourceActionDetail("copy-path", windowsEntry, null)).toBe(RELATIVE);
    expect(sourceActionDetail("copy-full-path", windowsEntry, "D:\\proj\\")).toBe(ABSOLUTE);
  });

  it("shows a hint for every action when the entry has no location", () => {
    expect(ACTIONS.map((action) => sourceActionDetail(action, NO_LOCATION, ROOT))).toEqual([
      NO_LOCATION_DETAIL,
      NO_LOCATION_DETAIL,
      NO_LOCATION_DETAIL,
      NO_LOCATION_DETAIL,
      NO_LOCATION_DETAIL,
    ]);
  });

  it("always shows exactly the text that a copy action would write", () => {
    for (const action of COPY_ACTIONS) {
      const copy = sourceActionCopy(action, BOTH, ROOT);
      expect(copy).not.toBeNull();
      expect(sourceActionDetail(action, BOTH, ROOT)).toBe(copy?.text);
    }
  });
});

describe("sourceActionCopy", () => {
  it("returns null for the editor action", () => {
    expect(sourceActionCopy("open", RELATIVE_ONLY, ROOT)).toBeNull();
  });

  it("copies the bare file name", () => {
    expect(sourceActionCopy("copy-file", RELATIVE_ONLY, ROOT)).toEqual({
      text: "MyBox.tsx",
      toast: "Copied file name: MyBox.tsx",
    });
  });

  it("copies the relative path", () => {
    expect(sourceActionCopy("copy-path", BOTH, ROOT)).toEqual({
      text: RELATIVE,
      toast: `Copied path: ${RELATIVE}`,
    });
  });

  it("copies the full path using the project root when no absolute path is known", () => {
    expect(sourceActionCopy("copy-full-path", RELATIVE_ONLY, ROOT)).toEqual({
      text: ABSOLUTE,
      toast: `Copied full path: ${ABSOLUTE}`,
    });
  });

  it("copies the full location", () => {
    expect(sourceActionCopy("copy-location", BOTH, ROOT)).toEqual({
      text: "app/components/MyBox.tsx:12:5",
      toast: "Copied location: app/components/MyBox.tsx:12:5",
    });
  });

  it("returns null when there is nothing the action could copy", () => {
    for (const action of COPY_ACTIONS) {
      expect(sourceActionCopy(action, NO_LOCATION, ROOT)).toBeNull();
    }
    expect(sourceActionCopy("copy-full-path", RELATIVE_ONLY, null)).toBeNull();
    // An empty root cannot produce an absolute path either.
    expect(sourceActionCopy("copy-full-path", RELATIVE_ONLY, "")).toBeNull();
  });
});

describe("sourceActionAvailable", () => {
  it("needs a location for every action", () => {
    for (const action of ACTIONS) {
      expect(sourceActionAvailable(action, NO_LOCATION, ROOT)).toBe(false);
    }
  });

  it("needs a project root (or absolute path) for open and the full path", () => {
    expect(sourceActionAvailable("open", RELATIVE_ONLY, null)).toBe(false);
    expect(sourceActionAvailable("copy-full-path", RELATIVE_ONLY, null)).toBe(false);
    expect(sourceActionAvailable("copy-file", RELATIVE_ONLY, null)).toBe(true);
    expect(sourceActionAvailable("copy-path", RELATIVE_ONLY, null)).toBe(true);
    expect(sourceActionAvailable("copy-location", RELATIVE_ONLY, null)).toBe(true);

    expect(sourceActionAvailable("open", RELATIVE_ONLY, ROOT)).toBe(true);
    expect(sourceActionAvailable("copy-full-path", RELATIVE_ONLY, ROOT)).toBe(true);

    expect(sourceActionAvailable("open", ABSOLUTE_ONLY, null)).toBe(true);
    expect(sourceActionAvailable("copy-full-path", ABSOLUTE_ONLY, null)).toBe(true);
  });

  it("treats an empty root like an unset root", () => {
    expect(sourceActionAvailable("open", RELATIVE_ONLY, "")).toBe(false);
    expect(sourceActionAvailable("copy-full-path", RELATIVE_ONLY, "")).toBe(false);
  });

  it("does not care about the entry name or host flag", () => {
    const host = entry(loc({ relativeFile: RELATIVE }), {
      name: "button",
      isHost: true,
    });
    expect(sourceActionAvailable("open", host, ROOT)).toBe(true);
  });
});
