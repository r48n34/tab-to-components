/**
 * Isolated-world inspector entry.
 *
 * Boots the overlay controller, bridges the MAIN-world agent, resolves source
 * locations, performs clipboard/editor actions and answers the popup's status
 * requests. Everything privileged (chrome.storage, clipboard, chrome.runtime)
 * lives here; the agent has no extension API access.
 */

import type { PlasmoCSConfig } from "plasmo";

import { copyText } from "../lib/clipboard";
import { createInspector, type Inspector, type OpenEditorResult } from "../lib/install";
import { isLocalDevOrigin, originOf } from "../lib/origin";
import {
  formatEditorTarget,
  OPEN_EDITOR_REQUIRES_PLUGIN,
} from "../lib/plugin-editor";
import {
  applyPluginSettings,
  type PluginConfig,
} from "../lib/plugin-config";
import {
  createRequestIdFactory,
  parseAgentMessage,
  PROTOCOL_VERSION,
  type AgentMessage,
  type InspectorMessage,
} from "../lib/protocol";
import {
  RUNTIME_STATUS_MESSAGE,
  type RuntimeStatusResponse,
} from "../lib/runtime";
import {
  createChromeSettingsStore,
  isOriginDisabled,
  projectRootFor,
  type Settings,
  type SettingsStore,
} from "../lib/settings";
import {
  formatLocation,
  type SourceLocation,
} from "../lib/source/location";
import { createSourceResolver } from "../lib/source/resolve";
import {
  FOREIGN_PLUGIN_OVERLAY_SELECTOR,
  setForeignPluginOverlayHidden,
} from "../lib/ui/overlay";

/**
 * Plasmo reads the `config` export statically with the TypeScript AST, which
 * cannot evaluate imported constants or spreads. Keep this literal in sync with
 * LOCAL_DEV_MATCHES in lib/origin.ts (guarded by test/content-config.test.ts).
 */
const MATCHES = [
  "http://localhost/*",
  "https://localhost/*",
  "http://127.0.0.1/*",
  "https://127.0.0.1/*",
  "http://[::1]/*",
  "https://[::1]/*",
];

export const config: PlasmoCSConfig = {
  matches: MATCHES,
  all_frames: true,
  run_at: "document_idle",
};

interface InspectorGlobals {
  __TTC_EXT__?: { dispose(): void };
}

function pluginOverlayPresent(): boolean {
  try {
    return document.querySelector(FOREIGN_PLUGIN_OVERLAY_SELECTOR) !== null;
  } catch {
    return false;
  }
}

async function installInspector(): Promise<(() => void) | null> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const origin = originOf(location.href);
  if (origin === null || !isLocalDevOrigin(origin)) return null;
  const pageOrigin: string = origin;

  const store: SettingsStore = createChromeSettingsStore();
  let settings = await store.load();
  if (typeof window === "undefined") return null;

  let inspector: Inspector | null = null;
  let controllerRoot: string | null = null;
  let disposed = false;
  let pluginOverlayNotified = false;
  /** Whether the plugin's overlay is currently hidden by our takeover sheet. */
  let pluginOverlayHidden = false;

  /** Plugin configuration last reported by the agent (null without plugin). */
  let plugin: PluginConfig | null = null;

  const nextProbeId = createRequestIdFactory();
  const pendingProbes = new Map<
    number,
    (message: Extract<AgentMessage, { type: "status" }>) => void
  >();
  const nextEditorRequestId = createRequestIdFactory();
  const pendingEditorRequests = new Map<
    number,
    (message: Extract<AgentMessage, { type: "open-editor-result" }>) => void
  >();

  function postToAgent(message: InspectorMessage): void {
    try {
      window.postMessage(message, "*");
    } catch {
      // postMessage unavailable: nothing to do.
    }
  }

  function pluginKey(value: PluginConfig | null): string {
    if (value === null) return "";
    return JSON.stringify([
      value.base,
      value.editorEndpoint,
      value.root,
      value.keyboard,
      value.open,
      value.clickActions,
      value.menu,
      value.theme,
    ]);
  }

  /** Store the latest plugin config; re-render when it actually changed. */
  function applyPlugin(next: PluginConfig | null): void {
    if (pluginKey(next) === pluginKey(plugin)) return;
    plugin = next;
    if (!disposed) refreshController();
  }

  /**
   * The settings in force on this page. With `settingsSource: "plugin"` and the
   * Vite plugin connected, the plugin's overlay options (keyboard, open mode,
   * click actions, menu, theme) win; everything else stays local to the
   * extension.
   */
  function effectiveSettings(): Settings {
    if (settings.settingsSource === "plugin" && plugin !== null) {
      return applyPluginSettings(settings, plugin);
    }
    return settings;
  }

  function effectiveEnabled(): boolean {
    if (isOriginDisabled(settings, origin)) return false;
    // Taking over is what makes the extension run next to the plugin's overlay;
    // with the plugin as the settings source the plugin's overlay keeps the page.
    return settings.settingsSource === "extension" || !pluginOverlayPresent();
  }

  function agentConfig(): { enabled: boolean; keyboard: Settings["keyboard"]; menu: boolean } {
    const active = effectiveSettings();
    return {
      enabled: effectiveEnabled(),
      keyboard: active.keyboard,
      menu: active.menu,
    };
  }

  function sendConfig(): void {
    postToAgent({
      __ttc: PROTOCOL_VERSION,
      source: "ttc-inspector",
      type: "config",
      config: agentConfig(),
    });
  }

  function requestOpenEditor(
    file: string,
    timeoutMs = 4000,
  ): Promise<Extract<AgentMessage, { type: "open-editor-result" }> | null> {
    return new Promise((resolveRequest) => {
      const requestId = nextEditorRequestId();
      const timer = setTimeout(() => {
        pendingEditorRequests.delete(requestId);
        resolveRequest(null);
      }, timeoutMs);
      pendingEditorRequests.set(requestId, (message) => {
        clearTimeout(timer);
        pendingEditorRequests.delete(requestId);
        resolveRequest(message);
      });
      postToAgent({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-inspector",
        type: "open-editor",
        requestId,
        file,
      });
    });
  }

  /**
   * Delegate "Open in IDE" to the Vite plugin's dev-server endpoint.
   *
   * Without the plugin there is no endpoint to call, so the action is reported
   * as unavailable instead of silently doing nothing (the inspector hides it
   * from the menu for the same reason).
   */
  async function openEditor(location: SourceLocation): Promise<OpenEditorResult> {
    if (plugin === null) {
      return { ok: false, message: OPEN_EDITOR_REQUIRES_PLUGIN };
    }
    const target = formatEditorTarget(location, plugin.root);
    if (target === null) {
      return {
        ok: false,
        message: `No usable file path for ${formatLocation(location)}.`,
      };
    }
    if (settings.debug) {
      // eslint-disable-next-line no-console
      console.debug("[tab-to-components] open in IDE:", target);
    }
    const result = await requestOpenEditor(target);
    if (result === null) {
      return { ok: false, message: "The Vite dev server did not answer." };
    }
    return { ok: result.ok, message: result.message };
  }

  function resolveProjectRoot(): string | null {
    return projectRootFor(settings, origin);
  }

  function createController(): void {
    controllerRoot = resolveProjectRoot();
    const resolver = createSourceResolver({
      pageOrigin,
      projectRoot: controllerRoot,
      base: "/",
    });
    const active = effectiveSettings();
    inspector = createInspector({
      settings: active,
      origin,
      resolver,
      openEditor,
      canOpenInIde: () => plugin !== null,
      copy: (text) => copyText(text),
      postToAgent,
    });
  }

  function stopController(): void {
    if (inspector === null) return;
    inspector.dispose();
    inspector = null;
    controllerRoot = null;
  }

  function refreshController(): void {
    const enabled = effectiveEnabled();
    // With the extension as the settings source the developer opted into
    // running alongside the Vite plugin, so take the plugin's overlay out of
    // the page: the extension's UI handles clicks on this machine, and two
    // outlines for one element are unusable. When the plugin is the settings
    // source, its overlay is the one that stays.
    const hidePluginOverlay =
      enabled && settings.settingsSource === "extension" && pluginOverlayPresent();
    setForeignPluginOverlayHidden(document, hidePluginOverlay);
    pluginOverlayHidden = hidePluginOverlay;
    if (!enabled) {
      stopController();
      sendConfig();
      return;
    }
    // The resolver captures the project root, so a root change needs a fresh
    // controller rather than just setSettings().
    if (inspector !== null && controllerRoot !== resolveProjectRoot()) {
      stopController();
    }
    if (inspector === null) {
      createController();
    } else {
      inspector.setSettings(effectiveSettings());
    }
    sendConfig();
  }

  function handleRuntimeMessage(
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: RuntimeStatusResponse) => void,
  ): boolean {
    const request = message as { type?: unknown } | null;
    if (request === null || request.type !== RUNTIME_STATUS_MESSAGE) return false;

    const pluginOverlay = pluginOverlayPresent();
    const enabled = effectiveEnabled();
    if (!enabled) {
      sendResponse({
        ok: true,
        hasReact: false,
        reactKind: "unknown",
        pluginOverlay,
        plugin: plugin !== null,
        enabled: false,
        origin,
      });
      return false;
    }

    void probeAgent().then((status) => {
      if (status !== null) applyPlugin(status.plugin);
      sendResponse({
        ok: true,
        hasReact: status?.hasReact ?? false,
        reactKind: status?.reactKind ?? "unknown",
        pluginOverlay,
        plugin: plugin !== null,
        enabled,
        origin,
      });
    });
    return true;
  }

  function probeAgent(
    timeoutMs = 600,
  ): Promise<Extract<AgentMessage, { type: "status" }> | null> {
    return new Promise((resolveProbe) => {
      const requestId = nextProbeId();
      const timer = setTimeout(() => {
        pendingProbes.delete(requestId);
        resolveProbe(null);
      }, timeoutMs);
      pendingProbes.set(requestId, (message) => {
        clearTimeout(timer);
        pendingProbes.delete(requestId);
        resolveProbe(message);
      });
      postToAgent({
        __ttc: PROTOCOL_VERSION,
        source: "ttc-inspector",
        type: "probe",
        requestId,
      });
    });
  }

  const onWindowMessage: EventListener = (rawEvent) => {
    if (disposed) return;
    const event = rawEvent as MessageEvent;
    if (event.source !== window) return;
    const message = parseAgentMessage(event.data);
    if (message === null) return;

    if (message.type === "open-editor-result") {
      const resolveRequest = pendingEditorRequests.get(message.requestId);
      if (resolveRequest !== undefined) resolveRequest(message);
      return;
    }
    if (
      message.type === "ready" ||
      message.type === "status" ||
      message.type === "activate" ||
      message.type === "chain-menu"
    ) {
      applyPlugin(message.plugin);
    }
    if (message.type === "ready") {
      sendConfig();
      return;
    }
    if (message.type === "status") {
      const resolveProbe = pendingProbes.get(message.requestId);
      if (resolveProbe !== undefined) resolveProbe(message);
      return;
    }

    // The Vite plugin's own overlay may mount after page load. With the plugin
    // as the settings source, stay dormant instead of rendering two overlays.
    if (settings.settingsSource !== "extension" && pluginOverlayPresent()) {
      if (!pluginOverlayNotified) {
        pluginOverlayNotified = true;
        // eslint-disable-next-line no-console
        console.debug(
          "[tab-to-components] Vite plugin overlay detected; the extension is idle on this page. Set \"Settings source\" to \"Extension\" in the extension options to use this UI instead.",
        );
      }
      if (pluginOverlayHidden) {
        setForeignPluginOverlayHidden(document, false);
        pluginOverlayHidden = false;
      }
      if (inspector !== null) {
        stopController();
        sendConfig();
      }
      return;
    }

    // Extension is the settings source: hide the plugin's overlay as soon as
    // it appears so only one set of controls is on the page.
    if (
      settings.settingsSource === "extension" &&
      !pluginOverlayHidden &&
      pluginOverlayPresent()
    ) {
      setForeignPluginOverlayHidden(document, true);
      pluginOverlayHidden = true;
    }

    inspector?.handleAgentMessage(message);
  };

  const onStorageChanged = (next: Settings): void => {
    if (disposed) return;
    settings = next;
    refreshController();
  };

  window.addEventListener("message", onWindowMessage);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  const unwatch = store.watch(onStorageChanged);
  refreshController();
  // Learn the plugin configuration early so the popup can report it before the
  // first click; the agent republishes it on every ready/status message.
  void probeAgent().then((status) => {
    if (!disposed && status !== null) applyPlugin(status.plugin);
  });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    try {
      window.removeEventListener("message", onWindowMessage);
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    } catch {
      // Detached windows may throw.
    }
    unwatch();
    stopController();
    if (pluginOverlayHidden) {
      setForeignPluginOverlayHidden(document, false);
      pluginOverlayHidden = false;
    }
    sendConfig();
  }

  return dispose;
}

const scope = globalThis as unknown as InspectorGlobals;
scope.__TTC_EXT__?.dispose();

void installInspector().then((dispose) => {
  if (dispose !== null) {
    scope.__TTC_EXT__ = { dispose };
  }
});
