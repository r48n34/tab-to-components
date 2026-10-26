// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { elementFromTarget, isModifierHeld } from "../../lib/agent/modifiers";

function state(partial: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>>) {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...partial,
  };
}

describe("isModifierHeld", () => {
  it("requires every configured modifier", () => {
    expect(isModifierHeld(state({ altKey: true }), ["alt"])).toBe(true);
    expect(isModifierHeld(state({ altKey: true }), ["alt", "shift"])).toBe(false);
    expect(
      isModifierHeld(state({ altKey: true, shiftKey: true }), ["alt", "shift"]),
    ).toBe(true);
    expect(isModifierHeld(state({ ctrlKey: true }), ["alt"])).toBe(false);
  });

  it("never arms without a configured key", () => {
    expect(isModifierHeld(state({ altKey: true }), [])).toBe(false);
  });
});

describe("elementFromTarget", () => {
  it("resolves elements and text nodes", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(elementFromTarget(button)).toBe(button);

    button.textContent = "hello";
    const text = button.firstChild;
    expect(text?.nodeType).toBe(3);
    expect(elementFromTarget(text)).toBe(button);
  });

  it("returns null for nullish or non-DOM targets", () => {
    expect(elementFromTarget(null)).toBeNull();
    expect(elementFromTarget(window)).toBeNull();
  });
});
