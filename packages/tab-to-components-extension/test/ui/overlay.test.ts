// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EXT_ATTRIBUTE,
  Overlay,
  THEME_ATTRIBUTE,
  UI_ATTRIBUTE,
  UI_Z_INDEX,
  type MenuItem,
} from "../../lib/ui/overlay";

let overlay: Overlay | null = null;

function createOverlay(theme?: "dark" | "light"): Overlay {
  overlay = new Overlay(document, theme);
  return overlay;
}

function shadow(): ShadowRoot {
  if (overlay === null) throw new Error("overlay not created");
  return overlay.root;
}

function query<T extends Element>(selector: string): T | null {
  return shadow().querySelector<T>(selector);
}

function menu(): HTMLElement {
  const element = query<HTMLElement>(".ttc-menu");
  if (element === null) throw new Error("menu missing");
  return element;
}

function menuRows(): HTMLButtonElement[] {
  return Array.from(menu().querySelectorAll<HTMLButtonElement>(".ttc-menu-item"));
}

function menuItem(
  label: string,
  detail: string,
  onActivate: () => void = vi.fn(),
  action?: string,
): MenuItem {
  return action === undefined
    ? { label, detail, onActivate }
    : { label, detail, action, onActivate };
}

const HOVER = {
  rect: { left: 10.4, top: 20.6, width: 100.2, height: 30.8 },
  name: "Button",
  source: "app/routes/home.tsx:19:7",
  x: 40,
  y: 50,
};

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  overlay?.destroy();
  overlay = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("Overlay host contract", () => {
  it("mounts a fixed, pointer-transparent host with the extension attributes", () => {
    const instance = createOverlay();
    const host = instance.hostElement;

    expect(host.tagName).toBe("DIV");
    expect(host.getAttribute(UI_ATTRIBUTE)).toBe("");
    expect(host.getAttribute(EXT_ATTRIBUTE)).toBe("");
    expect(host.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
    expect(host.style.position).toBe("fixed");
    expect(host.style.pointerEvents).toBe("none");
    expect(host.style.zIndex).toBe(UI_Z_INDEX);
    expect(document.querySelectorAll(`[${UI_ATTRIBUTE}]`)).toHaveLength(1);
    expect(document.body.contains(host)).toBe(true);
    expect(instance.isConnected).toBe(true);
  });

  it("attaches an open shadow root holding the style and every overlay node", () => {
    const instance = createOverlay();

    expect(instance.root.host).toBe(instance.hostElement);
    expect(instance.root.mode).toBe("open");
    expect(instance.root.querySelector("style")).not.toBeNull();
    expect(query(".ttc-outline")).not.toBeNull();
    expect(query(".ttc-label")).not.toBeNull();
    expect(menu()).not.toBeNull();
    expect(query(".ttc-toast")).not.toBeNull();
    const toast = query<HTMLElement>(".ttc-toast");
    expect(toast?.getAttribute("role")).toBe("status");
    expect(toast?.getAttribute("aria-live")).toBe("polite");
    expect(menu().getAttribute("role")).toBe("menu");
    expect(menu().tabIndex).toBe(-1);
  });

  it("starts with every overlay part hidden by the shadow stylesheet", () => {
    createOverlay();
    // The parts carry no inline display until they are first shown; the style
    // block hides them, exactly like the Vite plugin.
    expect(query<HTMLElement>(".ttc-outline")?.style.display ?? "").toBe("");
    expect(query<HTMLElement>(".ttc-label")?.style.display ?? "").toBe("");
    expect(menu().style.display ?? "").toBe("");
    expect(query<HTMLElement>(".ttc-toast")?.style.display ?? "").toBe("");
    expect(overlay?.isMenuOpen).toBe(false);

    const css = query("style")?.textContent ?? "";
    for (const className of [".ttc-outline", ".ttc-label", ".ttc-menu", ".ttc-toast"]) {
      const block = css.slice(css.indexOf(`${className} {`), css.indexOf("}", css.indexOf(`${className} {`)));
      expect(block).toContain("display: none");
    }
  });

  it("uses the configured theme and ships both palettes selected by the host attribute", () => {
    createOverlay("light");
    expect(overlay?.hostElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");

    const css = query("style")?.textContent ?? "";
    expect(css).toContain(':host([data-ttc-theme="light"])');
    expect(css).toContain("--ttc-surface: rgba(16, 17, 22, 0.98)");
    expect(css).toContain("--ttc-surface: rgba(255, 255, 255, 0.98)");
    expect(css).toContain(".ttc-outline");
    expect(css).toContain(".ttc-label");
    expect(css).toContain(".ttc-menu-item[data-active]");
    expect(css).toContain('.ttc-toast[data-kind="error"]');
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("pointer-events: auto");
  });
});

describe("presentHover / hideHover", () => {
  it("draws a rounded outline and the name + source label", () => {
    createOverlay();
    overlay?.presentHover(HOVER);

    const outline = query<HTMLElement>(".ttc-outline");
    expect(outline?.style.display).toBe("block");
    expect(outline?.style.left).toBe("10px");
    expect(outline?.style.top).toBe("21px");
    expect(outline?.style.width).toBe("100px");
    expect(outline?.style.height).toBe("31px");

    const label = query<HTMLElement>(".ttc-label");
    expect(label?.style.display).toBe("flex");
    expect(label?.textContent).toBe("<Button />  app/routes/home.tsx:19:7");
  });

  it("places the label below the cursor and inside the viewport", () => {
    createOverlay();
    overlay?.presentHover(HOVER);
    const label = query<HTMLElement>(".ttc-label");
    const left = Number.parseFloat(label?.style.left ?? "");
    const top = Number.parseFloat(label?.style.top ?? "");

    expect(Number.isFinite(left)).toBe(true);
    expect(Number.isFinite(top)).toBe(true);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(left).toBeLessThanOrEqual(window.innerWidth);
    expect(top).toBeLessThanOrEqual(window.innerHeight);
  });

  it("hides the source segment and shows only the name without a location", () => {
    createOverlay();
    overlay?.presentHover({ ...HOVER, name: "button", source: "" });

    const label = query<HTMLElement>(".ttc-label");
    expect(label?.style.display).toBe("flex");
    expect(label?.textContent).toBe("<button />  ");
    expect(query<HTMLElement>(".ttc-label-source")?.style.display).toBe("none");
    expect(query<HTMLElement>(".ttc-outline")?.style.display).toBe("block");
  });

  it("hides the outline and label again", () => {
    createOverlay();
    overlay?.presentHover(HOVER);
    overlay?.hideHover();

    expect(query<HTMLElement>(".ttc-outline")?.style.display).toBe("none");
    expect(query<HTMLElement>(".ttc-label")?.style.display).toBe("none");
  });

  it("does not draw the hover while the menu is open", () => {
    createOverlay();
    overlay?.showMenu([menuItem("Open in IDE", "app/a.tsx:1:1")], 10, 10);
    overlay?.presentHover(HOVER);

    expect(query<HTMLElement>(".ttc-outline")?.style.display).toBe("none");
    expect(query<HTMLElement>(".ttc-label")?.style.display).toBe("none");
  });
});

describe("toasts", () => {
  it("shows a transient success toast", () => {
    createOverlay();
    overlay?.showToast("Copied file name: home.tsx");

    const toast = query<HTMLElement>(".ttc-toast");
    expect(toast?.style.display).toBe("block");
    expect(toast?.textContent).toBe("Copied file name: home.tsx");
    expect(toast?.hasAttribute("data-kind")).toBe(false);
  });

  it("marks error toasts and clears the marker on the next success", () => {
    createOverlay();
    overlay?.showToast("Could not copy", { error: true, duration: 4000 });
    const toast = query<HTMLElement>(".ttc-toast");
    expect(toast?.getAttribute("data-kind")).toBe("error");

    overlay?.showToast("Copied path: a.tsx");
    expect(toast?.hasAttribute("data-kind")).toBe(false);
  });

  it("auto-hides the toast after its duration", () => {
    vi.useFakeTimers();
    createOverlay();
    overlay?.showToast("hi", { duration: 1000 });

    vi.advanceTimersByTime(999);
    expect(query<HTMLElement>(".ttc-toast")?.style.display).toBe("block");
    vi.advanceTimersByTime(1);
    expect(query<HTMLElement>(".ttc-toast")?.style.display).toBe("none");
  });

  it("restarts the timer when a second toast replaces the first", () => {
    vi.useFakeTimers();
    createOverlay();
    overlay?.showToast("first", { duration: 1000 });
    vi.advanceTimersByTime(800);
    overlay?.showToast("second", { duration: 1000 });

    vi.advanceTimersByTime(500);
    expect(query<HTMLElement>(".ttc-toast")?.style.display).toBe("block");
    vi.advanceTimersByTime(500);
    expect(query<HTMLElement>(".ttc-toast")?.style.display).toBe("none");
  });

  it("hideToast hides immediately and cancels the pending timer", () => {
    vi.useFakeTimers();
    createOverlay();
    overlay?.showToast("hi", { duration: 1000 });
    overlay?.hideToast();
    expect(query<HTMLElement>(".ttc-toast")?.style.display).toBe("none");

    vi.advanceTimersByTime(5000);
    expect(query<HTMLElement>(".ttc-toast")?.style.display).toBe("none");
  });
});

describe("menu", () => {
  it("renders rows with label, detail, action and the active highlight", () => {
    const instance = createOverlay();
    const open = vi.fn();
    const copy = vi.fn();
    instance.showMenu(
      [
        menuItem("Open in IDE", "app/routes/home.tsx:19:7", open, "open"),
        menuItem("Copy file name", "home.tsx", copy, "copy-file"),
      ],
      40,
      50,
      { kind: "actions", ariaLabel: "Source actions" },
    );

    expect(instance.isMenuOpen).toBe(true);
    expect(menu().style.display).toBe("block");
    expect(menu().getAttribute("data-ttc-menu")).toBe("actions");
    expect(menu().getAttribute("aria-label")).toBe("Source actions");
    expect(menu().style.left).toBe("40px");
    expect(menu().style.top).toBe("50px");

    const rows = menuRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toBe("Open in IDE  app/routes/home.tsx:19:7");
    expect(rows[0]?.getAttribute("data-action")).toBe("open");
    expect(rows[0]?.getAttribute("type")).toBe("button");
    expect(rows[0]?.getAttribute("role")).toBe("menuitem");
    expect(rows[0]?.hasAttribute("data-active")).toBe(true);
    expect(rows[1]?.textContent).toBe("Copy file name  home.tsx");
    expect(rows[1]?.hasAttribute("data-active")).toBe(false);
  });

  it("defaults to the chain kind without an aria-label", () => {
    createOverlay();
    overlay?.showMenu([menuItem("<Button />", "app/a.tsx:1:1")], 10, 10);
    expect(menu().getAttribute("data-ttc-menu")).toBe("chain");
    expect(menu().hasAttribute("aria-label")).toBe(false);
  });

  it("does nothing for an empty item list", () => {
    createOverlay();
    overlay?.showMenu([], 10, 10);
    expect(overlay?.isMenuOpen).toBe(false);
    expect(menu().style.display ?? "").not.toBe("block");
    expect(menuRows()).toHaveLength(0);
  });

  it("closes before running the activated row's action", () => {
    const instance = createOverlay();
    const activated = vi.fn();
    instance.showMenu(
      [menuItem("Open in IDE", "app/a.tsx:1:1", vi.fn()), menuItem("Copy", "a.tsx", activated)],
      10,
      10,
      { kind: "actions" },
    );

    menuRows()[1]?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(activated).toHaveBeenCalledTimes(1);
    expect(instance.isMenuOpen).toBe(false);
    expect(menu().style.display).toBe("none");
    expect(menu().textContent).toBe("");
  });

  it("highlights on hover and wraps the index in both directions", () => {
    const instance = createOverlay();
    instance.showMenu(
      [
        menuItem("a", "a"),
        menuItem("b", "b"),
        menuItem("c", "c"),
      ],
      10,
      10,
    );

    menuRows()[2]?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(instance.activeMenuIndex).toBe(2);
    expect(menuRows()[2]?.hasAttribute("data-active")).toBe(true);

    instance.setMenuIndex(-1);
    expect(instance.activeMenuIndex).toBe(2);
    instance.setMenuIndex(3);
    expect(instance.activeMenuIndex).toBe(0);
    instance.moveMenuIndex(-1);
    expect(instance.activeMenuIndex).toBe(2);
    instance.moveMenuIndex(1);
    expect(instance.activeMenuIndex).toBe(0);
    expect(menuRows()[0]?.hasAttribute("data-active")).toBe(true);
  });

  it("closes without activating and clears its DOM", () => {
    const instance = createOverlay();
    const activated = vi.fn();
    instance.showMenu([menuItem("Open", "a.tsx", activated)], 10, 10, {
      kind: "actions",
      ariaLabel: "Actions",
    });
    instance.closeMenu();

    expect(activated).not.toHaveBeenCalled();
    expect(instance.isMenuOpen).toBe(false);
    expect(instance.activeMenuIndex).toBe(0);
    expect(menu().style.display).toBe("none");
    expect(menu().textContent).toBe("");
    expect(menu().hasAttribute("aria-label")).toBe(false);
  });
});

describe("menu keyboard handling", () => {
  function showThree(): Overlay {
    const instance = createOverlay();
    instance.showMenu(
      [menuItem("a", "a"), menuItem("b", "b"), menuItem("c", "c")],
      10,
      10,
    );
    return instance;
  }

  function key(key: string): KeyboardEvent {
    return new KeyboardEvent("keydown", { key });
  }

  it("ignores keys while the menu is closed", () => {
    createOverlay();
    expect(overlay?.handleMenuKey(key("ArrowDown"))).toBe(false);
    expect(overlay?.handleMenuKey(key("Enter"))).toBe(false);
  });

  it("moves the highlight with the arrow keys, Home and End", () => {
    const instance = showThree();

    expect(instance.handleMenuKey(key("ArrowDown"))).toBe(true);
    expect(instance.activeMenuIndex).toBe(1);
    expect(instance.handleMenuKey(key("ArrowDown"))).toBe(true);
    expect(instance.activeMenuIndex).toBe(2);
    expect(instance.handleMenuKey(key("ArrowUp"))).toBe(true);
    expect(instance.activeMenuIndex).toBe(1);
    expect(instance.handleMenuKey(key("End"))).toBe(true);
    expect(instance.activeMenuIndex).toBe(2);
    expect(instance.handleMenuKey(key("Home"))).toBe(true);
    expect(instance.activeMenuIndex).toBe(0);
    expect(instance.handleMenuKey(key("Tab"))).toBe(false);
  });

  it("activates the highlighted row with Enter or Space", () => {
    const instance = showThree();
    const rows = [
      vi.fn(),
      vi.fn(),
      vi.fn(),
    ];
    // Re-open with observable activations, then select the middle row.
    instance.showMenu(
      [
        menuItem("a", "a", rows[0]),
        menuItem("b", "b", rows[1]),
        menuItem("c", "c", rows[2]),
      ],
      10,
      10,
    );
    instance.setMenuIndex(1);

    expect(instance.handleMenuKey(key("Enter"))).toBe(true);
    expect(rows[1]).toHaveBeenCalledTimes(1);
    expect(instance.isMenuOpen).toBe(false);
  });

  it("activates with Space as well", () => {
    const instance = createOverlay();
    const activated = vi.fn();
    instance.showMenu([menuItem("only", "x", activated)], 10, 10);
    expect(instance.handleMenuKey(key(" "))).toBe(true);
    expect(activated).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape without activating", () => {
    const instance = showThree();
    expect(instance.handleMenuKey(key("Escape"))).toBe(true);
    expect(instance.isMenuOpen).toBe(false);
    expect(menu().style.display).toBe("none");
  });
});

describe("containsEvent", () => {
  /** What the inspector's window-level mousedown handler would ask. */
  function containsEventFor(target: EventTarget): boolean {
    let result = false;
    const handler = (received: Event): void => {
      result = overlay?.containsEvent(received) ?? false;
    };
    window.addEventListener("mousedown", handler, true);
    try {
      target.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, composed: true }),
      );
    } finally {
      window.removeEventListener("mousedown", handler, true);
    }
    return result;
  }

  it("detects events inside the menu and on the host, but not outside", () => {
    createOverlay();
    overlay?.showMenu([menuItem("a", "a")], 10, 10);

    expect(containsEventFor(document.body)).toBe(false);
    expect(containsEventFor(menu())).toBe(true);
    expect(containsEventFor(menuRows()[0]!)).toBe(true);
    if (overlay === null) throw new Error("overlay missing");
    expect(containsEventFor(overlay.hostElement)).toBe(true);
  });

  it("returns false for an event without a target or menu path", () => {
    createOverlay();
    const event = new MouseEvent("mousedown");
    expect(overlay?.containsEvent(event)).toBe(false);
  });
});

describe("destroy", () => {
  it("removes the host and every overlay capability", () => {
    const instance = createOverlay();
    const host = instance.hostElement;
    instance.presentHover(HOVER);
    instance.showToast("hi");

    instance.destroy();
    expect(instance.isConnected).toBe(false);
    expect(host.isConnected).toBe(false);
    expect(document.querySelector(`[${UI_ATTRIBUTE}]`)).toBeNull();

    instance.presentHover(HOVER);
    instance.showToast("late");
    instance.showMenu([menuItem("a", "a")], 1, 1);
    expect(instance.isMenuOpen).toBe(false);
    expect(query<HTMLElement>(".ttc-outline")?.style.display).toBe("none");
    expect(query<HTMLElement>(".ttc-toast")?.style.display).toBe("none");
    expect(() => instance.hideHover()).not.toThrow();
    expect(() => instance.hideToast()).not.toThrow();
    expect(() => instance.closeMenu()).not.toThrow();
  });

  it("is safe to call twice", () => {
    const instance = createOverlay();
    instance.destroy();
    expect(() => instance.destroy()).not.toThrow();
    expect(document.querySelector(`[${UI_ATTRIBUTE}]`)).toBeNull();
  });

  it("cancels a pending toast timer", () => {
    vi.useFakeTimers();
    const instance = createOverlay();
    instance.showToast("hi", { duration: 1000 });
    instance.destroy();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(instance.isConnected).toBe(false);
  });
});
