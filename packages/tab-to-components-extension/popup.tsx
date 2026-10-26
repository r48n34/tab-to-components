/**
 * Popup: compact status + quick controls for the active tab.
 *
 * Everything here is a thin view over `chrome.storage` settings (via
 * `useSettings`) and one `ttc:status` round-trip to the inspector running in
 * the active tab. The status request handles "no receiver" (no content script
 * on the page, e.g. a production build or a non-local page).
 */

import { useCallback, useEffect, useState } from "react"

import { isLocalDevUrl, originOf } from "./lib/origin"
import {
  RUNTIME_STATUS_MESSAGE,
  type RuntimeStatusResponse,
} from "./lib/runtime"
import { isOriginDisabled, setOriginDisabled, type Settings } from "./lib/settings"
import { isModifierKey, MODIFIER_KEYS, type ModifierKey } from "./lib/types"
import { useSettings } from "./lib/ui/use-settings"

import "./lib/ui/popup.css"

const HINT_DISMISSED_KEY = "ttc:popup-hint-dismissed"
const VERSION_FALLBACK = "0.0.0"

const MODIFIER_LABELS: Record<ModifierKey, string> = {
  alt: "Alt",
  ctrl: "Ctrl",
  meta: "Meta",
  shift: "Shift",
}

interface ActiveTab {
  id: number | null
  url: string | null
  origin: string | null
}

type TabStatus =
  | { kind: "loading" }
  | { kind: "not-local" }
  | { kind: "unavailable"; detail: string }
  | { kind: "ready"; response: RuntimeStatusResponse }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Re-validate the inspector's response: it crosses an extension message
 * boundary, so it is typed but still checked before it is rendered.
 */
function parseStatusResponse(value: unknown): RuntimeStatusResponse | null {
  if (!isRecord(value)) return null
  if (
    typeof value.ok !== "boolean" ||
    typeof value.hasReact !== "boolean" ||
    typeof value.pluginOverlay !== "boolean" ||
    typeof value.enabled !== "boolean"
  ) {
    return null
  }
  const reactKind: RuntimeStatusResponse["reactKind"] =
    value.reactKind === "18" || value.reactKind === "19" ? value.reactKind : "unknown"
  return {
    ok: value.ok,
    hasReact: value.hasReact,
    reactKind,
    pluginOverlay: value.pluginOverlay,
    enabled: value.enabled,
    origin: typeof value.origin === "string" ? value.origin : null,
  }
}

function reactStatusLabel(response: RuntimeStatusResponse): string {
  if (!response.hasReact) return "React not detected"
  if (response.reactKind === "18") return "React 18 detected"
  if (response.reactKind === "19") return "React 19 detected"
  return "React detected (unknown version)"
}

function extensionVersion(): string {
  try {
    const manifest = chrome.runtime.getManifest()
    return typeof manifest.version === "string" && manifest.version !== ""
      ? manifest.version
      : VERSION_FALLBACK
  } catch {
    return VERSION_FALLBACK
  }
}

function Popup() {
  const { settings, save, loaded } = useSettings()
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null)
  const [status, setStatus] = useState<TabStatus>({ kind: "loading" })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(false)

  const version = extensionVersion()
  const modifier = settings.keyboard[0] ?? "alt"

  const requestStatus = useCallback((tabId: number) => {
    setStatus({ kind: "loading" })
    try {
      chrome.tabs.sendMessage<{ type: typeof RUNTIME_STATUS_MESSAGE }, RuntimeStatusResponse>(
        tabId,
        { type: RUNTIME_STATUS_MESSAGE },
        (response: RuntimeStatusResponse | undefined) => {
          if (chrome.runtime.lastError) {
            setStatus({
              kind: "unavailable",
              detail: "The inspector is not connected. Reload the page and try again.",
            })
            return
          }
          const parsed = parseStatusResponse(response)
          setStatus(
            parsed === null
              ? {
                  kind: "unavailable",
                  detail: "The inspector did not answer. Reload the page and try again.",
                }
              : { kind: "ready", response: parsed },
          )
        },
      )
    } catch {
      setStatus({
        kind: "unavailable",
        detail: "The inspector is not running in this tab.",
      })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (cancelled) return
        const tab = tabs[0]
        const url = typeof tab?.url === "string" ? tab.url : null
        const tabId = typeof tab?.id === "number" ? tab.id : null
        setActiveTab({ id: tabId, url, origin: originOf(url) })
        if (tabId === null || !isLocalDevUrl(url)) {
          setStatus({ kind: "not-local" })
          return
        }
        requestStatus(tabId)
      })
    } catch {
      setActiveTab({ id: null, url: null, origin: null })
      setStatus({ kind: "not-local" })
    }
    return () => {
      cancelled = true
    }
  }, [requestStatus])

  useEffect(() => {
    try {
      setShowHint(window.localStorage.getItem(HINT_DISMISSED_KEY) !== "1")
    } catch {
      setShowHint(true)
    }
  }, [])

  const persist = useCallback(
    async (next: Settings) => {
      setSaveError(null)
      try {
        await save(next)
      } catch {
        setSaveError("Could not save settings. Try again.")
      }
    },
    [save],
  )

  const retryStatus = useCallback(() => {
    if (activeTab === null || activeTab.id === null) return
    if (!isLocalDevUrl(activeTab.url)) return
    requestStatus(activeTab.id)
  }, [activeTab, requestStatus])

  const openOptions = useCallback(() => {
    setSaveError(null)
    try {
      void chrome.runtime.openOptionsPage().catch(() => {
        setSaveError("Could not open the options page.")
      })
    } catch {
      setSaveError("Could not open the options page.")
    }
  }, [])

  function dismissHint(): void {
    setShowHint(false)
    try {
      window.localStorage.setItem(HINT_DISMISSED_KEY, "1")
    } catch {
      // Private-mode storage failures must never break the popup.
    }
  }

  const origin = activeTab?.origin ?? null
  const localTab = activeTab !== null && isLocalDevUrl(activeTab.url)
  const originEnabled = origin !== null && !settings.disabledOrigins.includes(origin)
  const overlayEnabled = origin !== null && !isOriginDisabled(settings, origin)
  const runtimeMismatch =
    status.kind === "ready" && localTab && status.response.enabled !== overlayEnabled

  return (
    <main className="popup">
      <header className="popup__header">
        <div className="popup__brand">
          <h1 className="popup__title">tab-to-components</h1>
          <span className="popup__version">v{version}</span>
        </div>
      </header>

      <section className="status" aria-label="Active tab status" aria-live="polite">
        <h2 className="section-label">This tab</h2>

        {status.kind === "loading" && (
          <p className="status__line">
            <span className="dot dot--pending" aria-hidden="true" />
            <span className="status__text">Checking the active tab…</span>
          </p>
        )}

        {status.kind === "not-local" && (
          <>
            <p className="status__line">
              <span className="dot" aria-hidden="true" />
              <span className="status__text">Not a local dev server</span>
            </p>
            <p className="status__hint">
              Open a <code>localhost</code> or <code>127.0.0.1</code> page to inspect
              React elements.
            </p>
          </>
        )}

        {status.kind === "unavailable" && (
          <>
            <p className="status__line">
              <span className="dot dot--warn" aria-hidden="true" />
              <span className="status__text">Inspector not connected</span>
            </p>
            <p className="status__hint">{status.detail}</p>
            {localTab && activeTab?.id !== null && activeTab?.id !== undefined && (
              <button
                type="button"
                className="btn btn--small status__retry"
                onClick={retryStatus}
              >
                Retry
              </button>
            )}
          </>
        )}

        {status.kind === "ready" && (
          <>
            <p className="status__line">
              <span
                className={`dot ${status.response.hasReact ? "dot--ok" : "dot--warn"}`}
                aria-hidden="true"
              />
              <span className="status__text">{reactStatusLabel(status.response)}</span>
            </p>
            <p className="status__line">
              <span
                className={`dot ${status.response.pluginOverlay ? "dot--info" : ""}`}
                aria-hidden="true"
              />
              <span className="status__text">
                {status.response.pluginOverlay
                  ? "Vite plugin overlay active (idle)"
                  : "No Vite plugin overlay"}
              </span>
            </p>
            <p className="status__line">
              <span
                className={`dot ${overlayEnabled ? "dot--ok" : "dot--warn"}`}
                aria-hidden="true"
              />
              <span className="status__text">
                {overlayEnabled
                  ? "Overlay enabled for this origin"
                  : "Overlay disabled for this origin"}
              </span>
            </p>
            {status.response.pluginOverlay && !settings.showWhenVitePluginActive && (
              <p className="status__hint">
                tab-to-components stays idle while the Vite plugin overlay is active.
                Allow both in Options → Advanced.
              </p>
            )}
            {!status.response.hasReact && (
              <p className="status__hint">
                No React development build was detected on this page.
              </p>
            )}
            {runtimeMismatch && (
              <p className="status__hint">
                This tab still uses the previous setting. Reload the page to apply the
                change.
              </p>
            )}
          </>
        )}
      </section>

      <section className="controls" aria-label="Quick settings">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={!loaded}
            onChange={(event) => {
              void persist({ ...settings, enabled: event.target.checked })
            }}
          />
          <span className="check__text">
            <span className="check__label">Extension enabled</span>
            <span className="check__detail">Master switch for every site.</span>
          </span>
        </label>

        <label className={`check${origin === null ? " check--disabled" : ""}`}>
          <input
            type="checkbox"
            checked={originEnabled}
            disabled={!loaded || origin === null}
            onChange={(event) => {
              if (origin === null) return
              void persist(setOriginDisabled(settings, origin, !event.target.checked))
            }}
          />
          <span className="check__text">
            <span className="check__label">
              Enabled on <code>{origin ?? "this origin"}</code>
            </span>
            <span className="check__detail">
              {origin === null
                ? "This tab has no web origin."
                : !settings.enabled
                  ? "The master switch is off, so the overlay is paused everywhere."
                  : "Turn the overlay off for just this origin."}
            </span>
          </span>
        </label>

        <div className="field">
          <label className="field__label" htmlFor="ttc-modifier">
            Modifier key
          </label>
          <select
            id="ttc-modifier"
            value={modifier}
            disabled={!loaded}
            onChange={(event) => {
              const value = event.target.value
              if (!isModifierKey(value)) return
              void persist({ ...settings, keyboard: [value] })
            }}
          >
            {MODIFIER_KEYS.map((key) => (
              <option key={key} value={key}>
                {MODIFIER_LABELS[key]}
              </option>
            ))}
          </select>
          <p className="field__detail">
            Hold {MODIFIER_LABELS[modifier]} and click an element to inspect it.
          </p>
        </div>
      </section>

      {showHint && (
        <aside className="hint">
          <p>
            <strong>Tip:</strong> hold {MODIFIER_LABELS[modifier]} and click an element on
            a localhost dev server to jump to its source.
          </p>
          <button type="button" className="hint__dismiss" onClick={dismissHint}>
            Got it
          </button>
        </aside>
      )}

      <footer className="popup__footer">
        <button type="button" className="btn btn--primary" onClick={openOptions}>
          Open settings
        </button>
        {saveError !== null && (
          <p className="save-error" role="alert">
            {saveError}
          </p>
        )}
      </footer>
    </main>
  )
}

export default Popup
