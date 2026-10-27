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
import { buildEditorUrl, editorPresetLabel, LaunchLimiter } from "../lib/editor";
import { createInspector, type Inspector, type OpenEditorResult } from "../lib/install";
import { isLocalDevOrigin, originOf } from "../lib/origin";
import {
  createRequestIdFactory,
  parseAgentMessage,
  PROTOCOL_VERSION,
  type AgentMessage,
  type InspectorMessage,
} from "../lib/protocol";
import {
  RUNTIME_OPEN_EXTERNAL_MESSAGE,
  RUNTIME_STATUS_MESSAGE,
  type OpenExternalRequest,
  type OpenExternalResponse,
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
  resolveAbsoluteLocation,
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

/** Launch an IDE URL with a synthetic anchor click inside the user gesture. */
function openViaAnchor(url: string): boolean {
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    const parent = document.body ?? document.documentElement;
    if (parent === null) return false;
    parent.append(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch {
    return false;
  }
}

function openViaBackground(url: string): void {
  try {
    const request: OpenExternalRequest = {
      type: RUNTIME_OPEN_EXTERNAL_MESSAGE,
      url,
    };
    chrome.runtime.sendMessage(request, (response?: OpenExternalResponse) => {
      // Reading lastError prevents "Unchecked runtime.lastError" noise when the
      // service worker is asleep or the URL was rejected.
      const error = chrome.runtime.lastError;
      if (error || !response || response.ok !== true) {
        // eslint-disable-next-line no-console
        console.warn(
          "[tab-to-components] could not hand the editor URL to the OS:",
          error?.message ?? response?.error ?? "no response",
          url,
        );
      }
    });
  } catch {
    // Extension APIs unavailable (tests/embedding): the toast already told the
    // developer they can copy the path.
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

  const limiter = new LaunchLimiter();
  const nextProbeId = createRequestIdFactory();
  const pendingProbes = new Map<
    number,
    (message: Extract<AgentMessage, { type: "status" }>) => void
  >();

  function postToAgent(message: InspectorMessage): void {
    try {
      window.postMessage(message, "*");
    } catch {
      // postMessage unavailable: nothing to do.
    }
  }

  function effectiveEnabled(): boolean {
    if (isOriginDisabled(settings, origin)) return false;
    return settings.showWhenVitePluginActive || !pluginOverlayPresent();
  }

  function agentConfig(): { enabled: boolean; keyboard: Settings["keyboard"]; menu: boolean } {
    return {
      enabled: effectiveEnabled(),
      keyboard: settings.keyboard,
      menu: settings.menu,
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

  async function openEditor(location: SourceLocation): Promise<OpenEditorResult> {
    const root = projectRootFor(settings, origin);
    const built = buildEditorUrl(settings.editor, { location, root });
    if ("error" in built) {
      // eslint-disable-next-line no-console
      console.warn(
        "[tab-to-components] cannot build an editor URL:",
        built.error,
        location,
      );
      return { ok: false, message: built.error };
    }
    // Always trace the exact URL: when Chrome refuses to hand a protocol to
    // the OS, this line is the fastest way to tell a path problem from a
    // protocol/launch problem.
    // eslint-disable-next-line no-console
    console.info("[tab-to-components] opening editor URL:", built.url);
    const verdict = limiter.reserve(built.url);
    if (verdict === "duplicate") {
      return { ok: true, message: "Already opening that file in your editor." };
    }
    if (verdict === "limited") {
      return {
        ok: false,
        message: "Too many editor launches — try again in a moment.",
      };
    }
    const launched = openViaAnchor(built.url);
    if (!launched) openViaBackground(built.url);
    setTimeout(() => limiter.release(built.url), 750);
    // Show the absolute path when one exists: the toast is also how a
    // developer verifies that the editor URL carries a real file path.
    const file = resolveAbsoluteLocation(location, root) ?? formatLocation(location);
    const editor = editorPresetLabel(settings.editor);
    return {
      ok: true,
      message: `Opening ${file} in ${editor}. If Chrome asks, allow the protocol.`,
    };
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
    inspector = createInspector({
      settings,
      origin,
      resolver,
      openEditor,
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
    // When the developer opted into running alongside the Vite plugin, take
    // the plugin's overlay out of the page: the extension's UI is the one that
    // opens `vscode://` on this machine, and two outlines for one element are
    // unusable. When the extension is idle, the plugin's overlay is untouched.
    setForeignPluginOverlayHidden(
      document,
      enabled && settings.showWhenVitePluginActive && pluginOverlayPresent(),
    );
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
      inspector.setSettings(settings);
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
        enabled: false,
        origin,
      });
      return false;
    }

    void probeAgent().then((status) => {
      sendResponse({
        ok: true,
        hasReact: status?.hasReact ?? false,
        reactKind: status?.reactKind ?? "unknown",
        pluginOverlay,
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

    if (message.type === "ready") {
      sendConfig();
      return;
    }
    if (message.type === "status") {
      const resolveProbe = pendingProbes.get(message.requestId);
      if (resolveProbe !== undefined) resolveProbe(message);
      return;
    }

    // The Vite plugin's own overlay may mount after page load. Stay dormant
    // (unless the developer opted in) instead of rendering two overlays.
    if (!settings.showWhenVitePluginActive && pluginOverlayPresent()) {
      if (!pluginOverlayNotified) {
        pluginOverlayNotified = true;
        // eslint-disable-next-line no-console
        console.debug(
          "[tab-to-components] Vite plugin overlay detected; the extension is idle on this page. Enable \"Take over the Vite plugin overlay\" in the extension options to use this UI instead.",
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

    // Running alongside the plugin: hide its overlay as soon as it appears.
    if (
      settings.showWhenVitePluginActive &&
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
