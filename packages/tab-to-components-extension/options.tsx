/**
 * Options page: the full settings surface.
 *
 * Every change is written through `useSettings` (normalized + chrome.storage),
 * so there is no save button: selects and checkboxes save immediately, text
 * fields debounce or commit on blur, and a small header badge confirms writes.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
} from "react"

import { EDITOR_PRESETS, isEditorPresetId } from "./lib/editor"
import { normalizeOrigin } from "./lib/origin"
import { createDefaultSettings, type Settings } from "./lib/settings"
import {
  isSafeAbsolutePath,
  MAX_PATH_LENGTH,
  normalizeSlashes,
} from "./lib/source/location"
import {
  CLICK_ACTIONS,
  DEFAULT_CLICK_ACTIONS,
  MODIFIER_KEYS,
  OPEN_MODES,
  THEME_MODES,
  type ClickAction,
  type ModifierKey,
  type OpenMode,
  type ThemeMode,
} from "./lib/types"
import { useSettings } from "./lib/ui/use-settings"

import "./lib/ui/options.css"

const VERSION_FALLBACK = "0.0.0"
const CUSTOM_TEMPLATE_SEED = "vscode://file/{path}:{line}:{column}"
const PLACEHOLDER_TEXT = "{path}, {file}, {fileUri}, {line} and {column}"
const FALLBACK_MODIFIERS: readonly ModifierKey[] = ["alt"]

const MODIFIER_LABELS: Record<ModifierKey, string> = {
  alt: "Alt",
  ctrl: "Ctrl",
  meta: "Meta",
  shift: "Shift",
}

const MODIFIER_DETAILS: Record<ModifierKey, string> = {
  alt: "Alt / Option on macOS",
  ctrl: "Control",
  meta: "Command on macOS, Windows key elsewhere",
  shift: "Shift",
}

const OPEN_MODE_INFO: Record<OpenMode, { label: string; detail: string }> = {
  component: {
    label: "Component (default)",
    detail: "Open the nearest component's JSX usage site.",
  },
  element: {
    label: "Element",
    detail: "Open the clicked DOM element's own JSX site.",
  },
  menu: {
    label: "Menu",
    detail: "Open the component chain picker on left click.",
  },
}

const THEME_INFO: Record<ThemeMode, { label: string; detail: string }> = {
  dark: {
    label: "Dark (default)",
    detail: "Blue-on-black overlay, matching the Vite plugin's original design.",
  },
  light: {
    label: "Light",
    detail: "Blue-on-white overlay for light apps and screenshots.",
  },
}

const ACTION_INFO: Record<ClickAction, { label: string; detail: string }> = {
  open: {
    label: "Open in IDE",
    detail: "Open the source location in the configured editor.",
  },
  "copy-file": {
    label: "Copy file name",
    detail: "e.g. MyBox.tsx",
  },
  "copy-path": {
    label: "Copy relative path",
    detail: "e.g. app/components/MyBox.tsx",
  },
  "copy-full-path": {
    label: "Copy full path",
    detail: "e.g. D:/projects/app/src/MyBox.tsx",
  },
  "copy-location": {
    label: "Copy file:line:column",
    detail: "e.g. app/components/MyBox.tsx:12:5",
  },
}

type SaveState = "idle" | "saving" | "saved" | "error"

interface RootRow {
  key: string
  origin: string
  root: string
  originError: string | null
  rootError: string | null
}

function normalizeRootPath(value: string): string {
  return normalizeSlashes(value.trim()).replace(/\/+$/, "")
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

function Options() {
  const { settings, save, loaded } = useSettings()

  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [notice, setNotice] = useState<string | null>(null)
  const [templateDraft, setTemplateDraft] = useState("")
  const [rows, setRows] = useState<RootRow[]>([])
  const [rowsLoaded, setRowsLoaded] = useState(false)
  const [resetPending, setResetPending] = useState(false)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const templateFocusedRef = useRef(false)
  const rowKeyRef = useRef(0)
  const rowsRef = useRef<RootRow[]>(rows)
  rowsRef.current = rows

  const version = extensionVersion()
  const activePreset =
    EDITOR_PRESETS.find((preset) => preset.id === settings.editor.preset) ?? null
  const presetHint = activePreset?.hint ?? null
  const presetTemplate =
    activePreset !== null && activePreset.id !== "custom" ? activePreset.template : null

  function createRow(origin = "", root = ""): RootRow {
    rowKeyRef.current += 1
    return {
      key: `root-${rowKeyRef.current}`,
      origin,
      root,
      originError: null,
      rootError: null,
    }
  }

  const persist = useCallback(
    async (next: Settings): Promise<boolean> => {
      setSaveState("saving")
      try {
        await save(next)
        setSaveState("saved")
        if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => setSaveState("idle"), 1800)
        return true
      } catch {
        setSaveState("error")
        return false
      }
    },
    [save],
  )

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setNotice(null), 5000)
  }, [])

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
      if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current)
    },
    [],
  )

  /* ------------------------------------------------------------- project roots */

  useEffect(() => {
    if (!loaded || rowsLoaded) return
    setRows(
      Object.entries(settings.projectRoots).map(([origin, root]) => createRow(origin, root)),
    )
    setRowsLoaded(true)
    // createRow is a stable local helper; only run this once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, rowsLoaded, settings.projectRoots])

  async function commitRoots(nextRows: RootRow[]): Promise<boolean> {
    const roots: Record<string, string> = {}
    const seenOrigins = new Set<string>()
    const errors = new Map<string, { origin: string | null; root: string | null }>()

    for (const row of nextRows) {
      const rawOrigin = row.origin.trim()
      const rawRoot = row.root.trim()
      if (rawOrigin === "" && rawRoot === "") continue

      const origin = normalizeOrigin(rawOrigin)
      const normalizedRoot = normalizeRootPath(rawRoot)

      let originError: string | null = null
      if (origin === null) {
        originError = "Enter an http(s) origin, for example localhost:5173."
      } else if (seenOrigins.has(origin)) {
        originError = "This origin is already listed above."
      } else {
        seenOrigins.add(origin)
      }

      const rootError =
        normalizedRoot === "" ||
        normalizedRoot.length > MAX_PATH_LENGTH ||
        !isSafeAbsolutePath(normalizedRoot)
          ? "Enter an absolute path, for example D:/projects/my-app or /home/me/my-app."
          : null

      if (originError !== null || rootError !== null) {
        errors.set(row.key, { origin: originError, root: rootError })
      } else if (origin !== null) {
        roots[origin] = normalizedRoot
      }
    }

    if (errors.size > 0) {
      setRows(
        nextRows.map((row) => {
          const error = errors.get(row.key)
          return error === undefined
            ? { ...row, originError: null, rootError: null }
            : { ...row, originError: error.origin, rootError: error.root }
        }),
      )
      return false
    }

    setRows(
      nextRows.map((row) =>
        row.origin.trim() === "" && row.root.trim() === ""
          ? { ...row, originError: null, rootError: null }
          : {
              ...row,
              origin: normalizeOrigin(row.origin.trim()) ?? row.origin.trim(),
              root: normalizeRootPath(row.root),
              originError: null,
              rootError: null,
            },
      ),
    )

    const currentRoots = settings.projectRoots
    const changed =
      Object.keys(roots).length !== Object.keys(currentRoots).length ||
      Object.entries(roots).some(([origin, root]) => currentRoots[origin] !== root)
    if (!changed) return true
    return persist({ ...settings, projectRoots: roots })
  }

  function updateRootRow(
    key: string,
    patch: Partial<Pick<RootRow, "origin" | "root">>,
  ): void {
    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? { ...row, ...patch, originError: null, rootError: null }
          : row,
      ),
    )
  }

  function addRootRow(): void {
    setRows((current) => [...current, createRow()])
  }

  function removeRootRow(key: string): void {
    const nextRows = rowsRef.current.filter((row) => row.key !== key)
    setRows(nextRows)
    void commitRoots(nextRows)
  }

  function handleRootRowBlur(event: FocusEvent<HTMLDivElement>): void {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      // Focus is still inside this row; wait until the whole row is left.
      return
    }
    void commitRoots(rowsRef.current)
  }

  /* ------------------------------------------------------------------ editor */

  useEffect(() => {
    if (templateFocusedRef.current) return
    setTemplateDraft(settings.editor.template)
  }, [settings.editor.preset, settings.editor.template])

  // While the custom template input is focused, save shortly after typing
  // stops. Blur (below) commits immediately as a backstop.
  useEffect(() => {
    if (!loaded || !templateFocusedRef.current) return
    const trimmed = templateDraft.trim()
    if (trimmed === "" || trimmed === settings.editor.template) return
    const timer = setTimeout(() => {
      void persist({ ...settings, editor: { preset: "custom", template: trimmed } })
    }, 700)
    return () => clearTimeout(timer)
  }, [templateDraft, loaded, settings, persist])

  function commitTemplate(): void {
    const trimmed = templateDraft.trim()
    if (trimmed === "" || trimmed === settings.editor.template) return
    void persist({ ...settings, editor: { preset: "custom", template: trimmed } })
  }

  function changeEditorPreset(value: string): void {
    if (!isEditorPresetId(value)) return
    if (value === "custom") {
      const template =
        settings.editor.template.trim() === ""
          ? CUSTOM_TEMPLATE_SEED
          : settings.editor.template
      void persist({ ...settings, editor: { preset: "custom", template } })
      return
    }
    void persist({ ...settings, editor: { preset: value, template: "" } })
  }

  /* --------------------------------------------------------------- activation */

  function toggleModifier(key: ModifierKey, checked: boolean): void {
    let next: ModifierKey[]
    if (checked) {
      next = settings.keyboard.includes(key)
        ? [...settings.keyboard]
        : [...settings.keyboard, key]
    } else {
      next = settings.keyboard.filter((item) => item !== key)
      if (next.length === 0) {
        next = [...FALLBACK_MODIFIERS]
        showNotice("At least one modifier key is required, so Alt was restored.")
      }
    }
    void persist({ ...settings, keyboard: next })
  }

  function changeOpenMode(value: string): void {
    if (!(OPEN_MODES as readonly string[]).includes(value)) return
    void persist({ ...settings, open: value as OpenMode })
  }

  function changeTheme(value: string): void {
    if (!(THEME_MODES as readonly string[]).includes(value)) return
    void persist({ ...settings, theme: value as ThemeMode })
  }

  function toggleAction(action: ClickAction, checked: boolean): void {
    let next: ClickAction[]
    if (checked) {
      next = settings.clickActions.includes(action)
        ? [...settings.clickActions]
        : [...settings.clickActions, action]
    } else {
      next = settings.clickActions.filter((item) => item !== action)
      if (next.length === 0) {
        next = [...DEFAULT_CLICK_ACTIONS]
        showNotice(
          "At least one click action is required, so the default actions were restored.",
        )
      }
    }
    void persist({ ...settings, clickActions: next })
  }

  async function resetAllSettings(): Promise<void> {
    setResetPending(false)
    const defaults = createDefaultSettings()
    const ok = await persist(defaults)
    if (!ok) return
    setRows(
      Object.entries(defaults.projectRoots).map(([origin, root]) => createRow(origin, root)),
    )
    setTemplateDraft(defaults.editor.template)
    showNotice("All settings were reset to their defaults.")
  }

  return (
    <main className="page">
      <header className="page-header">
        <div className="page-header__brand">
          <h1 className="page-header__title">tab-to-components</h1>
          <p className="page-header__subtitle">
            Extension settings · v{version} · changes save automatically
          </p>
        </div>
        <div className="page-header__meta">
          <span
            className={`save-state save-state--${saveState}`}
            role="status"
            aria-live="polite"
          >
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Could not save"
                  : ""}
          </span>
        </div>
      </header>

      {notice !== null && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {/* ------------------------------------------------------------ activation */}
      <section className="card" aria-labelledby="activation-title">
        <h2 className="card__title" id="activation-title">
          Activation
        </h2>
        <p className="card__description">
          The content script only runs on <code>localhost</code> and{" "}
          <code>127.0.0.1</code> pages, so these settings never affect normal browsing.
        </p>

        <fieldset className="group">
          <legend className="group__title">Modifier keys</legend>
          <p className="group__hint">
            All checked modifiers must be held together. Keep one checked for the
            simplest setup.
          </p>
          <div className="check-grid">
            {MODIFIER_KEYS.map((key) => (
              <label key={key} className="check">
                <input
                  type="checkbox"
                  checked={settings.keyboard.includes(key)}
                  disabled={!loaded}
                  onChange={(event) => {
                    toggleModifier(key, event.target.checked)
                  }}
                />
                <span className="check__text">
                  <span className="check__label">{MODIFIER_LABELS[key]}</span>
                  <span className="check__detail">{MODIFIER_DETAILS[key]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label className="field__label" htmlFor="ttc-open-mode">
            Modifier + left click
          </label>
          <select
            id="ttc-open-mode"
            value={settings.open}
            disabled={!loaded}
            onChange={(event) => {
              changeOpenMode(event.target.value)
            }}
          >
            {OPEN_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {OPEN_MODE_INFO[mode].label}
              </option>
            ))}
          </select>
          <p className="field__detail">{OPEN_MODE_INFO[settings.open].detail}</p>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.menu}
            disabled={!loaded}
            onChange={(event) => {
              void persist({ ...settings, menu: event.target.checked })
            }}
          />
          <span className="check__text">
            <span className="check__label">Component chain on right click</span>
            <span className="check__detail">
              Modifier + right click opens the component chain picker.
            </span>
          </span>
        </label>
      </section>

      {/* --------------------------------------------------------------- actions */}
      <section className="card" aria-labelledby="actions-title">
        <h2 className="card__title" id="actions-title">
          Click actions
        </h2>
        <p className="card__description">
          Checked actions appear in the modifier + left-click picker, in the numbered
          order. Keep a single action checked to skip the picker and run it instantly.
        </p>
        <ul className="action-list">
          {CLICK_ACTIONS.map((action) => {
            const order = settings.clickActions.indexOf(action)
            const checked = order !== -1
            return (
              <li key={action} className="action-row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!loaded}
                    onChange={(event) => {
                      toggleAction(action, event.target.checked)
                    }}
                  />
                  <span className="check__text">
                    <span className="check__label">{ACTION_INFO[action].label}</span>
                    <span className="check__detail">{ACTION_INFO[action].detail}</span>
                  </span>
                </label>
                <span
                  className={`action-row__order${checked ? "" : " action-row__order--empty"}`}
                  aria-label={checked ? `Position ${order + 1}` : undefined}
                  aria-hidden={checked ? undefined : true}
                >
                  {checked ? order + 1 : ""}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      {/* ----------------------------------------------------------- appearance */}
      <section className="card" aria-labelledby="appearance-title">
        <h2 className="card__title" id="appearance-title">
          Appearance
        </h2>
        <div className="field">
          <label className="field__label" htmlFor="ttc-theme">
            Overlay theme
          </label>
          <select
            id="ttc-theme"
            value={settings.theme}
            disabled={!loaded}
            onChange={(event) => {
              changeTheme(event.target.value)
            }}
          >
            {THEME_MODES.map((theme) => (
              <option key={theme} value={theme}>
                {THEME_INFO[theme].label}
              </option>
            ))}
          </select>
          <p className="field__detail">{THEME_INFO[settings.theme].detail}</p>
        </div>
      </section>

      {/* --------------------------------------------------------------- editor */}
      <section className="card" aria-labelledby="editor-title">
        <h2 className="card__title" id="editor-title">
          Editor
        </h2>
        <p className="card__description">
          Editors open through the URL schemes they register with the operating system;
          the extension never runs local commands.
        </p>

        <div className="field">
          <label className="field__label" htmlFor="ttc-editor-preset">
            Editor preset
          </label>
          <select
            id="ttc-editor-preset"
            value={settings.editor.preset}
            disabled={!loaded}
            onChange={(event) => {
              changeEditorPreset(event.target.value)
            }}
          >
            {EDITOR_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          {presetHint !== null && <p className="field__detail">{presetHint}</p>}
          {presetTemplate !== null && (
            <p className="field__detail">
              URL template: <code>{presetTemplate}</code>
            </p>
          )}
          <p className="field__detail">
            Custom templates support the {PLACEHOLDER_TEXT} placeholders.
          </p>
        </div>

        {settings.editor.preset === "custom" && (
          <div className="field">
            <label className="field__label" htmlFor="ttc-editor-template">
              Custom URL template
            </label>
            <input
              id="ttc-editor-template"
              type="text"
              value={templateDraft}
              disabled={!loaded}
              spellCheck={false}
              placeholder={CUSTOM_TEMPLATE_SEED}
              aria-describedby="ttc-editor-template-help"
              onFocus={() => {
                templateFocusedRef.current = true
              }}
              onBlur={() => {
                templateFocusedRef.current = false
                commitTemplate()
              }}
              onChange={(event) => {
                setTemplateDraft(event.target.value)
              }}
            />
            <p className="field__detail" id="ttc-editor-template-help">
              Supported placeholders: {PLACEHOLDER_TEXT}. An empty template falls back
              to the VS Code preset.
            </p>
            {templateDraft.trim() === "" && (
              <p className="field__error">
                A custom template cannot be empty, so the VS Code preset will be used.
              </p>
            )}
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- project roots */}
      <section className="card" aria-labelledby="roots-title">
        <h2 className="card__title" id="roots-title">
          Project roots
        </h2>
        <p className="card__description">
          Map an origin to the absolute path of the project on this machine. Used when
          a source location only has a project-relative path.
        </p>

        <div className="root-list">
          {rows.length === 0 && (
            <p className="field__detail">
              No project roots yet. Add one when an editor template needs{" "}
              <code>{"{path}"}</code> or <code>{"{fileUri}"}</code>.
            </p>
          )}
          {rows.map((row) => (
            <div
              key={row.key}
              className="root-row"
              onBlur={handleRootRowBlur}
            >
              <div className="field">
                <label className="field__label" htmlFor={`root-origin-${row.key}`}>
                  Origin
                </label>
                <input
                  id={`root-origin-${row.key}`}
                  type="text"
                  value={row.origin}
                  disabled={!loaded}
                  spellCheck={false}
                  placeholder="localhost:5173"
                  aria-invalid={row.originError !== null}
                  aria-describedby={
                    row.originError !== null
                      ? `root-origin-error-${row.key}`
                      : undefined
                  }
                  onChange={(event) => {
                    updateRootRow(row.key, { origin: event.target.value })
                  }}
                />
                {row.originError !== null && (
                  <p className="field__error" id={`root-origin-error-${row.key}`}>
                    {row.originError}
                  </p>
                )}
              </div>

              <div className="field">
                <label className="field__label" htmlFor={`root-path-${row.key}`}>
                  Absolute project path
                </label>
                <input
                  id={`root-path-${row.key}`}
                  type="text"
                  value={row.root}
                  disabled={!loaded}
                  spellCheck={false}
                  placeholder="D:/projects/my-app"
                  aria-invalid={row.rootError !== null}
                  aria-describedby={
                    row.rootError !== null ? `root-path-error-${row.key}` : undefined
                  }
                  onChange={(event) => {
                    updateRootRow(row.key, { root: event.target.value })
                  }}
                />
                {row.rootError !== null && (
                  <p className="field__error" id={`root-path-error-${row.key}`}>
                    {row.rootError}
                  </p>
                )}
              </div>

              <button
                type="button"
                className="btn btn--small root-row__remove"
                disabled={!loaded}
                aria-label="Remove project root"
                onClick={() => {
                  removeRootRow(row.key)
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="actions-row">
          <button
            type="button"
            className="btn"
            disabled={!loaded}
            onClick={addRootRow}
          >
            Add root
          </button>
          <p className="field__detail">
            Rows save when you leave them. Invalid origins or paths are highlighted and
            not stored.
          </p>
        </div>
      </section>

      {/* -------------------------------------------------------------- advanced */}
      <section className="card" aria-labelledby="advanced-title">
        <h2 className="card__title" id="advanced-title">
          Advanced
        </h2>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.showWhenVitePluginActive}
            disabled={!loaded}
            onChange={(event) => {
              void persist({
                ...settings,
                showWhenVitePluginActive: event.target.checked,
              })
            }}
          />
          <span className="check__text">
            <span className="check__label">Run alongside the Vite plugin overlay</span>
            <span className="check__detail">
              Keep the inspector active even when the Vite plugin's own overlay is on
              the page. Off by default so the two overlays never fight.
            </span>
          </span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.debug}
            disabled={!loaded}
            onChange={(event) => {
              void persist({ ...settings, debug: event.target.checked })
            }}
          />
          <span className="check__text">
            <span className="check__label">Verbose console logging</span>
            <span className="check__detail">
              Log inspector decisions to the page console for troubleshooting.
            </span>
          </span>
        </label>

        <div className="actions-row">
          {resetPending ? (
            <div className="reset-confirm">
              <p>
                Reset every setting to its defaults? Project roots and the custom editor
                template will be lost.
              </p>
              <button
                type="button"
                className="btn btn--danger btn--small"
                onClick={() => {
                  void resetAllSettings()
                }}
              >
                Yes, reset
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => {
                  setResetPending(false)
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={!loaded}
              onClick={() => {
                setResetPending(true)
              }}
            >
              Reset to defaults
            </button>
          )}
        </div>
      </section>

      {/* ----------------------------------------------------------------- about */}
      <section className="card" aria-labelledby="about-title">
        <h2 className="card__title" id="about-title">
          About
        </h2>
        <p className="card__description">
          tab-to-components opens the JSX source behind any React element on a local dev
          server — no Vite plugin required.
        </p>
        <ul className="about-list">
          <li>
            Works without the Vite plugin: the inspector reads React's development
            source metadata and Vite's dev-server source maps directly.
          </li>
          <li>
            React 19 only exposes source locations when the dev server serves source
            maps. Without them the overlay can detect React but cannot resolve a file.
          </li>
          <li>
            Editors open through their registered URL schemes (<code>vscode://</code>,{" "}
            <code>cursor://</code>, <code>zed://</code>, …); the extension never runs
            local commands.
          </li>
        </ul>
        <p className="field__detail">
          Hold {MODIFIER_LABELS[settings.keyboard[0] ?? "alt"]} and click an element on
          a localhost dev server to start.
        </p>
        <p className="field__detail">
          Version {version} ·{" "}
          <a
            href="https://github.com/r48n34/tab-to-components"
            target="_blank"
            rel="noreferrer"
          >
            Project on GitHub
          </a>
        </p>
      </section>

      <footer className="page-footer">
        tab-to-components · settings stored in <code>chrome.storage.local</code>
      </footer>
    </main>
  )
}

export default Options
