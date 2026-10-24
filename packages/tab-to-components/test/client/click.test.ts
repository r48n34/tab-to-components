// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { install, uninstall, type ClientConfig } from "../../src/client/index";

const BASE_CONFIG: ClientConfig = {
  version: "0.1.0",
  root: "D:/proj",
  base: "/",
  keyboard: ["alt"],
  open: "component",
  menu: true,
  editorEndpoint: "__open-in-editor",
};

let fetchMock: ReturnType<typeof vi.fn>;

function setConfig(overrides: Partial<ClientConfig> = {}): ClientConfig {
  const config = { ...BASE_CONFIG, ...overrides };
  globalThis.__TTC_CONFIG__ = config;
  return config;
}

/** Fake React tree: host <button> in Button.tsx, used by <Button /> in home.tsx. */
function mountReactButton(): HTMLButtonElement {
  document.body.innerHTML =
    '<main><button id="target" type="button" data-ttc="app/components/Button.tsx:6:10">count is 0</button></main>';
  const button = document.getElementById("target");
  if (!(button instanceof HTMLButtonElement)) throw new Error("missing target button");

  const homeFiber = {
    type: function Home() {
      return null;
    },
    memoizedProps: {},
    return: null,
  };
  const componentFiber = {
    type: function Button() {
      return null;
    },
    memoizedProps: {
      "data-ttc": "app/routes/home.tsx:19:7",
      "data-ttc-name": "Button",
    },
    return: homeFiber,
  };
  const hostFiber = {
    type: "button",
    memoizedProps: { "data-ttc": "app/components/Button.tsx:6:10" },
    return: componentFiber,
  };
  (button as unknown as Record<string, unknown>)["__reactFiber$test"] = hostFiber;
  return button;
}

function pressAlt(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Alt",
      altKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function mouseEvent(
  type: string,
  target: EventTarget,
  init: MouseEventInit = {},
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 12,
    clientY: 24,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function altClick(target: Element): { mousedown: MouseEvent; click: MouseEvent } {
  const mousedown = mouseEvent("mousedown", target, { altKey: true, button: 0 });
  const click = mouseEvent("click", target, { altKey: true, button: 0 });
  return { mousedown, click };
}

function shadowRoot(): ShadowRoot {
  const host = document.querySelector("[data-ttc-ui]");
  if (!host?.shadowRoot) throw new Error("overlay host/shadow root missing");
  return host.shadowRoot;
}

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  globalThis.__TTC_CONFIG__ = undefined;
  globalThis.__TTC_READY__ = undefined;
  globalThis.__TTC_VERSION__ = undefined;
  document.body.innerHTML = "";
});

afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  globalThis.__TTC_CONFIG__ = undefined;
  globalThis.__TTC_READY__ = undefined;
  globalThis.__TTC_VERSION__ = undefined;
});

describe("install", () => {
  it("boots from the injected global config and sets the ready flags", () => {
    const config = setConfig();
    install();

    expect(globalThis.__TTC_READY__).toBe(true);
    expect(globalThis.__TTC_VERSION__).toBe(config.version);
    expect(globalThis.__TTC_INSTALLED__).toBe(true);

    const host = document.querySelector("[data-ttc-ui]");
    expect(host).not.toBeNull();
    expect(host instanceof HTMLDivElement).toBe(true);
    expect((host as HTMLDivElement).style.pointerEvents).toBe("none");
  });

  it("is idempotent: installing twice replaces the previous overlay", () => {
    setConfig();
    install();
    const firstHost = document.querySelector("[data-ttc-ui]");

    install();

    const hosts = document.querySelectorAll("[data-ttc-ui]");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).not.toBe(firstHost);
    expect(globalThis.__TTC_READY__).toBe(true);
  });

  it("cleans everything up on uninstall", () => {
    setConfig();
    const button = mountReactButton();
    install();
    uninstall();

    expect(document.querySelector("[data-ttc-ui]")).toBeNull();
    expect(globalThis.__TTC_READY__).toBe(false);

    pressAlt();
    altClick(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("modifier + click", () => {
  it("opens the nearest component source and suppresses the app click", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    const { mousedown, click } = altClick(button);

    expect(mousedown.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7",
    );

    const shadow = shadowRoot();
    await vi.waitFor(() => {
      expect(shadow.textContent ?? "").toContain(
        "Opened <Button /> app/routes/home.tsx:19:7",
      );
    });
  });

  it("draws the hover overlay once the modifier is armed", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });

    const shadow = shadowRoot();
    await vi.waitFor(() => {
      const outline = shadow.querySelector<HTMLElement>(".ttc-outline");
      const label = shadow.querySelector<HTMLElement>(".ttc-label");
      expect(outline?.style.display).toBe("block");
      // The label is a flex container so its `gap`/`align-items` and the
      // ellipsis on the path actually apply.
      expect(label?.style.display).toBe("flex");
      expect(label?.textContent).toBe("<Button />  app/routes/home.tsx:19:7");
    });
  });

  it("leaves clicks untouched when the modifier is not held", () => {
    setConfig();
    const button = mountReactButton();
    install();

    const click = mouseEvent("click", button, { button: 0 });

    expect(click.defaultPrevented).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the clicked host element when open is 'element'", () => {
    setConfig({ open: "element" });
    const button = mountReactButton();
    install();

    pressAlt();
    altClick(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Fcomponents%2FButton.tsx%3A6%3A10",
    );
  });

  it("prefixes the editor url with the Vite base", () => {
    setConfig({ base: "/app/" });
    const button = mountReactButton();
    install();

    pressAlt();
    altClick(button);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/app/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7",
    );
  });

  it("shows a copyable path toast when the editor request fails", async () => {
    setConfig();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const button = mountReactButton();
    install();

    pressAlt();
    altClick(button);

    const shadow = shadowRoot();
    await vi.waitFor(() => {
      expect(shadow.textContent ?? "").toContain(
        "D:/proj/app/routes/home.tsx:19:7",
      );
    });
  });
});

describe("component chain menu", () => {
  it("opens on Alt+right-click and supports keyboard navigation", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    const contextmenu = mouseEvent("contextmenu", button, {
      altKey: true,
      clientX: 40,
      clientY: 50,
    });
    expect(contextmenu.defaultPrevented).toBe(true);

    const shadow = shadowRoot();
    const rows = Array.from(
      shadow.querySelectorAll<HTMLElement>(".ttc-menu-item"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toBe("<button />  app/components/Button.tsx:6:10");
    expect(rows[1]?.textContent).toBe("<Button />  app/routes/home.tsx:19:7");
    expect(rows[0]?.hasAttribute("data-active")).toBe(true);

    const down = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(rows[1]?.hasAttribute("data-active")).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
    );
    expect(rows[0]?.hasAttribute("data-active")).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7",
    );

    await vi.waitFor(() => {
      expect(shadow.querySelector<HTMLElement>(".ttc-menu")?.style.display).toBe(
        "none",
      );
    });
  });

  it("closes on Escape and on an outside click", () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("contextmenu", button, { altKey: true });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(shadowRoot().querySelector<HTMLElement>(".ttc-menu")?.style.display).toBe(
      "none",
    );

    pressAlt();
    mouseEvent("contextmenu", button, { altKey: true });
    expect(shadowRoot().querySelector<HTMLElement>(".ttc-menu")?.style.display).toBe(
      "block",
    );

    mouseEvent("mousedown", document.body, { button: 0 });
    expect(shadowRoot().querySelector<HTMLElement>(".ttc-menu")?.style.display).toBe(
      "none",
    );
  });

  it("does not swallow the next click after a right-button menu dismissal", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("contextmenu", button, { altKey: true });
    expect(
      shadowRoot().querySelector<HTMLElement>(".ttc-menu")?.style.display,
    ).toBe("block");

    // A right-button press outside the menu closes it and produces no `click`,
    // so it must not arm click suppression for the next real click.
    mouseEvent("mousedown", document.body, { button: 2 });
    expect(
      shadowRoot().querySelector<HTMLElement>(".ttc-menu")?.style.display,
    ).toBe("none");

    const { click } = altClick(button);
    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("does nothing on right-click when the menu is disabled", () => {
    setConfig({ menu: false });
    const button = mountReactButton();
    install();

    const contextmenu = mouseEvent("contextmenu", button, { altKey: true });

    expect(contextmenu.defaultPrevented).toBe(false);
    expect(shadowRoot().querySelectorAll(".ttc-menu-item")).toHaveLength(0);
  });

  it("ignores right-click without the modifier", () => {
    setConfig();
    const button = mountReactButton();
    install();

    const contextmenu = mouseEvent("contextmenu", button);

    expect(contextmenu.defaultPrevented).toBe(false);
    expect(shadowRoot().querySelectorAll(".ttc-menu-item")).toHaveLength(0);
  });
});

describe("hover lifecycle", () => {
  it("does not draw the outline until the modifier is armed", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    mouseEvent("mousemove", button);
    const outline = shadowRoot().querySelector<HTMLElement>(".ttc-outline");
    expect(outline?.style.display ?? "none").toBe("none");

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    await vi.waitFor(() => {
      expect(
        shadowRoot().querySelector<HTMLElement>(".ttc-outline")?.style.display,
      ).toBe("block");
    });
  });

  it("hides the hover outline on Escape", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    await vi.waitFor(() => {
      expect(
        shadowRoot().querySelector<HTMLElement>(".ttc-outline")?.style.display,
      ).toBe("block");
    });

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(
      shadowRoot().querySelector<HTMLElement>(".ttc-outline")?.style.display ??
        "none",
    ).toBe("none");
  });

  it("hides the hover outline when the window loses focus", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    await vi.waitFor(() => {
      expect(
        shadowRoot().querySelector<HTMLElement>(".ttc-outline")?.style.display,
      ).toBe("block");
    });

    window.dispatchEvent(new Event("blur"));

    expect(
      shadowRoot().querySelector<HTMLElement>(".ttc-outline")?.style.display ??
        "none",
    ).toBe("none");
  });

  it("clears the hover target when the pointer leaves the window", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    mouseEvent("mouseout", button, { relatedTarget: null });

    expect(
      shadowRoot().querySelector<HTMLElement>(".ttc-outline")?.style.display ??
        "none",
    ).toBe("none");
  });
});
