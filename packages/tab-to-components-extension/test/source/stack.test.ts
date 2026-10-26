import { describe, expect, it } from "vitest";

import {
  MAX_STACK_CHARS,
  parseStackFrames,
  pickAppFrame,
  stackStringOf,
} from "../../lib/source/stack";

const STACK = [
  "Error: react-stack-top-frame",
  "    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=abc:123:45)",
  "    at App (http://localhost:5173/src/App.tsx?t=1729:46:31)",
  "    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=abc:1234:5)",
  "    at Object.react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=abc:2000:9)",
].join("\n");

describe("parseStackFrames", () => {
  it("parses V8 frames with query strings and parenthesized names", () => {
    const frames = parseStackFrames(STACK);
    expect(frames.length).toBe(4);
    expect(frames[1]).toEqual({
      url: "http://localhost:5173/src/App.tsx?t=1729",
      line: 46,
      column: 31,
    });
  });

  it("parses frames without a function name and file URLs", () => {
    const frames = parseStackFrames(
      [
        "    at http://localhost:5173/src/App.tsx:10:5",
        "    at file:///D:/proj/src/App.tsx:11:6",
      ].join("\n"),
    );
    expect(frames).toEqual([
      { url: "http://localhost:5173/src/App.tsx", line: 10, column: 5 },
      { url: "file:///D:/proj/src/App.tsx", line: 11, column: 6 },
    ]);
  });

  it("ignores lines without a usable position", () => {
    expect(parseStackFrames("Error: boom\n    at foo (native)\n")).toEqual([]);
  });
});

describe("pickAppFrame", () => {
  it("skips React and Vite runtime frames and prefers the page origin", () => {
    expect(pickAppFrame(STACK, "http://localhost:5173")).toEqual({
      url: "http://localhost:5173/src/App.tsx?t=1729",
      line: 46,
      column: 31,
    });
  });

  it("falls back to the first non-runtime frame from another origin", () => {
    const stack = [
      "Error: x",
      "    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:1:1)",
      "    at App (https://cdn.example/src/App.tsx:5:6)",
    ].join("\n");
    expect(pickAppFrame(stack, "http://localhost:5173")).toEqual({
      url: "https://cdn.example/src/App.tsx",
      line: 5,
      column: 6,
    });
  });

  it("returns null when every frame is a runtime frame", () => {
    const stack = [
      "Error: x",
      "    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:1:1)",
      "    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=1:2:3)",
    ].join("\n");
    expect(pickAppFrame(stack, "http://localhost:5173")).toBeNull();
  });
});

describe("stackStringOf", () => {
  it("accepts Error objects, strings and stack-carrying objects", () => {
    expect(stackStringOf(new Error("boom"))).toContain("boom");
    expect(stackStringOf("Error: text")).toBe("Error: text");
    expect(stackStringOf({ stack: "Error: object" })).toBe("Error: object");
    expect(stackStringOf({ stack: 42 })).toBeNull();
    expect(stackStringOf(null)).toBeNull();
    expect(stackStringOf(undefined)).toBeNull();
  });

  it("caps very large stacks", () => {
    const huge = "x".repeat(MAX_STACK_CHARS + 1000);
    expect(stackStringOf(huge)?.length).toBe(MAX_STACK_CHARS);
  });
});
