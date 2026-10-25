import { describe, expect, it } from "vitest";

import {
  sourceActionCopy,
  sourceActionDetail,
  sourceActionLabel,
  type ClickAction,
  type SourceMarker,
} from "../../src/client/index";

const ROOT = "D:/proj";
const MARKER: SourceMarker = {
  file: "app/components/MyBox.tsx",
  line: 12,
  column: 5,
};

const ACTIONS: ClickAction[] = [
  "open",
  "copy-file",
  "copy-path",
  "copy-full-path",
  "copy-location",
];

describe("source action labels", () => {
  it("labels every action for the picker", () => {
    expect(ACTIONS.map((action) => sourceActionLabel(action))).toEqual([
      "Open in IDE",
      "Copy file name",
      "Copy relative path",
      "Copy full path",
      "Copy file:line:column",
    ]);
  });

  it("shows the value each row would copy", () => {
    expect(
      ACTIONS.map((action) => sourceActionDetail(action, MARKER, ROOT)),
    ).toEqual([
      "app/components/MyBox.tsx:12:5",
      "MyBox.tsx",
      "app/components/MyBox.tsx",
      "D:/proj/app/components/MyBox.tsx",
      "app/components/MyBox.tsx:12:5",
    ]);
  });
});

describe("sourceActionCopy", () => {
  it("returns null for the editor action", () => {
    expect(sourceActionCopy("open", MARKER, ROOT)).toBeNull();
  });

  it("copies the bare file name", () => {
    expect(sourceActionCopy("copy-file", MARKER, ROOT)).toEqual({
      text: "MyBox.tsx",
      toast: "Copied file name: MyBox.tsx",
    });
  });

  it("copies the relative path", () => {
    expect(sourceActionCopy("copy-path", MARKER, ROOT)).toEqual({
      text: "app/components/MyBox.tsx",
      toast: "Copied path: app/components/MyBox.tsx",
    });
  });

  it("copies the full path using the injected project root", () => {
    expect(sourceActionCopy("copy-full-path", MARKER, ROOT)).toEqual({
      text: "D:/proj/app/components/MyBox.tsx",
      toast: "Copied full path: D:/proj/app/components/MyBox.tsx",
    });
  });

  it("copies the full location", () => {
    expect(sourceActionCopy("copy-location", MARKER, ROOT)).toEqual({
      text: "app/components/MyBox.tsx:12:5",
      toast: "Copied location: app/components/MyBox.tsx:12:5",
    });
  });
});
