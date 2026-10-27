import { describe, expect, it } from "vitest";

import {
  expandActionTemplate,
  formatActionMarker,
  formatChainNames,
  limitActionText,
  MAX_ACTION_TEXT,
  orderedChain,
  previewActionText,
  sanitizeActionName,
  sanitizeActionPath,
  type ActionContext,
  type ChainEntry,
} from "../../src/client/index";

const ROOT = "D:/proj";
const HOST: ChainEntry = {
  name: "button",
  isHost: true,
  marker: { file: "app/components/Button.tsx", line: 20, column: 9 },
};
const ENTRY: ChainEntry = {
  name: "Button",
  isHost: false,
  marker: { file: "app/App.tsx", line: 9, column: 5 },
};
const APP: ChainEntry = {
  name: "App",
  isHost: false,
  marker: { file: "app/main.tsx", line: 7, column: 1 },
};
const CONTEXT: ActionContext = {
  entry: ENTRY,
  chain: [HOST, ENTRY, APP],
  root: ROOT,
};

describe("orderedChain / formatChainNames", () => {
  it("orders the chain outermost first", () => {
    expect(orderedChain(CONTEXT).map((entry) => entry.name)).toEqual([
      "App",
      "Button",
      "button",
    ]);
    expect(formatChainNames(CONTEXT)).toBe("App > Button > button");
  });

  it("falls back to the acted-on entry for an empty chain", () => {
    const context: ActionContext = { entry: ENTRY, chain: [], root: ROOT };
    expect(orderedChain(context).map((entry) => entry.name)).toEqual(["Button"]);
    expect(formatChainNames(context)).toBe("Button");
  });
});

describe("expandActionTemplate", () => {
  it("expands every documented placeholder", () => {
    expect(
      expandActionTemplate(
        "{file}|{absPath}|{name}|{line}|{column}|{location}|{chain}",
        CONTEXT,
      ),
    ).toBe(
      "app/App.tsx|D:/proj/app/App.tsx|Button|9|5|app/App.tsx:9:5|App > Button > button",
    );
  });

  it("leaves unknown tokens untouched so literal braces survive", () => {
    expect(
      expandActionTemplate("keep {unknown} and {CHAIN}", CONTEXT),
    ).toBe("keep {unknown} and {CHAIN}");
  });

  it("never expands Object.prototype names as placeholders", () => {
    expect(
      expandActionTemplate(
        "{constructor} {toString} {valueOf} {hasOwnProperty}",
        CONTEXT,
      ),
    ).toBe("{constructor} {toString} {valueOf} {hasOwnProperty}");
  });

  it("keeps intentional whitespace and newlines", () => {
    expect(expandActionTemplate("Review {name}\n{location}", CONTEXT)).toBe(
      "Review Button\napp/App.tsx:9:5",
    );
  });

  it("replaces repeated placeholders", () => {
    expect(expandActionTemplate("{file} / {file}", CONTEXT)).toBe(
      "app/App.tsx / app/App.tsx",
    );
  });

  it("caps the clipboard text", () => {
    const text = expandActionTemplate("{file}", CONTEXT);
    expect(text.length).toBeLessThan(MAX_ACTION_TEXT);
    expect(limitActionText("x".repeat(MAX_ACTION_TEXT + 10))).toHaveLength(
      MAX_ACTION_TEXT,
    );
    expect(limitActionText("ok")).toBe("ok");
  });
});

describe("sanitizeActionPath / formatActionMarker", () => {
  it("strips control and bidi characters from copied paths", () => {
    expect(sanitizeActionPath("app/\u202Eevil\u0000.tsx")).toBe("app/evil.tsx");
  });

  it("caps very long paths", () => {
    const file = sanitizeActionPath("a".repeat(2000));
    expect(file.length).toBe(1024);
    expect(file.endsWith("…")).toBe(true);
  });

  it("formats a safe file:line:column marker", () => {
    expect(formatActionMarker(ENTRY.marker)).toBe("app/App.tsx:9:5");
  });

  it("sanitizes template path placeholders", () => {
    const context: ActionContext = {
      entry: {
        ...ENTRY,
        marker: { file: "app/\u202Eevil\u0000.tsx", line: 2, column: 3 },
      },
      chain: [],
      root: ROOT,
    };
    expect(expandActionTemplate("{file}|{absPath}|{location}", context)).toBe(
      "app/evil.tsx|D:/proj/app/evil.tsx|app/evil.tsx:2:3",
    );
  });
});

describe("sanitizeActionName", () => {
  it("strips control and bidi characters and flattens whitespace", () => {
    expect(sanitizeActionName("  My\u202E Box\n\t ")).toBe("My Box");
    expect(sanitizeActionName("a\u0000b")).toBe("ab");
  });

  it("caps very long names", () => {
    const name = sanitizeActionName("x".repeat(500));
    expect(name.length).toBe(120);
    expect(name.endsWith("…")).toBe(true);
  });

  it("returns an empty string for non-string input", () => {
    expect(sanitizeActionName(42 as never)).toBe("");
  });
});

describe("previewActionText", () => {
  it("flattens newlines and repeated spaces", () => {
    expect(previewActionText("a\n\n  b   c")).toBe("a b c");
  });

  it("truncates with an ellipsis", () => {
    expect(previewActionText("abcdefghij", 5)).toBe("abcd…");
    expect(previewActionText("abc", 5)).toBe("abc");
  });
});
