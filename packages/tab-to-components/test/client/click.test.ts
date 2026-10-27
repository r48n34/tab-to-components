// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { install, uninstall, type ClientConfig } from "../../src/client/index";

const BASE_CONFIG: ClientConfig = {
  version: "0.1.0",
  root: "D:/proj",
  base: "/",
  keyboard: ["alt"],
  open: "component",
  clickActions: ["open", "copy-file", "copy-full-path"],
  menu: true,
  theme: "dark",
  editorEndpoint: "__open-in-editor",
};

let fetchMock: ReturnType<typeof vi.fn>;
let clipboardWrite: ReturnType<typeof vi.fn>;

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

function keydown(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

function shadowRoot(): ShadowRoot {
  const host = document.querySelector("[data-ttc-ui]");
  if (!host?.shadowRoot) throw new Error("overlay host/shadow root missing");
  return host.shadowRoot;
}

function actionMenu(): HTMLElement | null {
  return shadowRoot().querySelector<HTMLElement>('[data-ttc-menu="actions"]');
}

function actionRows(): HTMLButtonElement[] {
  return Array.from(
    shadowRoot().querySelectorAll<HTMLButtonElement>(
      '[data-ttc-menu="actions"] .ttc-menu-item',
    ),
  );
}

function rowWithLabel(label: string): HTMLButtonElement {
  const row = actionRows().find((candidate) =>
    (candidate.textContent ?? "").startsWith(label),
  );
  if (!row) throw new Error(`action row "${label}" missing`);
  return row;
}

function clickRow(row: HTMLButtonElement): void {
  row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  clipboardWrite = vi.fn(async () => {});
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
  globalThis.__TTC_CONFIG__ = undefined;
  globalThis.__TTC_READY__ = undefined;
  globalThis.__TTC_VERSION__ = undefined;
  document.body.innerHTML = "";
});

afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
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

describe("source action picker", () => {
  it("opens the action picker and suppresses the app click", () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    const { mousedown, click } = altClick(button);

    expect(mousedown.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(actionMenu()?.style.display).toBe("block");
    const rows = actionRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toBe("Open in IDE  app/routes/home.tsx:19:7");
    expect(rows[1]?.textContent).toBe("Copy file name  home.tsx");
    expect(rows[2]?.textContent).toBe(
      "Copy full path  D:/proj/app/routes/home.tsx",
    );
    expect(rows[0]?.hasAttribute("data-active")).toBe(true);
    // Each row leads with a decorative icon describing what it acts on; the
    // icon must not leak into the row's text.
    expect(
      rows[0]?.querySelector('.ttc-menu-icon[data-icon="open"]'),
    ).not.toBeNull();
    expect(
      rows[1]?.querySelector('.ttc-menu-icon[data-icon="copy-file"]'),
    ).not.toBeNull();
    expect(
      rows[2]?.querySelector('.ttc-menu-icon[data-icon="copy-full-path"]'),
    ).not.toBeNull();
    const icon = rows[0]?.querySelector(".ttc-menu-icon");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.getAttribute("focusable")).toBe("false");
  });

  it("opens the editor when the first action is chosen", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    altClick(button);
    clickRow(rowWithLabel("Open in IDE"));

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

  it("copies the file name without opening the editor", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    altClick(button);
    clickRow(rowWithLabel("Copy file name"));

    await vi.waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
    });
    expect(clipboardWrite.mock.calls[0]?.[0]).toBe("home.tsx");
    expect(fetchMock).not.toHaveBeenCalled();

    const shadow = shadowRoot();
    await vi.waitFor(() => {
      expect(shadow.textContent ?? "").toContain("Copied file name: home.tsx");
    });
    expect(actionMenu()?.style.display ?? "none").toBe("none");
  });

  it("copies the full absolute path without opening the editor", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    altClick(button);
    clickRow(rowWithLabel("Copy full path"));

    await vi.waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
    });
    expect(clipboardWrite.mock.calls[0]?.[0]).toBe(
      "D:/proj/app/routes/home.tsx",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    const shadow = shadowRoot();
    await vi.waitFor(() => {
      expect(shadow.textContent ?? "").toContain(
        "Copied full path: D:/proj/app/routes/home.tsx",
      );
    });
  });

  it("offers the configured copy path and location actions", async () => {
    setConfig({ clickActions: ["copy-path", "copy-location"] });
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    altClick(button);

    const rows = actionRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toBe(
      "Copy relative path  app/routes/home.tsx",
    );
    expect(rows[1]?.textContent).toBe(
      "Copy file:line:column  app/routes/home.tsx:19:7",
    );
    expect(
      rows[0]?.querySelector('.ttc-menu-icon[data-icon="copy-path"]'),
    ).not.toBeNull();
    expect(
      rows[1]?.querySelector('.ttc-menu-icon[data-icon="copy-location"]'),
    ).not.toBeNull();

    clickRow(rowWithLabel("Copy relative path"));
    await vi.waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
    });
    expect(clipboardWrite.mock.calls[0]?.[0]).toBe("app/routes/home.tsx");

    pressAlt();
    altClick(button);
    clickRow(rowWithLabel("Copy file:line:column"));
    await vi.waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledTimes(2);
    });
    expect(clipboardWrite.mock.calls[1]?.[0]).toBe(
      "app/routes/home.tsx:19:7",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs a single configured open action immediately, without a picker", () => {
    setConfig({ clickActions: ["open"] });
    const button = mountReactButton();
    install();

    pressAlt();
    altClick(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7",
    );
    expect(actionRows()).toHaveLength(0);
  });

  it("offers the four per-IDE open actions with their own icons", () => {
    setConfig({
      clickActions: ["open-code", "open-cursor", "open-webstorm", "open-trae"],
    });
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    const { click } = altClick(button);
    expect(click.defaultPrevented).toBe(true);

    const rows = actionRows();
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.textContent)).toEqual([
      "Open in VS Code  app/routes/home.tsx:19:7",
      "Open in Cursor  app/routes/home.tsx:19:7",
      "Open in WebStorm  app/routes/home.tsx:19:7",
      "Open in Trae  app/routes/home.tsx:19:7",
    ]);
    expect(
      rows.map((row) =>
        row.querySelector(".ttc-menu-icon")?.getAttribute("data-icon"),
      ),
    ).toEqual([
      "open-code",
      "open-cursor",
      "open-webstorm",
      "open-trae",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the picked IDE through the editor endpoint", async () => {
    setConfig({
      clickActions: ["open-code", "open-cursor", "open-webstorm", "open-trae"],
    });
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    altClick(button);
    clickRow(rowWithLabel("Open in Cursor"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7&ide=cursor",
    );

    const shadow = shadowRoot();
    await vi.waitFor(() => {
      expect(shadow.textContent ?? "").toContain(
        "Opened <Button /> app/routes/home.tsx:19:7 in Cursor",
      );
    });
  });

  it("runs a single configured per-IDE action immediately, without a picker", async () => {
    setConfig({ clickActions: ["open-trae"] });
    const button = mountReactButton();
    install();

    pressAlt();
    altClick(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7&ide=trae",
    );
    expect(actionRows()).toHaveLength(0);

    const shadow = shadowRoot();
    await vi.waitFor(() => {
      expect(shadow.textContent ?? "").toContain(
        "Opened <Button /> app/routes/home.tsx:19:7 in Trae",
      );
    });
  });

  it("runs a single configured copy action immediately, without a picker", async () => {
    setConfig({ clickActions: ["copy-file"] });
    const button = mountReactButton();
    install();

    pressAlt();
    altClick(button);

    await vi.waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith("home.tsx");
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(actionRows()).toHaveLength(0);
  });

  it("offers the AI and share presets with their own icons", async () => {
    setConfig({
      clickActions: [
        "copy-ai-context",
        "copy-mention",
        "copy-markdown",
        "copy-chain",
      ],
    });
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    altClick(button);

    const rows = actionRows();
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent?.startsWith(
      "Copy for AI  Target: <Button /> — app/routes/home.tsx:19:7",
    )).toBe(true);
    expect(rows[1]?.textContent).toBe(
      "Copy @mention  @app/routes/home.tsx:19:7",
    );
    expect(rows[2]?.textContent).toBe(
      "Copy as Markdown  `<Button />` — `app/routes/home.tsx:19:7`",
    );
    expect(rows[3]?.textContent).toBe(
      "Copy component chain  Button > button",
    );
    expect(
      rows.map((row) =>
        row.querySelector(".ttc-menu-icon")?.getAttribute("data-icon"),
      ),
    ).toEqual(["sparkles", "at", "markdown", "component"]);

    clickRow(rowWithLabel("Copy for AI"));
    await vi.waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
    });
    expect(clipboardWrite.mock.calls[0]?.[0]).toBe(
      [
        "Target: <Button /> — app/routes/home.tsx:19:7",
        "Component chain (outermost → innermost):",
        "1. <Button /> — app/routes/home.tsx:19:7",
        "2. <button /> — app/components/Button.tsx:6:10",
      ].join("\n"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(shadowRoot().textContent ?? "").toContain(
        "Copied AI context: app/routes/home.tsx:19:7",
      );
    });
  });

  it("appends custom actions after the built-in rows and copies their template", async () => {
    setConfig({
      clickActions: ["open", "copy-file"],
      customActions: [
        {
          id: "review",
          label: "Copy review prompt",
          copy: "Review {name} at {location} on {chain}",
          icon: "sparkles",
        },
      ],
    });
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    altClick(button);

    const rows = actionRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain("Open in IDE");
    expect(rows[1]?.textContent).toContain("Copy file name");
    expect(rows[2]?.textContent).toBe(
      "Copy review prompt  Review Button at app/routes/home.tsx:19:7 on Button > button",
    );
    expect(rows[2]?.getAttribute("data-action")).toBe("custom:review");
    expect(
      rows[2]?.querySelector('.ttc-menu-icon[data-icon="sparkles"]'),
    ).not.toBeNull();

    clickRow(rowWithLabel("Copy review prompt"));
    await vi.waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith(
        "Review Button at app/routes/home.tsx:19:7 on Button > button",
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(shadowRoot().textContent ?? "").toContain(
        "Copied: Review Button at app/routes/home.tsx:19:7 on Button > button",
      );
    });
  });

  it("ignores custom actions when open is 'menu'", () => {
    setConfig({
      open: "menu",
      customActions: [{ id: "x", label: "Copy X", copy: "{file}" }],
    });
    const button = mountReactButton();
    install();

    pressAlt();
    altClick(button);

    expect(actionMenu()).toBeNull();
    const chainRows = shadowRoot().querySelectorAll(
      '[data-ttc-menu="chain"] .ttc-menu-item',
    );
    expect(chainRows.length).toBeGreaterThan(0);
    expect(shadowRoot().textContent ?? "").not.toContain("Copy X");
  });

  it("shows the picker when one built-in action is joined by a custom action", () => {
    setConfig({
      clickActions: ["open"],
      customActions: [{ id: "x", label: "Copy X", copy: "{file}" }],
    });
    const button = mountReactButton();
    install();

    pressAlt();
    altClick(button);

    expect(actionRows()).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports keyboard selection in the action picker", async () => {
    setConfig();
    const button = mountReactButton();
    install();

    pressAlt();
    mouseEvent("mousemove", button, { altKey: true });
    altClick(button);

    const down = keydown("ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    expect(actionRows()[1]?.hasAttribute("data-active")).toBe(true);

    const enter = keydown("Enter");
    expect(enter.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith("home.tsx");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a copyable toast when the clipboard is unavailable", async () => {
    setConfig({ clickActions: ["copy-file"] });
    clipboardWrite.mockRejectedValueOnce(new Error("denied"));
    const button = mountReactButton();
    install();

    pressAlt();
    altClick(button);

    const shadow = shadowRoot();
    await vi.waitFor(() => {
      expect(shadow.textContent ?? "").toContain("Could not copy");
    });
    expect(shadow.textContent ?? "").toContain("home.tsx");
  });
});

describe("modifier + click", () => {
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
    setConfig({ open: "element", clickActions: ["open"] });
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
    setConfig({ base: "/app/", clickActions: ["open"] });
    const button = mountReactButton();
    install();

    pressAlt();
    altClick(button);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/app/__open-in-editor?file=D%3A%2Fproj%2Fapp%2Froutes%2Fhome.tsx%3A19%3A7",
    );
  });

  it("shows a copyable path toast when the editor request fails", async () => {
    setConfig({ clickActions: ["open"] });
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
    // Chain rows lead with the component icon and keep their text intact.
    expect(
      rows[0]?.querySelector('.ttc-menu-icon[data-icon="component"]'),
    ).not.toBeNull();
    expect(
      rows[1]?.querySelector('.ttc-menu-icon[data-icon="component"]'),
    ).not.toBeNull();

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
    clickRow(rowWithLabel("Open in IDE"));
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
