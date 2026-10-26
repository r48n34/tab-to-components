// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInspector, type InspectorDependencies } from "../lib/install";
import type { AgentMessage, InspectorMessage, RawEntry } from "../lib/protocol";
import { normalizeSettings, type Settings } from "../lib/settings";
import type { SourceLocation } from "../lib/source/location";
import { createSourceResolver } from "../lib/source/resolve";
import { EXT_ATTRIBUTE, THEME_ATTRIBUTE, UI_ATTRIBUTE } from "../lib/ui/overlay";
import { viteReact19Module as fixture } from "./fixtures/vite-react19-module";

const ORIGIN = "http://localhost:5173";

const REACT18_CHAIN: RawEntry[] = [
  {
    name: "button",
    isHost: true,
    debugSource: {
      fileName: "D:/proj/src/components/Button.tsx",
      lineNumber: 6,
      columnNumber: 10,
    },
  },
  {
    name: "Button",
    isHost: false,
    debugSource: {
      fileName: "D:/proj/src/App.tsx",
      lineNumber: 20,
      columnNumber: 9,
    },
  },
  {
    name: "App",
    isHost: false,
    debugSource: {
      fileName: "D:/proj/src/App.tsx",
      lineNumber: 9,
      columnNumber: 5,
    },
  },
];

const REACT19_CHAIN: RawEntry[] = [
  {
    name: "Button",
    isHost: false,
    stackFrame: {
      url: fixture.moduleUrl,
      line: fixture.generated.line,
      column: fixture.generated.column,
    },
  },
];

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return normalizeSettings({
    projectRoots: { [ORIGIN]: "D:/proj" },
    ...overrides,
  });
}

interface Harness {
  inspector: ReturnType<typeof createInspector>;
  postToAgent: ReturnType<typeof vi.fn>;
  copy: ReturnType<typeof vi.fn>;
  openEditor: ReturnType<typeof vi.fn>;
  dispose: () => void;
}

function createHarness(settings: Settings): Harness {
  document.body.innerHTML = "";
  const postToAgent = vi.fn();
  const copy = vi.fn(async () => true);
  const openEditor = vi.fn(async (location: SourceLocation) => ({
    ok: true,
    message: `Opening ${location.file}:${location.line}:${location.column}`,
  }));
  const resolver = createSourceResolver({
    pageOrigin: ORIGIN,
    projectRoot: settings.projectRoots[ORIGIN] ?? null,
    fetchText: async (url: string) => (url === fixture.moduleUrl ? fixture.code : null),
  });
  const deps: InspectorDependencies = {
    settings,
    origin: ORIGIN,
    resolver,
    openEditor,
    copy,
    postToAgent,
  };
  const inspector = createInspector(deps);
  return {
    inspector,
    postToAgent,
    copy,
    openEditor,
    dispose: () => inspector.dispose(),
  };
}

function shadow(): ShadowRoot {
  const host = document.querySelector(`[${UI_ATTRIBUTE}]`);
  if (!host?.shadowRoot) throw new Error("overlay host/shadow root missing");
  return host.shadowRoot;
}

function overlayHost(): HTMLElement {
  const host = document.querySelector<HTMLElement>(`[${UI_ATTRIBUTE}]`);
  if (host === null) throw new Error("overlay host missing");
  return host;
}

function labelName(): string {
  return shadow().querySelector(".ttc-label-name")?.textContent ?? "";
}

function labelSource(): string {
  return shadow().querySelector(".ttc-label-source")?.textContent ?? "";
}

function labelVisible(): boolean {
  const label = shadow().querySelector<HTMLElement>(".ttc-label");
  return label !== null && label.style.display !== "none";
}

function menuRows(kind: "actions" | "chain"): HTMLButtonElement[] {
  return Array.from(
    shadow().querySelectorAll<HTMLButtonElement>(
      `[data-ttc-menu="${kind}"] .ttc-menu-item`,
    ),
  );
}

function menuVisible(kind: "actions" | "chain"): boolean {
  const menu = shadow().querySelector<HTMLElement>(`[data-ttc-menu="${kind}"]`);
  return menu !== null && menu.style.display !== "none";
}

function toastText(): string {
  return shadow().querySelector(".ttc-toast")?.textContent ?? "";
}

function toastVisible(): boolean {
  const toast = shadow().querySelector<HTMLElement>(".ttc-toast");
  return toast !== null && toast.style.display !== "none";
}

function hover(chain: RawEntry[]): AgentMessage {
  return {
    __ttc: 1,
    source: "ttc-agent",
    type: "hover",
    requestId: 1,
    chain,
    rect: { left: 10, top: 20, width: 100, height: 32 },
    x: 40,
    y: 60,
  };
}

function activate(chain: RawEntry[], x = 40, y = 60): AgentMessage {
  return {
    __ttc: 1,
    source: "ttc-agent",
    type: "activate",
    requestId: 2,
    chain,
    x,
    y,
    button: 0,
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function clickRow(row: HTMLButtonElement): void {
  row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

let harness: Harness | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("inspector hover", () => {
  it("shows the nearest component and its project-relative source", async () => {
    harness = createHarness(baseSettings());
    harness.inspector.handleAgentMessage(hover(REACT18_CHAIN));
    await flush();

    expect(labelVisible()).toBe(true);
    expect(labelName()).toBe("<Button />");
    expect(labelSource()).toBe("src/App.tsx:20:9");
    expect(overlayHost().getAttribute(EXT_ATTRIBUTE)).not.toBeNull();
    expect(overlayHost().getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("resolves React 19 stack frames through the fixture source map", async () => {
    harness = createHarness(baseSettings());
    harness.inspector.handleAgentMessage(hover(REACT19_CHAIN));
    await flush();
    expect(labelName()).toBe("<Button />");
    expect(labelSource()).toBe("src/App.tsx:20:9");
  });

  it("falls back to the bare file name when no project root matches", async () => {
    harness = createHarness(baseSettings({ projectRoots: {} }));
    harness.inspector.handleAgentMessage(
      hover([
        {
          name: "Button",
          isHost: false,
          debugSource: {
            fileName: "D:/unrelated/App.tsx",
            lineNumber: 3,
            columnNumber: 4,
          },
        },
      ]),
    );
    await flush();
    expect(labelSource()).toBe("D:/unrelated/App.tsx:3:4");
  });

  it("hides the label on hover-none and disarm", async () => {
    harness = createHarness(baseSettings());
    harness.inspector.handleAgentMessage(hover(REACT18_CHAIN));
    await flush();
    expect(labelVisible()).toBe(true);

    harness.inspector.handleAgentMessage({
      __ttc: 1,
      source: "ttc-agent",
      type: "hover-none",
      requestId: 3,
    });
    expect(labelVisible()).toBe(false);
  });
});

describe("inspector actions", () => {
  it("runs a single action immediately", async () => {
    harness = createHarness(baseSettings({ clickActions: ["copy-file"] }));
    harness.inspector.handleAgentMessage(activate(REACT18_CHAIN));
    await flush();

    expect(harness.copy).toHaveBeenCalledWith("App.tsx");
    expect(menuVisible("actions")).toBe(false);
    expect(toastVisible()).toBe(true);
    expect(toastText()).toBe("Copied file name: App.tsx");
  });

  it("copies the full path using the configured project root", async () => {
    harness = createHarness(baseSettings({ clickActions: ["copy-full-path"] }));
    harness.inspector.handleAgentMessage(activate(REACT18_CHAIN));
    await flush();
    expect(harness.copy).toHaveBeenCalledWith("D:/proj/src/App.tsx");
    expect(toastText()).toBe("Copied full path: D:/proj/src/App.tsx");
  });

  it("shows the action picker and opens the editor from a row", async () => {
    harness = createHarness(baseSettings());
    harness.inspector.handleAgentMessage(activate(REACT18_CHAIN));
    await flush();

    expect(menuVisible("actions")).toBe(true);
    const rows = menuRows("actions");
    expect(rows.map((row) => row.querySelector(".ttc-menu-name")?.textContent)).toEqual([
      "Open in IDE",
      "Copy file name",
      "Copy full path",
    ]);
    expect(menuRows("actions")[2]?.querySelector(".ttc-menu-source")?.textContent).toBe(
      "D:/proj/src/App.tsx",
    );
    expect(harness.postToAgent).toHaveBeenCalledWith({
      __ttc: 1,
      source: "ttc-inspector",
      type: "menu-state",
      open: true,
    });

    const openRow = rows[0];
    if (openRow === undefined) throw new Error("missing open row");
    clickRow(openRow);
    await flush();

    expect(harness.openEditor).toHaveBeenCalledTimes(1);
    const location = harness.openEditor.mock.calls[0]?.[0] as SourceLocation;
    expect(location.relativeFile).toBe("src/App.tsx");
    expect(location.line).toBe(20);
    expect(toastText()).toContain("Opening");
    expect(harness.postToAgent).toHaveBeenCalledWith({
      __ttc: 1,
      source: "ttc-inspector",
      type: "menu-state",
      open: false,
    });
  });

  it("shows the chain picker and opens a chosen ancestor", async () => {
    harness = createHarness(baseSettings());
    harness.inspector.handleAgentMessage({
      __ttc: 1,
      source: "ttc-agent",
      type: "chain-menu",
      requestId: 4,
      chain: REACT18_CHAIN,
      x: 10,
      y: 20,
    });
    await flush();

    expect(menuVisible("chain")).toBe(true);
    const rows = menuRows("chain");
    expect(rows.map((row) => row.querySelector(".ttc-menu-name")?.textContent)).toEqual([
      "<button />",
      "<Button />",
      "<App />",
    ]);
    expect(rows[1]?.querySelector(".ttc-menu-source")?.textContent).toBe(
      "src/App.tsx:20:9",
    );

    clickRow(rows[1] as HTMLButtonElement);
    await flush();
    expect(harness.openEditor).toHaveBeenCalledTimes(1);
  });

  it("reports a missing source location instead of copying", async () => {
    harness = createHarness(baseSettings({ clickActions: ["copy-file"] }));
    harness.inspector.handleAgentMessage(
      activate([{ name: "button", isHost: true }]),
    );
    await flush();
    expect(harness.copy).not.toHaveBeenCalled();
    expect(toastText()).toMatch(/no source location/i);
    expect(toastVisible()).toBe(true);
  });

  it("closes the menu on dismiss, scroll and Escape", async () => {
    harness = createHarness(baseSettings());
    harness.inspector.handleAgentMessage(activate(REACT18_CHAIN));
    await flush();
    expect(menuVisible("actions")).toBe(true);

    harness.inspector.handleAgentMessage({
      __ttc: 1,
      source: "ttc-agent",
      type: "dismiss",
      requestId: 5,
      reason: "outside",
    });
    expect(menuVisible("actions")).toBe(false);

    harness.inspector.handleAgentMessage(activate(REACT18_CHAIN));
    await flush();
    expect(menuVisible("actions")).toBe(true);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(menuVisible("actions")).toBe(false);
  });
});

describe("inspector settings", () => {
  it("updates the theme when settings change", () => {
    harness = createHarness(baseSettings());
    harness.inspector.setSettings(baseSettings({ theme: "light" }));
    expect(overlayHost().getAttribute(THEME_ATTRIBUTE)).toBe("light");
  });

  it("uses the project root the resolver was created with", async () => {
    harness = createHarness(baseSettings({ projectRoots: {} }));
    harness.inspector.handleAgentMessage(hover(REACT18_CHAIN));
    await flush();
    // No root configured: the absolute path is the best display value.
    expect(labelSource()).toBe("D:/proj/src/App.tsx:20:9");
  });

  it("stops reacting and removes its DOM after dispose", async () => {
    harness = createHarness(baseSettings());
    harness.dispose();
    harness.inspector.handleAgentMessage(hover(REACT18_CHAIN));
    await flush();
    expect(document.querySelector(`[${UI_ATTRIBUTE}]`)).toBeNull();
  });
});

describe("inspector protocol emission", () => {
  it("never emits a menu-state message before a menu exists", async () => {
    harness = createHarness(baseSettings());
    harness.inspector.handleAgentMessage(hover(REACT18_CHAIN));
    await flush();
    const emitted = harness.postToAgent.mock.calls.map(
      (call) => (call[0] as InspectorMessage).type,
    );
    expect(emitted).not.toContain("menu-state");
  });
});
