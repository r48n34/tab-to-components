/**
 * Inspector controller (ISOLATED world).
 *
 * Owns the overlay UI and turns agent events into hover labels, action menus
 * and chain menus. Source resolution, clipboard writes and editor launches are
 * injected by the content-script entry so this module stays testable in
 * happy-dom without chrome APIs.
 */

import { sourceActionCopy, sourceActionDetail, sourceActionLabel } from "./actions";
import type { AgentMessage, InspectorMessage, RawEntry } from "./protocol";
import { formatLocation, formatNameLabel } from "./source/location";
import type { SourceLocation } from "./source/location";
import type { ResolvedEntry, SourceResolver } from "./source/types";
import { projectRootFor, type Settings } from "./settings";
import { THEME_ATTRIBUTE, Overlay, type MenuItem } from "./ui/overlay";
import type { ClickAction, OpenMode } from "./types";

export interface OpenEditorResult {
  ok: boolean;
  /** Toast message on success, or the error description on failure. */
  message?: string;
}

export interface InspectorDependencies {
  settings: Settings;
  /** `new URL(location.href).origin`, when the page has one. */
  origin: string | null;
  resolver: SourceResolver;
  openEditor: (location: SourceLocation) => Promise<OpenEditorResult>;
  copy: (text: string) => Promise<boolean>;
  postToAgent: (message: InspectorMessage) => void;
  document?: Document;
  window?: Window;
}

export interface Inspector {
  dispose(): void;
  handleAgentMessage(message: AgentMessage): void;
  setSettings(settings: Settings): void;
  readonly isMenuOpen: boolean;
}

function pickRawPrimary(chain: readonly RawEntry[], open: OpenMode): RawEntry | null {
  const first = chain[0] ?? null;
  if (first === null) return null;
  if (open === "element") return first;
  return chain.find((entry) => !entry.isHost) ?? first;
}

/** Create the inspector UI controller. */
export function createInspector(deps: InspectorDependencies): Inspector {
  const doc = deps.document ?? document;
  const win = deps.window ?? window;

  let settings = deps.settings;
  let root = projectRootFor(settings, deps.origin);
  let disposed = false;

  let hoverToken = 0;

  const overlay = new Overlay(doc, settings.theme);
  function notifyMenuState(open: boolean): void {
    deps.postToAgent({
      __ttc: 1,
      source: "ttc-inspector",
      type: "menu-state",
      open,
    });
  }

  function closeMenu(): void {
    if (!overlay.isMenuOpen) return;
    overlay.closeMenu();
    notifyMenuState(false);
  }

  function toastError(message: string): void {
    overlay.showToast(message, { error: true, duration: 4000 });
  }

  async function safeResolve(entry: RawEntry): Promise<ResolvedEntry | null> {
    try {
      return await deps.resolver.resolve(entry);
    } catch {
      return null;
    }
  }

  async function safeResolveChain(entries: readonly RawEntry[]): Promise<ResolvedEntry[]> {
    try {
      return await deps.resolver.resolveChain(entries);
    } catch {
      return entries.map((entry) => ({
        name: entry.name,
        isHost: entry.isHost,
        location: null,
      }));
    }
  }

  function rememberMenu(open: boolean): void {
    notifyMenuState(open);
  }

  /**
   * Overlay rows close the menu themselves before invoking `onActivate`, so the
   * controller must report the closed state here instead of relying on
   * `closeMenu()` (which is a no-op by then).
   */
  function activatedMenuItem(run: () => void): void {
    rememberMenu(false);
    run();
  }

  function runOpen(entry: ResolvedEntry): void {
    closeMenu();
    if (entry.location === null) {
      toastError(`No source location available for ${formatNameLabel(entry.name)}.`);
      return;
    }
    const location = entry.location;
    void deps.openEditor(location).then((result) => {
      if (disposed) return;
      if (result.ok) {
        overlay.showToast(
          result.message ??
            `Opened ${formatNameLabel(entry.name)} ${formatLocation(location)}`,
        );
        return;
      }
      toastError(result.message ?? "Could not open the editor.");
    });
  }

  function runCopy(action: ClickAction, entry: ResolvedEntry): void {
    closeMenu();
    const copy = sourceActionCopy(action, entry, root);
    if (copy === null) {
      toastError("Copying this path is not possible: no source location is available.");
      return;
    }
    void deps.copy(copy.text).then((copied) => {
      if (disposed) return;
      if (copied) {
        overlay.showToast(copy.toast);
        return;
      }
      toastError(`Could not copy. Copy manually: ${copy.text}`);
    });
  }

  function runAction(action: ClickAction, entry: ResolvedEntry | null): void {
    if (entry === null) {
      toastError("No source location available for this element.");
      return;
    }
    if (action === "open") {
      runOpen(entry);
      return;
    }
    runCopy(action, entry);
  }

  function actionItems(entry: ResolvedEntry | null): MenuItem[] {
    return settings.clickActions.map((action) => ({
      label: sourceActionLabel(action),
      detail:
        entry === null
          ? "No source location"
          : sourceActionDetail(action, entry, root),
      action,
      onActivate: () => activatedMenuItem(() => runAction(action, entry)),
    }));
  }

  async function showActionMenu(
    primary: RawEntry,
    x: number,
    y: number,
  ): Promise<void> {
    const resolved = await safeResolve(primary);
    if (disposed) return;
    const actions = settings.clickActions;
    const first = actions[0];
    if (first === undefined) return;
    if (actions.length === 1) {
      runAction(first, resolved);
      return;
    }
    overlay.showMenu(actionItems(resolved), x, y, {
      kind: "actions",
      ariaLabel: "Source actions",
    });
    if (overlay.isMenuOpen) rememberMenu(true);
  }

  async function showChainMenu(
    rawChain: readonly RawEntry[],
    x: number,
    y: number,
  ): Promise<void> {
    const resolvedChain = await safeResolveChain(rawChain);
    if (disposed) return;
    const items: MenuItem[] = resolvedChain.map((entry) => ({
      label: formatNameLabel(entry.name),
      detail: entry.location ? formatLocation(entry.location) : "",
      onActivate: () => activatedMenuItem(() => runOpen(entry)),
    }));
    if (items.length === 0) return;
    overlay.showMenu(items, x, y, {
      kind: "chain",
      ariaLabel: "Component chain",
    });
    if (overlay.isMenuOpen) rememberMenu(true);
  }

  async function handleHover(message: Extract<AgentMessage, { type: "hover" }>): Promise<void> {
    if (overlay.isMenuOpen) return;
    const token = ++hoverToken;
    const primary = pickRawPrimary(message.chain, settings.open);
    if (primary === null) {
      overlay.hideHover();
      return;
    }
    const resolved = await safeResolve(primary);
    if (disposed || token !== hoverToken || overlay.isMenuOpen) return;
    overlay.presentHover({
      rect: message.rect,
      name: resolved?.name ?? primary.name,
      source: resolved?.location ? formatLocation(resolved.location) : "",
      x: message.x,
      y: message.y,
    });
  }

  async function handleActivate(
    message: Extract<AgentMessage, { type: "activate" }>,
  ): Promise<void> {
    hoverToken += 1;
    overlay.hideHover();
    const primary = pickRawPrimary(message.chain, settings.open);
    if (primary === null) return;
    if (settings.open === "menu") {
      await showChainMenu(message.chain, message.x, message.y);
      return;
    }
    await showActionMenu(primary, message.x, message.y);
  }

  async function handleChainMenu(
    message: Extract<AgentMessage, { type: "chain-menu" }>,
  ): Promise<void> {
    hoverToken += 1;
    overlay.hideHover();
    await showChainMenu(message.chain, message.x, message.y);
  }

  function hideHover(): void {
    hoverToken += 1;
    overlay.hideHover();
  }

  const onKeyDown: EventListener = (rawEvent) => {
    if (disposed || !overlay.isMenuOpen) return;
    const event = rawEvent as KeyboardEvent;
    if (!overlay.handleMenuKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!overlay.isMenuOpen) rememberMenu(false);
  };

  win.addEventListener("keydown", onKeyDown, true);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    win.removeEventListener("keydown", onKeyDown, true);
    if (overlay.isMenuOpen) rememberMenu(false);
    overlay.destroy();
  }

  function setSettings(next: Settings): void {
    settings = next;
    root = projectRootFor(settings, deps.origin);
    overlay.hostElement.setAttribute(THEME_ATTRIBUTE, settings.theme);
    if (overlay.isMenuOpen) closeMenu();
  }

  function handleAgentMessage(message: AgentMessage): void {
    if (disposed) return;
    switch (message.type) {
      case "hover":
        void handleHover(message);
        return;
      case "hover-none":
        hideHover();
        return;
      case "activate":
        void handleActivate(message);
        return;
      case "chain-menu":
        void handleChainMenu(message);
        return;
      case "dismiss":
        closeMenu();
        return;
      case "disarm":
        hideHover();
        if (message.reason === "scroll" || message.reason === "blur" || message.reason === "disable") {
          closeMenu();
        }
        return;
      default:
        return;
    }
  }

  return {
    dispose,
    handleAgentMessage,
    setSettings,
    get isMenuOpen() {
      return overlay.isMenuOpen;
    },
  };
}
