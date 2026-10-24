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

function configure(overrides: Partial<ClientConfig> = {}): ClientConfig {
  const config = { ...BASE_CONFIG, ...overrides };
  globalThis.__TTC_CONFIG__ = config;
  install(config);
  return config;
}

function mountButton(): HTMLButtonElement {
  // Append instead of replacing innerHTML: install() appends the overlay host
  // to <body>, and tests may install before or after mounting.
  const main = document.createElement("main");
  const button = document.createElement("button");
  button.id = "target";
  button.type = "button";
  button.setAttribute("data-ttc", "app/components/Button.tsx:6:10");
  button.textContent = "count is 0";
  main.append(button);
  document.body.append(main);

  const hostFiber = {
    type: "button",
    memoizedProps: { "data-ttc": "app/components/Button.tsx:6:10" },
    return: {
      type: function Button() {
        return null;
      },
      memoizedProps: {
        "data-ttc": "app/routes/home.tsx:19:7",
        "data-ttc-name": "Button",
      },
      return: null,
    },
  };
  (button as unknown as Record<string, unknown>)["__reactFiber$test"] = hostFiber;
  return button;
}

function keydown(init: KeyboardEventInit): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
}

function keyup(init: KeyboardEventInit): void {
  window.dispatchEvent(
    new KeyboardEvent("keyup", { bubbles: true, cancelable: true, ...init }),
  );
}

function mouse(type: string, target: EventTarget, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 20,
    clientY: 30,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function modifierClick(target: Element, init: MouseEventInit): void {
  mouse("mousedown", target, { button: 0, ...init });
  mouse("click", target, { button: 0, ...init });
}

function shadow(): ShadowRoot {
  const host = document.querySelector("[data-ttc-ui]");
  if (!host?.shadowRoot) throw new Error("overlay missing");
  return host.shadowRoot;
}

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  globalThis.__TTC_CONFIG__ = undefined;
  document.body.innerHTML = "";
});

afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  globalThis.__TTC_CONFIG__ = undefined;
});

describe("configurable modifier", () => {
  it("arms on ctrl instead of alt when configured", () => {
    configure({ keyboard: ["ctrl"] });
    const button = mountButton();

    const altClick = mouse("click", button, { altKey: true, button: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(altClick.defaultPrevented).toBe(false);

    keydown({ key: "Control", ctrlKey: true });
    mouse("mousemove", button, { ctrlKey: true });
    modifierClick(button, { ctrlKey: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires every configured key", () => {
    configure({ keyboard: ["alt", "shift"] });
    const button = mountButton();

    keydown({ key: "Alt", altKey: true });
    modifierClick(button, { altKey: true });
    expect(fetchMock).not.toHaveBeenCalled();

    modifierClick(button, { altKey: true, shiftKey: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("open: 'menu'", () => {
  it("opens the chain menu instead of the editor", () => {
    configure({ open: "menu" });
    const button = mountButton();
    keydown({ key: "Alt", altKey: true });
    mouse("mousemove", button, { altKey: true });
    modifierClick(button, { altKey: true });

    expect(fetchMock).not.toHaveBeenCalled();
    const items = shadow().querySelectorAll(".ttc-menu-item");
    expect(items.length).toBe(2);
  });

  it("opens the editor for the clicked menu row", () => {
    configure({ open: "menu" });
    const button = mountButton();
    keydown({ key: "Alt", altKey: true });
    mouse("mousemove", button, { altKey: true });
    modifierClick(button, { altKey: true });

    const rows = shadow().querySelectorAll<HTMLButtonElement>(".ttc-menu-item");
    rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(decodeURIComponent(url)).toContain("app/routes/home.tsx:19:7");
  });
});

describe("menu: false", () => {
  it("does not intercept modifier + right click", () => {
    configure({ menu: false });
    mountButton();
    keydown({ key: "Alt", altKey: true });
    const event = mouse("contextmenu", document.body, { altKey: true, button: 2 });
    expect(event.defaultPrevented).toBe(false);
    const rows = shadow().querySelectorAll(".ttc-menu-item");
    expect(rows.length).toBe(0);
  });
});

describe("overlay lifecycle", () => {
  it("uninstall removes the overlay host and listeners", () => {
    configure();
    mountButton();
    expect(document.querySelector("[data-ttc-ui]")).toBeTruthy();
    uninstall();
    expect(document.querySelector("[data-ttc-ui]")).toBeNull();

    keydown({ key: "Alt", altKey: true });
    modifierClick(document.getElementById("target")!, { altKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releasing the modifier hides the hover overlay", () => {
    configure();
    const button = mountButton();
    keydown({ key: "Alt", altKey: true });
    mouse("mousemove", button, { altKey: true });
    const outline = shadow().querySelector<HTMLElement>(".ttc-outline");
    expect(outline).toBeTruthy();

    keyup({ key: "Alt", altKey: false });
    const after = shadow().querySelector<HTMLElement>(".ttc-outline");
    expect(after?.style.display ?? "none").toBe("none");
  });

  it("shows a success toast after opening a source", async () => {
    configure();
    const button = mountButton();
    keydown({ key: "Alt", altKey: true });
    mouse("mousemove", button, { altKey: true });
    modifierClick(button, { altKey: true });
    await vi.waitFor(() => {
      const toast = shadow().querySelector(".ttc-toast");
      expect(toast?.textContent ?? "").toContain("Opened");
    });
  });

  it("does nothing when the clicked element belongs to no marked tree", () => {
    configure();
    document.body.innerHTML = '<div id="plain">plain dom</div>';
    const plain = document.getElementById("plain")!;
    keydown({ key: "Alt", altKey: true });
    modifierClick(plain, { altKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("base path handling", () => {
  it("prefixes the editor request with the configured base", () => {
    configure({ base: "/dashboard/" });
    const button = mountButton();
    keydown({ key: "Alt", altKey: true });
    mouse("mousemove", button, { altKey: true });
    modifierClick(button, { altKey: true });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url.startsWith("/dashboard/__open-in-editor?file=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("D:/proj/app/routes/home.tsx:19:7");
  });
});

