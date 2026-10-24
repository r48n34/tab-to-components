// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  describeFiber,
  getComponentChain,
  getFiberForElement,
  getFiberMarker,
  getFiberMarkerName,
  getFiberProps,
  nearestComponentEntry,
  pickPrimaryEntry,
  type ChainEntry,
} from "../../src/client/index";

interface FakeFiber {
  type: unknown;
  memoizedProps: Record<string, unknown> | null;
  pendingProps?: Record<string, unknown> | null;
  return: FakeFiber | null;
}

function fiber(
  type: unknown,
  props: Record<string, unknown> | null = null,
  parent: FakeFiber | null = null,
): FakeFiber {
  return { type, memoizedProps: props, return: parent };
}

function attachFiber(element: Element, value: FakeFiber): void {
  (element as unknown as Record<string, unknown>)["__reactFiber$test"] = value;
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  const root = document.body.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error("expected an element root");
  return root;
}

function names(chain: ChainEntry[]): string[] {
  return chain.map((entry) => entry.name);
}

function anonymousFunction(): () => null {
  const fn = (): null => null;
  Object.defineProperty(fn, "name", { value: "", configurable: true });
  return fn;
}

describe("getFiberForElement", () => {
  it("returns null for elements React never touched", () => {
    const element = mount("<div><span id='leaf'></span></div>");
    expect(getFiberForElement(element)).toBeNull();
    expect(getFiberForElement(null)).toBeNull();
  });

  it("finds the fiber under __reactFiber$ and legacy __reactInternalInstance$ keys", () => {
    const element = mount("<button>hi</button>");
    const modern = fiber("button", { "data-ttc": "app/a.tsx:1:1" });
    attachFiber(element, modern);
    expect(getFiberForElement(element)).toBe(modern);

    const legacyElement = document.createElement("div");
    const legacy = fiber("div", { "data-ttc": "app/b.tsx:2:2" });
    (legacyElement as unknown as Record<string, unknown>)["__reactInternalInstance$abc123"] =
      legacy;
    expect(getFiberForElement(legacyElement)).toBe(legacy);
  });
});

describe("getFiberProps / getFiberMarker / getFiberMarkerName", () => {
  it("prefers memoizedProps and falls back to pendingProps", () => {
    expect(getFiberProps(fiber("div", { id: "a" }))).toEqual({ id: "a" });
    const pending = { memoizedProps: null, pendingProps: { id: "b" }, type: "div", return: null };
    expect(getFiberProps(pending)).toEqual({ id: "b" });
    expect(getFiberProps(null)).toBeNull();
  });

  it("reads the injected marker and marker name off the props", () => {
    const nodeFiber = fiber("button", {
      "data-ttc": "app/components/Button.tsx:6:10",
      "data-ttc-name": "Button",
    });
    expect(getFiberMarker(nodeFiber)).toEqual({
      file: "app/components/Button.tsx",
      line: 6,
      column: 10,
    });
    expect(getFiberMarkerName(nodeFiber)).toBe("Button");
    expect(getFiberMarker(fiber("button", {}))).toBeNull();
    expect(getFiberMarkerName(fiber("button", {}))).toBe("");
  });
});

describe("describeFiber", () => {
  it("detects host elements by their string type", () => {
    expect(describeFiber(fiber("button"))).toEqual({ name: "button", isHost: true });
  });

  it("names function and class components, honouring displayName", () => {
    function Card(): null {
      return null;
    }
    expect(describeFiber(fiber(Card))).toEqual({ name: "Card", isHost: false });

    function Button(): null {
      return null;
    }
    Button.displayName = "PrettyButton";
    expect(describeFiber(fiber(Button))).toEqual({
      name: "PrettyButton",
      isHost: false,
    });

    class LegacyCard {
      render(): null {
        return null;
      }
    }
    expect(describeFiber(fiber(LegacyCard))).toEqual({ name: "LegacyCard", isHost: false });
  });

  it("unwraps memo to the inner component name", () => {
    function InnerButton(): null {
      return null;
    }
    const memoType = { $$typeof: Symbol.for("react.memo"), type: InnerButton, compare: null };
    expect(describeFiber(fiber(memoType))).toEqual({ name: "InnerButton", isHost: false });
  });

  it("unwraps forwardRef to the render function name", () => {
    function FancyInput(): null {
      return null;
    }
    const forwardRefType = { $$typeof: Symbol.for("react.forward_ref"), render: FancyInput };
    expect(describeFiber(fiber(forwardRefType))).toEqual({
      name: "FancyInput",
      isHost: false,
    });
  });

  it("unwraps memo(forwardRef(...))", () => {
    function RenderInner(): null {
      return null;
    }
    const forwardRefType = { $$typeof: Symbol.for("react.forward_ref"), render: RenderInner };
    const memoType = { $$typeof: Symbol.for("react.memo"), type: forwardRefType };
    expect(describeFiber(fiber(memoType))).toEqual({ name: "RenderInner", isHost: false });
  });

  it("falls back to data-ttc-name for anonymous wrappers", () => {
    expect(
      describeFiber(
        fiber(anonymousFunction(), {
          "data-ttc": "app/widget.tsx:4:2",
          "data-ttc-name": "Widget",
        }),
      ),
    ).toEqual({ name: "Widget", isHost: false });

    const memoType = { $$typeof: Symbol.for("react.memo"), type: anonymousFunction() };
    expect(
      describeFiber(
        fiber(memoType, { "data-ttc": "app/x.tsx:1:1", "data-ttc-name": "Foo.Bar" }),
      ),
    ).toEqual({ name: "Foo.Bar", isHost: false });
  });

  it("uses Anonymous when nothing names the component", () => {
    expect(describeFiber(fiber(anonymousFunction()))).toEqual({
      name: "Anonymous",
      isHost: false,
    });
  });
});

describe("getComponentChain", () => {
  it("walks marked fibers from the host element outwards", () => {
    const host = mount("<button id='target'>hi</button>");
    const home = fiber(function Home() {
      return null;
    }, {});
    const component = fiber(
      function Button() {
        return null;
      },
      { "data-ttc": "app/routes/home.tsx:19:7", "data-ttc-name": "Button" },
      home,
    );
    const hostFiber = fiber(
      "button",
      { "data-ttc": "app/components/Button.tsx:6:10" },
      component,
    );
    attachFiber(host, hostFiber);

    const chain = getComponentChain(host);

    expect(names(chain)).toEqual(["button", "Button"]);
    expect(chain.map((entry) => entry.isHost)).toEqual([true, false]);
    expect(chain[0]?.marker).toEqual({
      file: "app/components/Button.tsx",
      line: 6,
      column: 10,
    });
    expect(chain[1]?.marker).toEqual({
      file: "app/routes/home.tsx",
      line: 19,
      column: 7,
    });
  });

  it("skips fibers that carry no data-ttc marker", () => {
    const host = mount("<button id='target'>hi</button>");
    const root = fiber(function Root() {
      return null;
    }, {});
    const component = fiber(
      function Button() {
        return null;
      },
      { "data-ttc": "app/routes/home.tsx:19:7" },
      root,
    );
    const wrapperHost = fiber("div", { className: "wrapper" }, component);
    const hostFiber = fiber("button", { "data-ttc": "app/components/Button.tsx:6:10" }, wrapperHost);
    attachFiber(host, hostFiber);

    expect(names(getComponentChain(host))).toEqual(["button", "Button"]);
  });

  it("returns an empty chain when no fiber or marker exists", () => {
    const host = mount("<div><span id='leaf'></span></div>");
    expect(getComponentChain(host)).toEqual([]);
    const leaf = document.getElementById("leaf");
    expect(getComponentChain(leaf)).toEqual([]);
    expect(getComponentChain(null)).toEqual([]);
  });

  it("falls back to the closest [data-ttc] DOM ancestor when no fiber is found", () => {
    const root = mount(
      '<div data-ttc="app/components/Shell.tsx:2:4"><span id="leaf"></span></div>',
    );
    const leaf = document.getElementById("leaf");
    expect(getComponentChain(leaf)).toEqual([
      {
        name: restTagName(root),
        isHost: true,
        marker: { file: "app/components/Shell.tsx", line: 2, column: 4 },
      },
    ]);
  });

  it("stops on cyclic fiber chains", () => {
    const host = mount("<button id='target'>hi</button>");
    const loop = fiber("button", { "data-ttc": "app/components/Button.tsx:6:10" });
    loop.return = loop;
    attachFiber(host, loop);
    expect(names(getComponentChain(host))).toEqual(["button"]);
  });
});

function restTagName(element: HTMLElement): string {
  return element.tagName.toLowerCase();
}

describe("chain lookups", () => {
  const hostEntry: ChainEntry = {
    name: "button",
    isHost: true,
    marker: { file: "app/components/Button.tsx", line: 6, column: 10 },
  };
  const componentEntry: ChainEntry = {
    name: "Button",
    isHost: false,
    marker: { file: "app/routes/home.tsx", line: 19, column: 7 },
  };

  it("finds the nearest component entry", () => {
    expect(nearestComponentEntry([hostEntry, componentEntry])).toBe(componentEntry);
    expect(nearestComponentEntry([hostEntry])).toBeNull();
  });

  it("picks the entry for each open mode", () => {
    expect(pickPrimaryEntry([hostEntry, componentEntry], "component")).toBe(componentEntry);
    expect(pickPrimaryEntry([hostEntry, componentEntry], "menu")).toBe(componentEntry);
    expect(pickPrimaryEntry([hostEntry, componentEntry], "element")).toBe(hostEntry);
    expect(pickPrimaryEntry([hostEntry], "component")).toBe(hostEntry);
    expect(pickPrimaryEntry([], "component")).toBeNull();
  });
});
