import { describe, expect, it } from "vitest";

import {
  IDE_LABELS,
  MAX_ACTION_TEXT,
  aiContextText,
  customActionCopy,
  customActionDetail,
  customActionIcon,
  markdownText,
  sourceActionCopy,
  sourceActionDetail,
  sourceActionIde,
  sourceActionIcon,
  sourceActionLabel,
  type ActionContext,
  type ChainEntry,
  type ClickAction,
  type CustomAction,
  type EditorIde,
  type SourceMarker,
} from "../../src/client/index";

const ROOT = "D:/proj";
const MARKER: SourceMarker = {
  file: "app/components/MyBox.tsx",
  line: 12,
  column: 5,
};
const HOST: ChainEntry = {
  name: "button",
  isHost: true,
  marker: { file: "app/components/MyBox.tsx", line: 8, column: 3 },
};
const ENTRY: ChainEntry = { name: "MyBox", isHost: false, marker: MARKER };
const APP: ChainEntry = {
  name: "App",
  isHost: false,
  marker: { file: "app/root.tsx", line: 4, column: 5 },
};
const CONTEXT: ActionContext = {
  entry: ENTRY,
  chain: [HOST, ENTRY, APP],
  root: ROOT,
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
  "copy-ai-context",
  "copy-mention",
  "copy-markdown",
  "copy-chain",
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
      "Copy for AI",
      "Copy @mention",
      "Copy as Markdown",
      "Copy component chain",
    ]);
  });

  it("shows the value each path action would copy", () => {
    expect(
      ACTIONS.slice(0, 9).map((action) => sourceActionDetail(action, CONTEXT)),
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

  it("previews the new AI/share rows", () => {
    expect(sourceActionDetail("copy-mention", CONTEXT)).toBe(
      "@app/components/MyBox.tsx:12:5",
    );
    expect(sourceActionDetail("copy-chain", CONTEXT)).toBe(
      "App > MyBox > button",
    );
    expect(sourceActionDetail("copy-markdown", CONTEXT)).toBe(
      "`<MyBox />` — `app/components/MyBox.tsx:12:5`",
    );
    const aiDetail = sourceActionDetail("copy-ai-context", CONTEXT);
    expect(aiDetail.startsWith("Target: <MyBox /> — app/components/MyBox.tsx:12:5")).toBe(true);
    expect(aiDetail).toContain("Component chain (outermost → innermost):");
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
      "sparkles",
      "at",
      "markdown",
      "component",
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
      expect(sourceActionCopy(action, CONTEXT), action).toBeNull();
    }
  });

  it("copies the bare file name", () => {
    expect(sourceActionCopy("copy-file", CONTEXT)).toEqual({
      text: "MyBox.tsx",
      toast: "Copied file name: MyBox.tsx",
    });
  });

  it("copies the relative path", () => {
    expect(sourceActionCopy("copy-path", CONTEXT)).toEqual({
      text: "app/components/MyBox.tsx",
      toast: "Copied path: app/components/MyBox.tsx",
    });
  });

  it("copies the full path using the injected project root", () => {
    expect(sourceActionCopy("copy-full-path", CONTEXT)).toEqual({
      text: "D:/proj/app/components/MyBox.tsx",
      toast: "Copied full path: D:/proj/app/components/MyBox.tsx",
    });
  });

  it("copies the full location", () => {
    expect(sourceActionCopy("copy-location", CONTEXT)).toEqual({
      text: "app/components/MyBox.tsx:12:5",
      toast: "Copied location: app/components/MyBox.tsx:12:5",
    });
  });

  it("copies an AI context block for the target and the component chain", () => {
    const copy = sourceActionCopy("copy-ai-context", CONTEXT);
    expect(copy).toEqual({
      text: [
        "Target: <MyBox /> — app/components/MyBox.tsx:12:5",
        "Component chain (outermost → innermost):",
        "1. <App /> — app/root.tsx:4:5",
        "2. <MyBox /> — app/components/MyBox.tsx:12:5",
        "3. <button /> — app/components/MyBox.tsx:8:3",
      ].join("\n"),
      toast: "Copied AI context: app/components/MyBox.tsx:12:5",
    });
  });

  it("copies an @mention", () => {
    expect(sourceActionCopy("copy-mention", CONTEXT)).toEqual({
      text: "@app/components/MyBox.tsx:12:5",
      toast: "Copied @mention: @app/components/MyBox.tsx:12:5",
    });
  });

  it("copies an inline markdown reference", () => {
    expect(sourceActionCopy("copy-markdown", CONTEXT)).toEqual({
      text: "`<MyBox />` — `app/components/MyBox.tsx:12:5`",
      toast: "Copied Markdown: app/components/MyBox.tsx:12:5",
    });
  });

  it("copies the component chain outermost first", () => {
    expect(sourceActionCopy("copy-chain", CONTEXT)).toEqual({
      text: "App > MyBox > button",
      toast: "Copied component chain: App > MyBox > button",
    });
  });
});

describe("AI context formatting", () => {
  it("falls back to the acted-on entry when no chain was collected", () => {
    const context: ActionContext = { entry: ENTRY, chain: [], root: ROOT };
    expect(aiContextText(context)).toContain("1. <MyBox /> — app/components/MyBox.tsx:12:5");
  });

  it("formats the markdown reference from the same source location", () => {
    expect(markdownText(CONTEXT)).toBe(
      "`<MyBox />` — `app/components/MyBox.tsx:12:5`",
    );
  });

  it("falls back to the clicked host element for a host-only chain", () => {
    const context: ActionContext = { entry: HOST, chain: [HOST], root: ROOT };
    expect(aiContextText(context)).toBe(
      [
        "Target: <button /> — app/components/MyBox.tsx:8:3",
        "Component chain (outermost → innermost):",
        "1. <button /> — app/components/MyBox.tsx:8:3",
      ].join("\n"),
    );
    expect(sourceActionCopy("copy-chain", context)?.text).toBe("button");
  });

  it("caps very long fabricated chains", () => {
    const chain: ChainEntry[] = Array.from({ length: 200 }, (_, index) => ({
      name: `Button${"x".repeat(40)}${index}`,
      isHost: false,
      marker: MARKER,
    }));
    const first = chain[0];
    if (first === undefined) throw new Error("missing chain entry");
    const context: ActionContext = {
      entry: chain[chain.length - 1] ?? first,
      chain,
      root: ROOT,
    };
    const ai = sourceActionCopy("copy-ai-context", context);
    expect(ai?.text.length).toBe(MAX_ACTION_TEXT);
    expect(ai?.text.endsWith("…")).toBe(true);
    expect(sourceActionCopy("copy-chain", context)?.text.length).toBe(
      MAX_ACTION_TEXT,
    );
  });

  it("sanitizes marker paths in preset clipboard values", () => {
    const context: ActionContext = {
      entry: {
        ...ENTRY,
        marker: { file: "app/\u202Eevil\u0000.tsx", line: 1, column: 2 },
      },
      chain: [],
      root: ROOT,
    };
    expect(sourceActionCopy("copy-mention", context)?.text).toBe(
      "@app/evil.tsx:1:2",
    );
    expect(sourceActionCopy("copy-markdown", context)?.text).toContain(
      "app/evil.tsx:1:2",
    );
    expect(sourceActionCopy("copy-ai-context", context)?.text).toContain(
      "app/evil.tsx:1:2",
    );
  });
});

describe("custom actions", () => {
  const REVIEW: CustomAction = {
    id: "review",
    label: "Copy review prompt",
    copy: "Review {name} at {location}.\nChain: {chain}",
  };

  it("defaults to the location icon and accepts a curated icon", () => {
    expect(customActionIcon(REVIEW)).toBe("copy-location");
    expect(customActionIcon({ ...REVIEW, icon: "sparkles" })).toBe("sparkles");
  });

  it("previews the expanded template on one line", () => {
    expect(customActionDetail(REVIEW, CONTEXT)).toBe(
      "Review MyBox at app/components/MyBox.tsx:12:5. Chain: App > MyBox > button",
    );
  });

  it("copies the expanded template", () => {
    expect(customActionCopy(REVIEW, CONTEXT)).toEqual({
      text: "Review MyBox at app/components/MyBox.tsx:12:5.\nChain: App > MyBox > button",
      toast:
        "Copied: Review MyBox at app/components/MyBox.tsx:12:5. Chain: App > MyBox > button",
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
    expect(sourceActionIde("copy-ai-context")).toBeNull();
    expect(sourceActionIde("copy-chain")).toBeNull();
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
