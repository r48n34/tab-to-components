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

function releaseAlt(): void {
  window.dispatchEvent(
    new KeyboardEvent("keyup", {
      key: "Alt",
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

/** A pointer move with the default `Alt` modifier held. */
function moveAlt(x: number, y: number, target: EventTarget = document.body): MouseEvent {
  return mouse("mousemove", target, { clientX: x, clientY: y, altKey: true });
}

/** Press the measurement-point key while the default modifier is held. */
function pressPointKey(key = "z", init: KeyboardEventInit = {}): void {
  keydown({ key, altKey: true, ...init });
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

function nodes<T extends HTMLElement>(selector: string): T[] {
  return Array.from(shadow().querySelectorAll<T>(selector));
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

  it("draws both axes and their coordinates while the modifier is held", () => {
    configure({ crosshair: "both" });
    expect(overlayHost().getAttribute("data-ttc-crosshair")).toBe("both");
    expect(overlayHost().getAttribute("data-ttc-crosshair-unit")).toBe("px");

    const box = node(".ttc-crosshair");
    // The stylesheet hides the container until the first pointer move.
    expect(box.style.display).toBe("");

    pressAlt();
    moveAlt(300, 200);

    expect(box.style.display).toBe("block");
    expect(node(".ttc-crosshair-v").style.left).toBe("300px");
    expect(node(".ttc-crosshair-h").style.top).toBe("200px");

    const tagX = node(".ttc-crosshair-tag-x");
    const tagY = node(".ttc-crosshair-tag-y");
    expect(tagX.textContent).toBe("300px");
    expect(tagX.style.left).toBe("300px");
    expect(tagY.textContent).toBe("200px");
    expect(tagY.style.top).toBe("200px");

    const css = shadow().querySelector("style")?.textContent ?? "";
    expect(css).toContain(".ttc-crosshair-v");
    expect(css).toContain(".ttc-crosshair-tag-x");
  });

  it("updates on every move and rounds the readout", () => {
    configure({ crosshair: "both" });

    moveAlt(300.6, 199.5);
    expect(node(".ttc-crosshair-v").style.left).toBe("301px");
    expect(node(".ttc-crosshair-h").style.top).toBe("200px");

    moveAlt(150.6, 40.4);
    expect(node(".ttc-crosshair-v").style.left).toBe("151px");
    expect(node(".ttc-crosshair-tag-x").textContent).toBe("151px");
    expect(node(".ttc-crosshair-h").style.top).toBe("40px");
    expect(node(".ttc-crosshair-tag-y").textContent).toBe("40px");
  });

  it("formats the readout in centimeters and millimeters", () => {
    configure({ crosshair: "both", crosshairUnit: "cm" });
    expect(overlayHost().getAttribute("data-ttc-crosshair-unit")).toBe("cm");

    moveAlt(300, 200);
    expect(node(".ttc-crosshair-tag-x").textContent).toBe("7.94cm");
    expect(node(".ttc-crosshair-tag-y").textContent).toBe("5.29cm");

    configure({ crosshair: "both", crosshairUnit: "mm" });
    moveAlt(300, 200);
    expect(node(".ttc-crosshair-tag-x").textContent).toBe("79.38mm");
    expect(node(".ttc-crosshair-tag-y").textContent).toBe("52.92mm");
  });

  it("shows several units in the same pill, in order", () => {
    configure({ crosshair: "both", crosshairUnit: ["px", "cm"] });
    expect(overlayHost().getAttribute("data-ttc-crosshair-unit")).toBe("px cm");

    moveAlt(300, 200);
    expect(node(".ttc-crosshair-tag-x").textContent).toBe("300px · 7.94cm");
    expect(node(".ttc-crosshair-tag-y").textContent).toBe("200px · 5.29cm");

    configure({ crosshair: "both", crosshairUnit: ["rem", "in"] });
    moveAlt(160, 96);
    expect(node(".ttc-crosshair-tag-x").textContent).toBe("10rem · 1.67in");
    expect(node(".ttc-crosshair-tag-y").textContent).toBe("6rem · 1in");
  });

  it("formats the readout in inches and rem", () => {
    configure({ crosshair: "both", crosshairUnit: "in" });
    moveAlt(96, 300);
    expect(node(".ttc-crosshair-tag-x").textContent).toBe("1in");
    expect(node(".ttc-crosshair-tag-y").textContent).toBe("3.13in");

    configure({ crosshair: "both", crosshairUnit: "rem" });
    moveAlt(160, 300);
    expect(node(".ttc-crosshair-tag-x").textContent).toBe("10rem");
    expect(node(".ttc-crosshair-tag-y").textContent).toBe("18.75rem");
  });

  it("keeps the lines at the pointer position in every unit", () => {
    configure({ crosshair: "both", crosshairUnit: "cm" });
    moveAlt(300, 200);
    expect(node(".ttc-crosshair-v").style.left).toBe("300px");
    expect(node(".ttc-crosshair-h").style.top).toBe("200px");
  });

  it("clamps the coordinate pills to the viewport edges", () => {
    configure({ crosshair: "both" });
    const width = window.innerWidth;
    const height = window.innerHeight;

    moveAlt(0, 0);
    expect(node(".ttc-crosshair-tag-x").style.left).toBe("26px");
    expect(node(".ttc-crosshair-tag-y").style.top).toBe("14px");

    moveAlt(5000, 5000);
    expect(node(".ttc-crosshair-tag-x").style.left).toBe(`${width - 26}px`);
    expect(node(".ttc-crosshair-tag-y").style.top).toBe(`${height - 14}px`);
  });

  it("applies custom line, badge and text colors over the theme palette", () => {
    configure({
      crosshair: "both",
      crosshairLineColor: " #ff3355 ",
      crosshairTextColor: "tomato",
    });

    const host = overlayHost() as HTMLElement;
    expect(host.style.getPropertyValue("--ttc-crosshair-line")).toBe("#ff3355");
    expect(host.style.getPropertyValue("--ttc-crosshair-tag-bg")).toBe("#ff3355");
    expect(host.style.getPropertyValue("--ttc-crosshair-tag-text")).toBe("tomato");

    moveAlt(300, 200);
    expect(node(".ttc-crosshair-v").style.left).toBe("300px");
    expect(node(".ttc-crosshair-tag-x").textContent).toBe("300px");
  });

  it("uses the line color for the badge even when no text color is set", () => {
    configure({ crosshair: "both", crosshairLineColor: "#123456" });

    const host = overlayHost() as HTMLElement;
    expect(host.style.getPropertyValue("--ttc-crosshair-tag-bg")).toBe("#123456");
    expect(host.style.getPropertyValue("--ttc-crosshair-tag-text")).toBe("");
  });

  it("keeps the theme colors when no color is configured", () => {
    configure({ crosshair: "both" });

    const host = overlayHost() as HTMLElement;
    expect(host.style.getPropertyValue("--ttc-crosshair-line")).toBe("");
    expect(host.style.getPropertyValue("--ttc-crosshair-tag-bg")).toBe("");
    expect(host.style.getPropertyValue("--ttc-crosshair-tag-text")).toBe("");
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

    moveAlt(10, 20);
    expect(node(".ttc-crosshair-v").style.left).toBe("10px");
    expect(node(".ttc-crosshair-h").style.top).toBe("20px");
  });

  it("hides when the pointer leaves the window and on window blur", () => {
    configure({ crosshair: "both" });
    const box = node(".ttc-crosshair");

    moveAlt(300, 200);
    expect(box.style.display).toBe("block");

    mouse("mouseout", document.body, { relatedTarget: null });
    expect(box.style.display).toBe("none");

    moveAlt(320, 210);
    expect(box.style.display).toBe("block");

    window.dispatchEvent(new Event("blur"));
    expect(box.style.display).toBe("none");
  });

  it("appears on modifier key press and disappears on release", () => {
    configure({ crosshair: "both" });
    const box = node(".ttc-crosshair");

    mouse("mousemove", document.body, { clientX: 300, clientY: 200 });
    expect(box.style.display).toBe("none");

    pressAlt();
    expect(box.style.display).toBe("block");
    expect(node(".ttc-crosshair-tag-x").textContent).toBe("300px");
    expect(node(".ttc-crosshair-tag-y").textContent).toBe("200px");

    releaseAlt();
    expect(box.style.display).toBe("none");
  });

  it("hides the ruler when the modifier is released", () => {
    configure({ crosshair: "both" });
    const box = node(".ttc-crosshair");

    pressAlt();
    moveAlt(300, 200);
    expect(box.style.display).toBe("block");

    releaseAlt();
    expect(box.style.display).toBe("none");
  });

  it("hides while an action picker is open and returns on the next move", () => {
    mountButton();
    configure({
      crosshair: "both",
      clickActions: ["copy-file", "copy-full-path"],
    });
    const box = node(".ttc-crosshair");

    pressAlt();
    moveAlt(300, 200, target());
    expect(box.style.display).toBe("block");
    altClick(target());

    const menu = shadow().querySelector<HTMLElement>('[data-ttc-menu="actions"]');
    expect(menu?.style.display).toBe("block");
    expect(box.style.display).toBe("none");

    keydown({ key: "Escape" });
    expect(menu?.style.display).toBe("none");
    expect(box.style.display).toBe("none");

    moveAlt(320, 210);
    expect(box.style.display).toBe("block");
  });

  it("drops points with Z and joins each to the previous point only", () => {
    configure({ crosshair: "both" });
    moveAlt(300, 200);

    pressPointKey();
    expect(shadow().querySelectorAll(".ttc-crosshair-point")).toHaveLength(1);
    expect(shadow().querySelectorAll(".ttc-crosshair-segment")).toHaveLength(0);
    expect(node(".ttc-crosshair-point").style.left).toBe("300px");
    expect(node(".ttc-crosshair-point").style.top).toBe("200px");

    moveAlt(400, 200);
    pressPointKey();
    const segments = shadow().querySelectorAll(".ttc-crosshair-segment");
    expect(segments).toHaveLength(1);
    expect((segments[0] as HTMLElement).style.width).toBe("100px");
    expect(node(".ttc-crosshair-distance").textContent).toBe("100px");

    moveAlt(400, 300);
    pressPointKey();
    expect(shadow().querySelectorAll(".ttc-crosshair-point")).toHaveLength(3);
    expect(shadow().querySelectorAll(".ttc-crosshair-segment")).toHaveLength(2);
    expect(nodes(".ttc-crosshair-distance").map((el) => el.textContent)).toEqual([
      "100px",
      "100px",
    ]);
  });

  it("formats segment lengths with every configured crosshair unit", () => {
    configure({ crosshair: "both", crosshairUnit: ["px", "cm"] });
    moveAlt(300, 200);
    pressPointKey();
    moveAlt(400, 200);
    pressPointKey();

    expect(node(".ttc-crosshair-distance").textContent).toBe("100px · 2.65cm");
  });

  it("keeps points fixed while the crosshair follows the pointer", () => {
    configure({ crosshair: "both" });
    moveAlt(300, 200);
    pressPointKey();
    moveAlt(500, 300);

    const point = node(".ttc-crosshair-point");
    expect(point.style.left).toBe("300px");
    expect(point.style.top).toBe("200px");
    expect(node(".ttc-crosshair-v").style.left).toBe("500px");
  });

  it("supports a custom point key, case-insensitively", () => {
    configure({ crosshair: "both", crosshairPointKey: "p" });
    moveAlt(300, 200);

    pressPointKey("z");
    expect(shadow().querySelectorAll(".ttc-crosshair-point")).toHaveLength(0);

    pressPointKey("P");
    expect(shadow().querySelectorAll(".ttc-crosshair-point")).toHaveLength(1);
  });

  it("matches the physical point key when the modifier changes the character", () => {
    configure({ crosshair: "both" });
    moveAlt(300, 200);

    // macOS turns Option+Z into the character "Ω" while the physical code
    // stays KeyZ; the default Z shortcut must still fire.
    pressPointKey("Ω", { code: "KeyZ" });
    expect(shadow().querySelectorAll(".ttc-crosshair-point")).toHaveLength(1);
  });

  it("ignores point presses without the modifier or auto-repeat", () => {
    configure({ crosshair: "both" });
    moveAlt(300, 200);

    keydown({ key: "z" });
    expect(shadow().querySelectorAll(".ttc-crosshair-point")).toHaveLength(0);

    pressPointKey("z");
    pressPointKey("z", { repeat: true });
    expect(shadow().querySelectorAll(".ttc-crosshair-point")).toHaveLength(1);
  });

  it("clears every point when the modifier is released or the window blurs", () => {
    configure({ crosshair: "both" });
    moveAlt(300, 200);
    pressPointKey();
    moveAlt(400, 200);
    pressPointKey();
    expect(shadow().querySelectorAll(".ttc-crosshair-point")).toHaveLength(2);

    releaseAlt();
    expect(shadow().querySelectorAll(".ttc-crosshair-point")).toHaveLength(0);
    expect(shadow().querySelectorAll(".ttc-crosshair-segment")).toHaveLength(0);

    moveAlt(300, 200);
    pressPointKey();
    window.dispatchEvent(new Event("blur"));
    expect(shadow().querySelectorAll(".ttc-crosshair-point")).toHaveLength(0);
  });

  it("adds no points when the crosshair option is off", () => {
    configure();
    mouse("mousemove", document.body, { clientX: 300, clientY: 200 });
    pressPointKey();
    expect(shadow().querySelector(".ttc-crosshair")).toBeNull();
  });

  it("removes the ruler on uninstall", () => {
    configure({ crosshair: "both" });
    moveAlt(300, 200);
    expect(shadow().querySelector(".ttc-crosshair")).not.toBeNull();

    uninstall();
    expect(document.querySelector("[data-ttc-ui]")).toBeNull();
  });
});
