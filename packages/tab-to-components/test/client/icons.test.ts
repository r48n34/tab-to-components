// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  MENU_ICON_PATHS,
  createMenuIcon,
  type MenuIconName,
} from "../../src/client/icons";

const ICONS: MenuIconName[] = [
  "open",
  "open-code",
  "open-cursor",
  "open-webstorm",
  "open-trae",
  "copy-file",
  "copy-path",
  "copy-full-path",
  "copy-location",
  "component",
  "sparkles",
  "at",
  "markdown",
];

describe("menu icons", () => {
  it("draws every icon on the shared 16×16 stroke grid", () => {
    for (const name of ICONS) {
      const icon = createMenuIcon(document, name);
      expect(icon.getAttribute("data-icon")).toBe(name);
      expect(icon.getAttribute("class")).toBe("ttc-menu-icon");
      expect(icon.getAttribute("viewBox")).toBe("0 0 16 16");
      expect(icon.getAttribute("fill")).toBe("none");
      expect(icon.getAttribute("stroke")).toBe("currentColor");
      expect(icon.getAttribute("stroke-width")).toBe("1.5");
      expect(icon.childElementCount).toBe(MENU_ICON_PATHS[name].length);
      expect(icon.childElementCount).toBeGreaterThan(0);
      for (const path of Array.from(icon.children)) {
        expect(path.tagName.toLowerCase()).toBe("path");
        expect(path.getAttribute("d")).toBeTruthy();
      }
    }
  });

  it("is decorative markup with no text content", () => {
    for (const name of ICONS) {
      const icon = createMenuIcon(document, name);
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("focusable")).toBe("false");
      expect(icon.textContent).toBe("");
    }
  });
});
