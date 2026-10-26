import { describe, expect, it } from "vitest";

import {
  hasSourceLocation,
  nearestComponentEntry,
  pickPrimaryEntry,
} from "../lib/chain";
import { createLocation, type SourceLocation } from "../lib/source/location";
import type { ResolvedEntry } from "../lib/source/types";
import type { OpenMode } from "../lib/types";

function location(file: string): SourceLocation {
  const resolved = createLocation({
    relativeFile: file,
    absoluteFile: null,
    line: 1,
    column: 1,
    source: "source-map",
  });
  if (resolved === null) throw new Error("test fixture location is unusable");
  return resolved;
}

function entry(
  name: string,
  isHost: boolean,
  locationOrNull: SourceLocation | null,
): ResolvedEntry {
  return { name, isHost, location: locationOrNull };
}

const HOST = entry("button", true, location("app/components/Button.tsx"));
const COMPONENT = entry("Button", false, location("app/routes/home.tsx"));
const OUTER_COMPONENT = entry("Home", false, location("app/routes/home.tsx"));

describe("nearestComponentEntry", () => {
  it("returns the first non-host entry", () => {
    expect(nearestComponentEntry([HOST, COMPONENT])).toBe(COMPONENT);
    expect(nearestComponentEntry([COMPONENT, HOST])).toBe(COMPONENT);
    expect(
      nearestComponentEntry([HOST, entry("div", true, null), OUTER_COMPONENT]),
    ).toBe(OUTER_COMPONENT);
  });

  it("returns null when the chain has no component", () => {
    expect(nearestComponentEntry([HOST])).toBeNull();
    expect(nearestComponentEntry([HOST, entry("span", true, null)])).toBeNull();
    expect(nearestComponentEntry([])).toBeNull();
  });
});

describe("pickPrimaryEntry", () => {
  it("picks the nearest component for the component mode", () => {
    expect(pickPrimaryEntry([HOST, COMPONENT, OUTER_COMPONENT], "component")).toBe(COMPONENT);
  });

  it("falls back to the first entry when the chain has no component", () => {
    expect(pickPrimaryEntry([HOST], "component")).toBe(HOST);
    expect(pickPrimaryEntry([HOST, entry("span", true, null)], "component")).toBe(HOST);
  });

  it("picks the clicked host element for the element mode", () => {
    expect(pickPrimaryEntry([HOST, COMPONENT], "element")).toBe(HOST);
  });

  it("starts the menu at the first (deepest) entry", () => {
    expect(pickPrimaryEntry([HOST, COMPONENT], "menu")).toBe(HOST);
  });

  it("ignores locations when picking", () => {
    const unlocatedHost = entry("button", true, null);
    const unlocatedComponent = entry("Button", false, null);
    expect(pickPrimaryEntry([unlocatedHost, unlocatedComponent], "component")).toBe(
      unlocatedComponent,
    );
    expect(pickPrimaryEntry([unlocatedHost, unlocatedComponent], "element")).toBe(
      unlocatedHost,
    );
  });

  it("returns null for an empty chain", () => {
    const modes: OpenMode[] = ["component", "element", "menu"];
    for (const mode of modes) {
      expect(pickPrimaryEntry([], mode)).toBeNull();
    }
  });

  it("accepts a frozen (readonly) chain", () => {
    const chain = Object.freeze([HOST, COMPONENT]);
    expect(pickPrimaryEntry(chain, "component")).toBe(COMPONENT);
  });

  it("returns a single entry in every mode", () => {
    const single = Object.freeze([COMPONENT]);
    expect(pickPrimaryEntry(single, "component")).toBe(COMPONENT);
    expect(pickPrimaryEntry(single, "element")).toBe(COMPONENT);
    expect(pickPrimaryEntry(single, "menu")).toBe(COMPONENT);
  });
});

describe("hasSourceLocation", () => {
  it("is true when any entry resolved a location", () => {
    expect(hasSourceLocation([HOST, COMPONENT])).toBe(true);
    expect(hasSourceLocation([entry("button", true, null), COMPONENT])).toBe(true);
    expect(hasSourceLocation([HOST])).toBe(true);
  });

  it("is false when no entry has a location", () => {
    expect(hasSourceLocation([])).toBe(false);
    expect(hasSourceLocation([entry("button", true, null)])).toBe(false);
    expect(
      hasSourceLocation([
        entry("button", true, null),
        entry("Button", false, null),
      ]),
    ).toBe(false);
  });
});
