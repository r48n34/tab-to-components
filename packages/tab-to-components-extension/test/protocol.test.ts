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
      config: {
        enabled: true,
        menu: false,
        keyboard: ["alt"],
        crosshair: false,
        crosshairPointKey: "z",
      },
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

  it("normalizes crosshair mode and point key", () => {
    const valid = parseInspectorMessage({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-inspector",
      type: "config",
      config: {
        enabled: true,
        menu: false,
        keyboard: ["alt"],
        crosshair: "x",
        crosshairPointKey: " P ",
      },
    });
    if (valid === null || valid.type !== "config") {
      throw new Error("expected a config message");
    }
    expect(valid.config.crosshair).toBe("x");
    expect(valid.config.crosshairPointKey).toBe("p");

    const invalid = parseInspectorMessage({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-inspector",
      type: "config",
      config: {
        enabled: true,
        menu: false,
        keyboard: ["alt"],
        crosshair: "nope",
        crosshairPointKey: "!",
      },
    });
    if (invalid === null || invalid.type !== "config") {
      throw new Error("expected a config message");
    }
    expect(invalid.config.crosshair).toBe(false);
    expect(invalid.config.crosshairPointKey).toBe("z");
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

  it("accepts editor requests with a bounded target", () => {
    const message = parseInspectorMessage({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-inspector",
      type: "open-editor",
      requestId: 7,
      file: "D:/projects/app/src/App.tsx:20:9",
    });
    expect(message).toEqual({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-inspector",
      type: "open-editor",
      requestId: 7,
      file: "D:/projects/app/src/App.tsx:20:9",
    });
    expect(
      parseInspectorMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-inspector",
        type: "open-editor",
        requestId: 7,
        file: "",
      }),
    ).toBeNull();
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

  it("accepts pointer and point messages with finite coordinates", () => {
    for (const type of ["pointer", "point"] as const) {
      expect(
        parseAgentMessage({
          __ttc: PROTOCOL_VERSION,
          source: "ttc-agent",
          type,
          requestId: 7,
          x: 12.5,
          y: 40,
        }),
      ).not.toBeNull();
    }
    expect(
      parseAgentMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "point",
        requestId: 7,
        x: Number.NaN,
        y: 40,
      }),
    ).toBeNull();
  });

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

  const plugin = {
    base: "/",
    editorEndpoint: "__ttc/open-in-editor",
    root: "D:/projects/app",
    keyboard: ["alt"],
    open: "component",
    clickActions: ["open", "copy-file"],
    menu: true,
    theme: "dark",
    crosshair: false,
    crosshairUnit: ["px"],
    crosshairPointKey: "z",
  };

  it("carries the plugin config the page injected", () => {
    const status = parseAgentMessage({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-agent",
      type: "status",
      requestId: 4,
      hasReact: true,
      reactKind: "19",
      plugin,
    });
    if (status === null || status.type !== "status") throw new Error("expected status");
    expect(status.plugin).toEqual(plugin);

    const ready = parseAgentMessage({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-agent",
      type: "ready",
      requestId: 5,
      hasReact: false,
      reactKind: "unknown",
      plugin,
    });
    if (ready === null || ready.type !== "ready") throw new Error("expected ready");
    expect(ready.plugin).toEqual(plugin);

    const activate = parseAgentMessage({
      ...hover,
      type: "activate",
      button: 0,
      plugin,
    });
    if (activate === null || activate.type !== "activate") {
      throw new Error("expected activate");
    }
    expect(activate.plugin).toEqual(plugin);
  });

  it("treats a missing plugin config as null and rejects a malformed one", () => {
    const withoutPlugin = parseAgentMessage({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-agent",
      type: "status",
      requestId: 4,
      hasReact: true,
    });
    if (withoutPlugin === null || withoutPlugin.type !== "status") {
      throw new Error("expected status");
    }
    expect(withoutPlugin.plugin).toBeNull();

    expect(
      parseAgentMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "status",
        requestId: 4,
        hasReact: true,
        plugin: { base: "nope", editorEndpoint: "x", root: "D:/projects/app" },
      }),
    ).toBeNull();
  });

  it("accepts open-editor-result replies", () => {
    const message = parseAgentMessage({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-agent",
      type: "open-editor-result",
      requestId: 8,
      ok: true,
      message: "Opening the file in your IDE through the Vite dev server.",
    });
    if (message === null || message.type !== "open-editor-result") {
      throw new Error("expected open-editor-result");
    }
    expect(message.ok).toBe(true);
    expect(message.message).toContain("Vite dev server");

    expect(
      parseAgentMessage({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "open-editor-result",
        requestId: 8,
        ok: true,
      }),
    ).toBeNull();
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
