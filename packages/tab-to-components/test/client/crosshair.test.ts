// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { install, uninstall, type ClientConfig } from "../../src/client/index";

const BASE_CONFIG: ClientConfig = {
  version: "0.1.0",
  root: "D:/proj",
  base: "/",
  keyboard: ["alt"],
  open: "component",
  clickActions: ["open"],
  menu: true,
  theme: "dark",
  editorEndpoint: "__open-in-editor",
};

function configure(overrides: Partial<ClientConfig> = {}): ClientConfig {
  const config = { ...BASE_CONFIG, ...overrides };
  globalThis.__TTC_CONFIG__ = config;
  install(config);
  return config;
}

/** Fake React tree: host <button> in Button.tsx, used by <Button /> in home.tsx. */
function mountButton(): HTMLButtonElement {
  const main = document.createElement("main");
  const button = document.createElement("button");
  button.id = "target";
  button.type = "button";
  button.setAttribute("data-ttc", "app/components/Button.tsx:6:10");
  button.textContent = "count is 0";
  main.append(button);
  document.body.append(main);

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

function keydown(init: KeyboardEventInit): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
}

function mouse(
  type: string,
  target: EventTarget,
  init: MouseEventInit = {},
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 300,
    clientY: 200,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function altClick(target: Element): void {
  mouse("mousedown", target, { altKey: true, button: 0 });
  mouse("click", target, { altKey: true, button: 0 });
}

function overlayHost(): Element {
  const host = document.querySelector("[data-ttc-ui]");
  if (!host) throw new Error("overlay host missing");
  return host;
}

function shadow(): ShadowRoot {
  const host = overlayHost();
  if (!host.shadowRoot) throw new Error("overlay shadow root missing");
  return host.shadowRoot;
}

function node<T extends HTMLElement>(selector: string): T {
  const found = shadow().querySelector<T>(selector);
  if (!found) throw new Error(`overlay node ${selector} missing`);
  return found;
}

function target(): Element {
  const button = document.getElementById("target");
  if (!button) throw new Error("target button missing");
  return button;
}

beforeEach(() => {
  globalThis.__TTC_CONFIG__ = undefined;
  document.body.innerHTML = "";
});

afterEach(() => {
  uninstall();
  globalThis.__TTC_CONFIG__ = undefined;
});

describe("crosshair ruler", () => {
  it("draws nothing when the option is off (the default)", () => {
    configure();
    expect(shadow().querySelector(".ttc-crosshair")).toBeNull();
    expect(overlayHost().hasAttribute("data-ttc-crosshair")).toBe(false);

    mouse("mousemove", document.body, { clientX: 300, clientY: 200 });
    expect(shadow().querySelector(".ttc-crosshair")).toBeNull();
  });

  it("draws both axes and their coordinates while the pointer moves", () => {
    configure({ crosshair: "both" });
    expect(overlayHost().getAttribute("data-ttc-crosshair")).toBe("both");

    const box = node(".ttc-crosshair");
    // The stylesheet hides the container until the first pointer move.
    expect(box.style.display).toBe("");

    mouse("mousemove", document.body, { clientX: 300, clientY: 200 });

    expect(box.style.display).toBe("block");
    expect(node(".ttc-crosshair-v").style.left).toBe("300px");
    expect(node(".ttc-crosshair-h").style.top).toBe("200px");

    const tagX = node(".ttc-crosshair-tag-x");
    const tagY = node(".ttc-crosshair-tag-y");
    expect(tagX.textContent).toBe("300");
    expect(tagX.style.left).toBe("300px");
    expect(tagY.textContent).toBe("200");
    expect(tagY.style.top).toBe("200px");

    const css = shadow().querySelector("style")?.textContent ?? "";
    expect(css).toContain(".ttc-crosshair-v");
    expect(css).toContain(".ttc-crosshair-tag-x");
  });

  it("updates on every move and rounds the readout", () => {
    configure({ crosshair: "both" });

    mouse("mousemove", document.body, { clientX: 300.6, clientY: 199.5 });
    expect(node(".ttc-crosshair-v").style.left).toBe("301px");
    expect(node(".ttc-crosshair-h").style.top).toBe("200px");

    mouse("mousemove", document.body, { clientX: 150.6, clientY: 40.4 });
    expect(node(".ttc-crosshair-v").style.left).toBe("151px");
    expect(node(".ttc-crosshair-tag-x").textContent).toBe("151");
    expect(node(".ttc-crosshair-h").style.top).toBe("40px");
    expect(node(".ttc-crosshair-tag-y").textContent).toBe("40");
  });

  it("clamps the coordinate pills to the viewport edges", () => {
    configure({ crosshair: "both" });
    const width = window.innerWidth;
    const height = window.innerHeight;

    mouse("mousemove", document.body, { clientX: 0, clientY: 0 });
    expect(node(".ttc-crosshair-tag-x").style.left).toBe("26px");
    expect(node(".ttc-crosshair-tag-y").style.top).toBe("14px");

    mouse("mousemove", document.body, { clientX: 5000, clientY: 5000 });
    expect(node(".ttc-crosshair-tag-x").style.left).toBe(`${width - 26}px`);
    expect(node(".ttc-crosshair-tag-y").style.top).toBe(`${height - 14}px`);
  });

  it("draws only the requested axis", () => {
    configure({ crosshair: "x" });
    expect(overlayHost().getAttribute("data-ttc-crosshair")).toBe("x");
    expect(node(".ttc-crosshair-v").style.display).toBe("");
    expect(node(".ttc-crosshair-tag-x").style.display).toBe("");
    expect(node(".ttc-crosshair-h").style.display).toBe("none");
    expect(node(".ttc-crosshair-tag-y").style.display).toBe("none");

    configure({ crosshair: "y" });
    expect(overlayHost().hasAttribute("data-ttc-crosshair")).toBe(true);
    expect(overlayHost().getAttribute("data-ttc-crosshair")).toBe("y");
    expect(node(".ttc-crosshair-v").style.display).toBe("none");
    expect(node(".ttc-crosshair-tag-x").style.display).toBe("none");
    expect(node(".ttc-crosshair-h").style.display).toBe("");
    expect(node(".ttc-crosshair-tag-y").style.display).toBe("");
  });

  it("treats crosshair: true as both axes", () => {
    configure({ crosshair: true as never });
    expect(overlayHost().getAttribute("data-ttc-crosshair")).toBe("both");

    mouse("mousemove", document.body, { clientX: 10, clientY: 20 });
    expect(node(".ttc-crosshair-v").style.left).toBe("10px");
    expect(node(".ttc-crosshair-h").style.top).toBe("20px");
  });

  it("hides when the pointer leaves the window and on window blur", () => {
    configure({ crosshair: "both" });
    const box = node(".ttc-crosshair");

    mouse("mousemove", document.body, { clientX: 300, clientY: 200 });
    expect(box.style.display).toBe("block");

    mouse("mouseout", document.body, { relatedTarget: null });
    expect(box.style.display).toBe("none");

    mouse("mousemove", document.body, { clientX: 320, clientY: 210 });
    expect(box.style.display).toBe("block");

    window.dispatchEvent(new Event("blur"));
    expect(box.style.display).toBe("none");
  });

  it("keeps the ruler visible when the modifier is released", () => {
    configure({ crosshair: "both" });
    const box = node(".ttc-crosshair");

    pressAlt();
    mouse("mousemove", document.body, { clientX: 300, clientY: 200, altKey: true });
    expect(box.style.display).toBe("block");

    window.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Alt", bubbles: true, cancelable: true }),
    );
    expect(box.style.display).toBe("block");
  });

  it("hides while an action picker is open and returns on the next move", () => {
    mountButton();
    configure({
      crosshair: "both",
      clickActions: ["copy-file", "copy-full-path"],
    });
    const box = node(".ttc-crosshair");

    mouse("mousemove", target(), { clientX: 300, clientY: 200 });
    expect(box.style.display).toBe("block");

    pressAlt();
    mouse("mousemove", target(), { clientX: 300, clientY: 200, altKey: true });
    altClick(target());

    const menu = shadow().querySelector<HTMLElement>('[data-ttc-menu="actions"]');
    expect(menu?.style.display).toBe("block");
    expect(box.style.display).toBe("none");

    keydown({ key: "Escape" });
    expect(menu?.style.display).toBe("none");
    expect(box.style.display).toBe("none");

    mouse("mousemove", document.body, { clientX: 320, clientY: 210 });
    expect(box.style.display).toBe("block");
  });

  it("removes the ruler on uninstall", () => {
    configure({ crosshair: "both" });
    mouse("mousemove", document.body, { clientX: 300, clientY: 200 });
    expect(shadow().querySelector(".ttc-crosshair")).not.toBeNull();

    uninstall();
    expect(document.querySelector("[data-ttc-ui]")).toBeNull();
  });
});
