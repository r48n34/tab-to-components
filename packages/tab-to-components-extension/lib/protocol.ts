/**
 * Messages between the MAIN-world agent and the isolated-world inspector.
 *
 * Everything crossing `window.postMessage` is plain JSON. The page can see and
 * forge these messages, so both sides validate shape, size and the protocol
 * version; nothing here is trusted for privileged work until it has been
 * re-validated against the path/URL rules.
 */

import type { ModifierKey } from "./types";

export const PROTOCOL_VERSION = 1;
export const MAX_CHAIN_ENTRIES = 64;
export const MAX_ENTRY_NAME = 200;
export const MAX_STACK_FRAME_URL = 2048;

/** Raw React 18 `_debugSource` value. */
export interface RawDebugSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

/** Parsed application frame from a React 19 `_debugStack`. */
export interface RawStackFrame {
  url: string;
  line: number;
  column: number;
}

/** One JSX site discovered by the agent's fiber walk. */
export interface RawEntry {
  name: string;
  isHost: boolean;
  /** `data-ttc` marker injected by the Vite plugin, when it is installed. */
  marker?: string;
  /** `data-ttc-name` display-name hint injected by the Vite plugin. */
  nameHint?: string;
  /** React 18 dev source object. */
  debugSource?: RawDebugSource;
  /** First application frame of a React 19 `_debugStack`. */
  stackFrame?: RawStackFrame;
}

export interface RawRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The agent-side configuration the inspector pushes on boot and on change. */
export interface AgentConfig {
  enabled: boolean;
  keyboard: ModifierKey[];
  menu: boolean;
}

/** inspector → agent */
export type InspectorMessage =
  | { __ttc: 1; source: "ttc-inspector"; type: "config"; config: AgentConfig }
  | { __ttc: 1; source: "ttc-inspector"; type: "probe"; requestId: number }
  | { __ttc: 1; source: "ttc-inspector"; type: "menu-state"; open: boolean };

export type DisarmReason = "keyup" | "blur" | "scroll" | "escape" | "disable";

/** agent → inspector */
export type AgentMessage =
  | {
      __ttc: 1;
      source: "ttc-agent";
      type: "hover";
      requestId: number;
      chain: RawEntry[];
      rect: RawRect;
      x: number;
      y: number;
    }
  | {
      __ttc: 1;
      source: "ttc-agent";
      type: "activate";
      requestId: number;
      chain: RawEntry[];
      x: number;
      y: number;
      button: number;
    }
  | {
      __ttc: 1;
      source: "ttc-agent";
      type: "chain-menu";
      requestId: number;
      chain: RawEntry[];
      x: number;
      y: number;
    }
  | {
      __ttc: 1;
      source: "ttc-agent";
      type: "dismiss";
      requestId: number;
      reason: "outside";
    }
  | {
      __ttc: 1;
      source: "ttc-agent";
      type: "disarm";
      requestId: number;
      reason: DisarmReason;
    }
  | {
      __ttc: 1;
      source: "ttc-agent";
      type: "status";
      requestId: number;
      hasReact: boolean;
      reactKind: "18" | "19" | "unknown";
    }
  | {
      __ttc: 1;
      source: "ttc-agent";
      type: "ready";
      requestId: number;
      hasReact: boolean;
      reactKind: ReactKind;
    }
  | {
      __ttc: 1;
      source: "ttc-agent";
      type: "hover-none";
      requestId: number;
    };

export type ReactKind = "18" | "19" | "unknown";

export function createRequestIdFactory(): () => number {
  let next = 0;
  return () => {
    next += 1;
    return next;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isPosition(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 1;
}

function isRawDebugSource(value: unknown): value is RawDebugSource {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.fileName, MAX_STACK_FRAME_URL) &&
    isPosition(value.lineNumber) &&
    isPosition(value.columnNumber)
  );
}

function isRawStackFrame(value: unknown): value is RawStackFrame {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.url, MAX_STACK_FRAME_URL) &&
    isPosition(value.line) &&
    isPosition(value.column)
  );
}

/** Validate one raw entry; malformed optional fields are dropped, not fatal. */
export function sanitizeRawEntry(value: unknown): RawEntry | null {
  if (!isRecord(value)) return null;
  if (!isBoundedString(value.name, MAX_ENTRY_NAME)) return null;
  if (typeof value.isHost !== "boolean") return null;
  const entry: RawEntry = { name: value.name, isHost: value.isHost };
  if (isBoundedString(value.marker, MAX_ENTRY_NAME)) entry.marker = value.marker;
  if (isBoundedString(value.nameHint, MAX_ENTRY_NAME)) entry.nameHint = value.nameHint;
  if (isRawDebugSource(value.debugSource)) entry.debugSource = value.debugSource;
  if (isRawStackFrame(value.stackFrame)) entry.stackFrame = value.stackFrame;
  if (entry.marker === undefined && entry.debugSource === undefined && entry.stackFrame === undefined) {
    return null;
  }
  return entry;
}

export function sanitizeRawChain(value: unknown): RawEntry[] | null {
  if (!Array.isArray(value)) return null;
  const chain: RawEntry[] = [];
  for (const item of value.slice(0, MAX_CHAIN_ENTRIES)) {
    const entry = sanitizeRawEntry(item);
    if (entry !== null) chain.push(entry);
  }
  return chain.length > 0 ? chain : null;
}

function isRect(value: unknown): value is RawRect {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.left) &&
    isFiniteNumber(value.top) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  );
}

/** Parse an inspector→agent message; `null` when it is not one. */
export function parseInspectorMessage(value: unknown): InspectorMessage | null {
  if (!isRecord(value)) return null;
  if (value.__ttc !== PROTOCOL_VERSION) return null;
  if (value.source !== "ttc-inspector") return null;
  switch (value.type) {
    case "config": {
      const config = value.config;
      if (!isRecord(config)) return null;
      if (typeof config.enabled !== "boolean") return null;
      if (typeof config.menu !== "boolean") return null;
      if (!Array.isArray(config.keyboard)) return null;
      const keyboard: ModifierKey[] = [];
      for (const key of config.keyboard) {
        if (key === "alt" || key === "ctrl" || key === "meta" || key === "shift") {
          if (!keyboard.includes(key)) keyboard.push(key);
        }
      }
      return {
        __ttc: PROTOCOL_VERSION,
        source: "ttc-inspector",
        type: "config",
        config: {
          enabled: config.enabled,
          menu: config.menu,
          keyboard: keyboard.length > 0 ? keyboard : ["alt"],
        },
      };
    }
    case "probe": {
      if (!isPosition(value.requestId)) return null;
      return {
        __ttc: PROTOCOL_VERSION,
        source: "ttc-inspector",
        type: "probe",
        requestId: value.requestId,
      };
    }
    case "menu-state": {
      if (typeof value.open !== "boolean") return null;
      return {
        __ttc: PROTOCOL_VERSION,
        source: "ttc-inspector",
        type: "menu-state",
        open: value.open,
      };
    }
    default:
      return null;
  }
}

/** Parse an agent→inspector message; `null` when it is not one. */
export function parseAgentMessage(value: unknown): AgentMessage | null {
  if (!isRecord(value)) return null;
  if (value.__ttc !== PROTOCOL_VERSION) return null;
  if (value.source !== "ttc-agent") return null;
  if (!isPosition(value.requestId)) return null;
  const requestId = value.requestId;

  switch (value.type) {
    case "hover": {
      const chain = sanitizeRawChain(value.chain);
      if (chain === null) return null;
      if (!isRect(value.rect)) return null;
      if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
      return {
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "hover",
        requestId,
        chain,
        rect: value.rect,
        x: value.x,
        y: value.y,
      };
    }
    case "activate": {
      const chain = sanitizeRawChain(value.chain);
      if (chain === null) return null;
      if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
      if (!isFiniteNumber(value.button)) return null;
      return {
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "activate",
        requestId,
        chain,
        x: value.x,
        y: value.y,
        button: value.button,
      };
    }
    case "chain-menu": {
      const chain = sanitizeRawChain(value.chain);
      if (chain === null) return null;
      if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
      return {
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "chain-menu",
        requestId,
        chain,
        x: value.x,
        y: value.y,
      };
    }
    case "dismiss":
      return {
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "dismiss",
        requestId,
        reason: "outside",
      };
    case "disarm": {
      const reason = value.reason;
      if (
        reason !== "keyup" &&
        reason !== "blur" &&
        reason !== "scroll" &&
        reason !== "escape" &&
        reason !== "disable"
      ) {
        return null;
      }
      return {
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "disarm",
        requestId,
        reason,
      };
    }
    case "status": {
      if (typeof value.hasReact !== "boolean") return null;
      const reactKind =
        value.reactKind === "18" || value.reactKind === "19" ? value.reactKind : "unknown";
      return {
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "status",
        requestId,
        hasReact: value.hasReact,
        reactKind,
      };
    }
    case "ready": {
      if (typeof value.hasReact !== "boolean") return null;
      const reactKind =
        value.reactKind === "18" || value.reactKind === "19" ? value.reactKind : "unknown";
      return {
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "ready",
        requestId,
        hasReact: value.hasReact,
        reactKind,
      };
    }
    case "hover-none":
      return {
        __ttc: PROTOCOL_VERSION,
        source: "ttc-agent",
        type: "hover-none",
        requestId,
      };
    default:
      return null;
  }
}
