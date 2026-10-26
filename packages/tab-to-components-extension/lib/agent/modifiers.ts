/**
 * Modifier-key helpers shared by the agent and tests.
 *
 * Mirrors the Vite plugin's semantics: every configured modifier must be held
 * for the inspector to arm.
 */

import type { ModifierKey } from "../types";

/** Subset of a mouse/keyboard event needed to test modifier state. */
export interface ModifierState {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** True when every configured modifier is currently held. */
export function isModifierHeld(
  event: ModifierState,
  keyboard: readonly ModifierKey[],
): boolean {
  if (keyboard.length === 0) return false;
  return keyboard.every((key) => {
    switch (key) {
      case "alt":
        return event.altKey;
      case "ctrl":
        return event.ctrlKey;
      case "meta":
        return event.metaKey;
      case "shift":
        return event.shiftKey;
      default:
        return false;
    }
  });
}

/** The nearest Element for an event target (text nodes resolve to parents). */
export function elementFromTarget(target: EventTarget | null): Element | null {
  if (target === null || typeof target !== "object") return null;
  const node = target as Node;
  if (node.nodeType === 1) return node as Element;
  if (node.nodeType === 3) return node.parentElement ?? null;
  return null;
}
