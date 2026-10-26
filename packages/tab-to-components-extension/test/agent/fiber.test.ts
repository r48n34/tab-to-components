// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  buildRawChain,
  describeFiber,
  detectReactKind,
  findFiberInDocument,
  getDebugSource,
  getDebugStack,
  getFiberForElement,
  getFiberMarker,
  type FiberLike,
} from "../../lib/agent/fiber";

const ORIGIN = "http://localhost:5173";

const REACT19_STACK = [
  "Error: react-stack-top-frame",
  "    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:120:15)",
  "    at Button (http://localhost:5173/src/components/Button.tsx?t=1:10:7)",
  "    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=1:1600:9)",
].join("\n");

function fiber(partial: Partial<FiberLike> = {}): FiberLike {
  return { type: "div", memoizedProps: {}, ...partial };
}

function attach(element: Element, value: FiberLike): void {
  (element as unknown as Record<string, unknown>)["__reactFiber$test"] = value;
}

describe("getFiberForElement", () => {
  it("finds fibers under both React property prefixes", () => {
    const element = document.createElement("button");
    attach(element, fiber());
    expect(getFiberForElement(element)).not.toBeNull();

    const legacy = document.createElement("span");
    (legacy as unknown as Record<string, unknown>)["__reactInternalInstance$abc"] =
      fiber();
    expect(getFiberForElement(legacy)).not.toBeNull();
  });

  it("returns null for non-React elements and nullish input", () => {
    expect(getFiberForElement(document.createElement("div"))).toBeNull();
    expect(getFiberForElement(null)).toBeNull();
    expect(getFiberForElement(undefined)).toBeNull();
  });
});

describe("describeFiber", () => {
  it("names host elements by their tag", () => {
    expect(describeFiber(fiber({ type: "button" }))).toEqual({
      name: "button",
      isHost: true,
    });
  });

  it("uses function names and displayName", () => {
    function Button() {
      return null;
    }
    expect(describeFiber(fiber({ type: Button }))).toEqual({
      name: "Button",
      isHost: false,
    });
    function Inner() {
      return null;
    }
    Inner.displayName = "PrettyInner";
    expect(describeFiber(fiber({ type: Inner })).name).toBe("PrettyInner");
  });

  it("unwraps memo, forwardRef and lazy wrappers", () => {
    function Wrapped() {
      return null;
    }
    expect(describeFiber(fiber({ type: { type: Wrapped } })).name).toBe("Wrapped");
    expect(describeFiber(fiber({ type: { render: Wrapped } })).name).toBe("Wrapped");
    expect(
      describeFiber(fiber({ type: { _payload: { _result: Wrapped } } })).name,
    ).toBe("Wrapped");
  });

  it("falls back to the marker name hint and then Anonymous", () => {
    const anonymous = () => null;
    Object.defineProperty(anonymous, "name", { value: "", configurable: true });
    expect(
      describeFiber(
        fiber({
          type: anonymous,
          memoizedProps: { "data-ttc-name": "Hinted" },
        }),
      ).name,
    ).toBe("Hinted");
    expect(describeFiber(fiber({ type: anonymous })).name).toBe("Anonymous");
  });
});

describe("source evidence", () => {
  it("reads a valid React 18 _debugSource", () => {
    const debugSource = {
      fileName: "D:/proj/src/App.tsx",
      lineNumber: 20,
      columnNumber: 9,
    };
    expect(getDebugSource(fiber({ _debugSource: debugSource }))).toEqual(
      debugSource,
    );
    expect(getDebugSource(fiber({ _debugSource: { fileName: "" } }))).toBeNull();
    expect(getDebugSource(fiber({ _debugSource: { lineNumber: 0 } }))).toBeNull();
    expect(getDebugSource(fiber())).toBeNull();
  });

  it("reads React 19 _debugStack from strings and Error objects", () => {
    expect(getDebugStack(fiber({ _debugStack: REACT19_STACK }))).toBe(
      REACT19_STACK,
    );
    expect(getDebugStack(fiber({ _debugStack: new Error("boom") }))).toContain(
      "boom",
    );
    expect(getDebugStack(fiber())).toBeNull();
  });

  it("detects which React source mechanism is available", () => {
    expect(detectReactKind(null)).toBe("unknown");
    expect(detectReactKind(fiber())).toBe("unknown");
    expect(
      detectReactKind(
        fiber({
          _debugSource: {
            fileName: "D:/proj/src/App.tsx",
            lineNumber: 1,
            columnNumber: 1,
          },
        }),
      ),
    ).toBe("18");
    expect(detectReactKind(fiber({ _debugStack: REACT19_STACK }))).toBe("19");
  });

  it("reads Vite plugin marker props", () => {
    expect(
      getFiberMarker(fiber({ memoizedProps: { "data-ttc": "src/App.tsx:1:2" } })),
    ).toBe("src/App.tsx:1:2");
    expect(getFiberMarker(fiber({ memoizedProps: {} }))).toBeNull();
  });
});

describe("buildRawChain", () => {
  it("walks from the host element outwards, keeping entries with evidence", () => {
    const app = fiber({
      type: function App() {
        return null;
      },
      _debugSource: {
        fileName: "D:/proj/src/App.tsx",
        lineNumber: 9,
        columnNumber: 5,
      },
      return: null,
    });
    const button = fiber({
      type: function Button() {
        return null;
      },
      _debugSource: {
        fileName: "D:/proj/src/App.tsx",
        lineNumber: 20,
        columnNumber: 9,
      },
      return: app,
    });
    const host = fiber({ type: "button", _debugStack: REACT19_STACK, return: button });

    const chain = buildRawChain(host, ORIGIN);
    expect(chain.map((entry) => entry.name)).toEqual(["button", "Button", "App"]);
    expect(chain[0]?.isHost).toBe(true);
    expect(chain[0]?.stackFrame).toEqual({
      url: "http://localhost:5173/src/components/Button.tsx?t=1",
      line: 10,
      column: 7,
    });
    expect(chain[1]?.debugSource?.lineNumber).toBe(20);
    expect(chain[2]?.debugSource?.lineNumber).toBe(9);
  });

  it("skips fibers without any source evidence", () => {
    const parent = fiber({
      type: function Parent() {
        return null;
      },
      return: null,
    });
    const noEvidence = fiber({ type: "div", return: parent });
    expect(buildRawChain(noEvidence, ORIGIN)).toEqual([]);
  });

  it("stops on cyclic fiber trees", () => {
    const cyclic = fiber({ type: "button", _debugStack: REACT19_STACK });
    cyclic.return = cyclic;
    expect(buildRawChain(cyclic, ORIGIN)).toHaveLength(1);
  });

  it("returns an empty chain for a null fiber", () => {
    expect(buildRawChain(null, ORIGIN)).toEqual([]);
  });
});

describe("findFiberInDocument", () => {
  it("finds the first element with a fiber", () => {
    document.body.innerHTML = "<div><button id='target'></button></div>";
    const target = document.getElementById("target");
    if (target === null) throw new Error("missing target");
    attach(target, fiber({ type: "button", _debugStack: REACT19_STACK }));
    const found = findFiberInDocument(document);
    expect(found).not.toBeNull();
    expect(detectReactKind(found)).toBe("19");
  });

  it("returns null on a page without React", () => {
    document.body.innerHTML = "<div><span>plain</span></div>";
    expect(findFiberInDocument(document)).toBeNull();
  });
});
