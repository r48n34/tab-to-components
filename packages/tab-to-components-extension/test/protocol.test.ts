import { describe, expect, it } from "vitest";

import {
  parseAgentMessage,
  parseInspectorMessage,
  PROTOCOL_VERSION,
  sanitizeRawChain,
  type RawEntry,
} from "../lib/protocol";

function markerEntry(overrides: Partial<RawEntry> = {}): RawEntry {
  return { name: "Button", isHost: false, marker: "src/App.tsx:20:9", ...overrides };
}

describe("parseInspectorMessage", () => {
  it("accepts a config message and normalizes the keyboard list", () => {
    const message = parseInspectorMessage({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-inspector",
      type: "config",
      config: { enabled: true, menu: false, keyboard: ["alt", "alt", "bogus"] },
    });
    expect(message).toEqual({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-inspector",
      type: "config",
      config: { enabled: true, menu: false, keyboard: ["alt"] },
    });
    if (message === null || message.type !== "config") {
      throw new Error("expected a config message");
    }
    expect(message.config.keyboard).toEqual(["alt"]);
  });

  it("falls back to alt when every keyboard value is invalid", () => {
    const message = parseInspectorMessage({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-inspector",
      type: "config",
      config: { enabled: true, menu: true, keyboard: [] },
    });
    if (message === null || message.type !== "config") {
      throw new Error("expected a config message");
    }
    expect(message.config.keyboard).toEqual(["alt"]);
  });

  it("accepts probe and menu-state messages", () => {
    expect(
      parseInspectorMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-inspector",
        type: "probe",
        requestId: 3,
      }),
    ).not.toBeNull();
    expect(
      parseInspectorMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-inspector",
        type: "menu-state",
        open: true,
      }),
    ).not.toBeNull();
  });

  it("rejects wrong versions, sources and malformed payloads", () => {
    expect(
      parseInspectorMessage({ __ttc: 9, source: "ttc-inspector", type: "probe", requestId: 1 }),
    ).toBeNull();
    expect(
      parseInspectorMessage({ __ttc: PROTOCOL_VERSION, source: "other", type: "probe", requestId: 1 }),
    ).toBeNull();
    expect(
      parseInspectorMessage({ __ttc: PROTOCOL_VERSION, source: "ttc-inspector", type: "probe", requestId: 0 }),
    ).toBeNull();
    expect(
      parseInspectorMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-inspector",
        type: "config",
        config: { keyboard: ["alt"] },
      }),
    ).toBeNull();
    expect(parseInspectorMessage(null)).toBeNull();
  });
});

describe("parseAgentMessage", () => {
  const hover = {
    __ttc: PROTOCOL_VERSION,
    source: "ttc-agent",
    type: "hover",
    requestId: 1,
    chain: [markerEntry()],
    rect: { left: 1, top: 2, width: 3, height: 4 },
    x: 10,
    y: 20,
  };

  it("accepts hover, activate, chain-menu, dismiss, disarm, status, ready and hover-none", () => {
    expect(parseAgentMessage(hover)).not.toBeNull();
    expect(
      parseAgentMessage({
        ...hover,
        type: "activate",
        button: 0,
      }),
    ).not.toBeNull();
    expect(parseAgentMessage({ ...hover, type: "chain-menu" })).not.toBeNull();
    expect(
      parseAgentMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "dismiss",
        requestId: 2,
        reason: "outside",
      }),
    ).not.toBeNull();
    expect(
      parseAgentMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "disarm",
        requestId: 3,
        reason: "scroll",
      }),
    ).not.toBeNull();
    expect(
      parseAgentMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "status",
        requestId: 4,
        hasReact: true,
        reactKind: "19",
      }),
    ).not.toBeNull();
    expect(
      parseAgentMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "ready",
        requestId: 5,
        hasReact: false,
        reactKind: "unknown",
      }),
    ).not.toBeNull();
    expect(
      parseAgentMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "hover-none",
        requestId: 6,
      }),
    ).not.toBeNull();
  });

  it("drops entries without source evidence", () => {
    const message = parseAgentMessage({
      ...hover,
      chain: [markerEntry(), { name: "naked", isHost: true }],
    });
    if (message === null || message.type !== "hover") throw new Error("expected hover");
    expect(message.chain).toHaveLength(1);
  });

  it("rejects empty chains, malformed rects and unknown types", () => {
    expect(parseAgentMessage({ ...hover, chain: [] })).toBeNull();
    expect(parseAgentMessage({ ...hover, rect: { left: "x" } })).toBeNull();
    expect(parseAgentMessage({ ...hover, type: "nope" })).toBeNull();
    expect(parseAgentMessage({ ...hover, requestId: -1 })).toBeNull();
  });

  it("caps chain length", () => {
    const chain = Array.from({ length: 70 }, (_, index) =>
      markerEntry({ name: `Entry${index}` }),
    );
    const message = parseAgentMessage({ ...hover, chain });
    if (message === null || message.type !== "hover") throw new Error("expected hover");
    expect(message.chain).toHaveLength(64);
  });
});

describe("sanitizeRawChain", () => {
  it("returns null when nothing usable remains", () => {
    expect(sanitizeRawChain([{ name: "x", isHost: true }])).toBeNull();
    expect(sanitizeRawChain("nope")).toBeNull();
  });
});
