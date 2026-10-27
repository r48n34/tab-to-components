import { describe, expect, it } from "vitest";

import {
  IDE_LABELS,
  sourceActionCopy,
  sourceActionDetail,
  sourceActionIde,
  sourceActionIcon,
  sourceActionLabel,
  type ClickAction,
  type EditorIde,
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
  "open-code",
  "open-cursor",
  "open-webstorm",
  "open-trae",
  "copy-file",
  "copy-path",
  "copy-full-path",
  "copy-location",
];

/** The actions that ask the dev server to launch an editor. */
const OPEN_ACTIONS: ClickAction[] = [
  "open",
  "open-code",
  "open-cursor",
  "open-webstorm",
  "open-trae",
];

describe("source action labels", () => {
  it("labels every action for the picker", () => {
    expect(ACTIONS.map((action) => sourceActionLabel(action))).toEqual([
      "Open in IDE",
      "Open in VS Code",
      "Open in Cursor",
      "Open in WebStorm",
      "Open in Trae",
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
      "app/components/MyBox.tsx:12:5",
      "app/components/MyBox.tsx:12:5",
      "app/components/MyBox.tsx:12:5",
      "app/components/MyBox.tsx:12:5",
      "MyBox.tsx",
      "app/components/MyBox.tsx",
      "D:/proj/app/components/MyBox.tsx",
      "app/components/MyBox.tsx:12:5",
    ]);
  });
});

describe("source action icons", () => {
  it("gives every action the icon for what it acts on", () => {
    expect(ACTIONS.map((action) => sourceActionIcon(action))).toEqual([
      "open",
      "open-code",
      "open-cursor",
      "open-webstorm",
      "open-trae",
      "copy-file",
      "copy-path",
      "copy-full-path",
      "copy-location",
    ]);
  });

  it("keeps every action's icon distinct", () => {
    const icons = ACTIONS.map((action) => sourceActionIcon(action));
    expect(new Set(icons).size).toBe(ACTIONS.length);
  });
});

describe("sourceActionCopy", () => {
  it("returns null for every action that opens an editor", () => {
    for (const action of OPEN_ACTIONS) {
      expect(sourceActionCopy(action, MARKER, ROOT), action).toBeNull();
    }
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

describe("sourceActionIde", () => {
  it("maps each per-IDE action to the IDE it launches", () => {
    expect(ACTIONS.map((action) => sourceActionIde(action))).toEqual([
      null,
      "code",
      "cursor",
      "webstorm",
      "trae",
      null,
      null,
      null,
      null,
    ]);
  });

  it("returns null for the plain open action, which uses the editor option", () => {
    expect(sourceActionIde("open")).toBeNull();
  });

  it("returns null for an unrecognised copy action", () => {
    expect(sourceActionIde("copy-file")).toBeNull();
    expect(sourceActionIde("copy-location")).toBeNull();
    expect(sourceActionIde("copy-path")).toBeNull();
    expect(sourceActionIde("copy-full-path")).toBeNull();
  });

  it("returns null for an action that is not a known click action", () => {
    expect(sourceActionIde("open-phpstorm" as never)).toBeNull();
    expect(sourceActionIde("nope" as never)).toBeNull();
  });
});

describe("IDE_LABELS", () => {
  it("names every IDE the picker can launch", () => {
    expect(IDE_LABELS).toEqual({
      code: "VS Code",
      cursor: "Cursor",
      webstorm: "WebStorm",
      trae: "Trae",
    } satisfies Record<EditorIde, string>);
  });

  it("covers exactly the IDEs the open actions launch", () => {
    const launched = ACTIONS.map((action) => sourceActionIde(action)).filter(
      (ide): ide is EditorIde => ide !== null,
    );
    expect(new Set(launched)).toEqual(new Set(Object.keys(IDE_LABELS)));
  });
});
