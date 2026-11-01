/**
 * Options page: the full settings surface.
 *
 * Every change is written through `useSettings` (normalized + chrome.storage),
 * so there is no save button: selects and checkboxes save immediately, text
 * fields debounce or commit on blur, and a small header badge confirms writes.
 *
 * The page is split into a sticky section nav and three groups of cards:
 * how the shortcut behaves, tools it talks to, and advanced/about. Numbered
 * cards follow the order a new user would read them in.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
} from "react"

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
    label: "Component",
    detail: "Open the nearest component's JSX usage site (default).",
  },
  element: {
    label: "Element",
    detail: "Open the clicked DOM element's own JSX site.",
  },
  menu: {
    label: "Chain picker",
    detail: "Open the component chain picker on left click.",
  },
}

const THEME_INFO: Record<ThemeMode, { label: string; detail: string }> = {
  dark: {
    label: "Dark",
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
    detail: "Open the source in your IDE through the Vite plugin.",
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
  const normalized = normalizeSlashes(value.trim())
  let end = normalized.length
  while (end > 0 && normalized[end - 1] === "/") end -= 1
  return normalized.slice(0, end)
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

const SECTIONS = [
  {
    group: "How it behaves",
    links: [
      { id: "activation", label: "Shortcut & activation" },
      { id: "actions", label: "Click actions" },
      { id: "appearance", label: "Appearance" },
    ],
  },
  {
    group: "Connected tools",
    links: [
      { id: "plugin", label: "Vite plugin" },
      { id: "roots", label: "Project roots" },
    ],
  },
  {
    group: "More",
    links: [
      { id: "advanced", label: "Advanced" },
      { id: "about", label: "About" },
    ],
  },
] as const

function Options() {
  const { settings, save, loaded } = useSettings()

  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [notice, setNotice] = useState<string | null>(null)
  const [rows, setRows] = useState<RootRow[]>([])
  const [rowsLoaded, setRowsLoaded] = useState(false)
  const [resetPending, setResetPending] = useState(false)
  const [activeSection, setActiveSection] = useState<string>("activation")

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowKeyRef = useRef(0)
  const rowsRef = useRef<RootRow[]>(rows)
  rowsRef.current = rows

  const version = extensionVersion()

  // Keep the section index in sync with the card the reader is looking at.
  useEffect(() => {
    const ids = SECTIONS.flatMap((group) => group.links.map((link) => link.id))
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    if (elements.length === 0 || typeof IntersectionObserver === "undefined") return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const first = visible[0]
        if (first !== undefined) setActiveSection(first.target.id)
      },
      { rootMargin: "-104px 0px -55% 0px", threshold: 0 },
    )
    for (const element of elements) observer.observe(element)
    return () => observer.disconnect()
  }, [])

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

  function changeSettingsSource(value: string): void {
    if (value !== "plugin" && value !== "extension") return
    void persist({ ...settings, settingsSource: value })
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

  /** Move a checked action one step earlier/later in the picker. */
  function moveAction(action: ClickAction, direction: -1 | 1): void {
    const current = settings.clickActions
    const from = current.indexOf(action)
    const to = from + direction
    if (from === -1 || to < 0 || to >= current.length) return
    const target = current[to]
    if (target === undefined) return
    const next = [...current]
    next[from] = target
    next[to] = action
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
    showNotice("All settings were reset to their defaults.")
  }

  const modifiers =
    settings.keyboard.length > 0
      ? settings.keyboard.map((key) => MODIFIER_LABELS[key]).join(" + ")
      : "Alt"

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="topbar__brand">
            <span className="brand-mark" aria-hidden="true">
              ttc
            </span>
            <div className="topbar__text">
              <h1 className="topbar__title">tab-to-components</h1>
              <p className="topbar__subtitle">
                Browser extension settings
                <span className="topbar__dot" aria-hidden="true">
                  ·
                </span>
                v{version}
              </p>
            </div>
          </div>
          <div className="topbar__meta">
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
                    : "Changes save automatically"}
            </span>
          </div>
        </div>
      </header>

      <main className="page">
        <aside className="sidebar">
          <nav className="toc" aria-label="Settings sections">
            {SECTIONS.map((section) => (
              <div className="toc__group" key={section.group}>
                <p className="toc__label">{section.group}</p>
                <ul className="toc__list">
                  {section.links.map((link) => (
                    <li key={link.id}>
                      <a
                        className="toc__link"
                        href={`#${link.id}`}
                        aria-current={link.id === activeSection ? "true" : undefined}
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <p className="sidebar__note">
            The extension only runs on <code>localhost</code> and{" "}
            <code>127.0.0.1</code> pages.
          </p>
        </aside>

        <div className="content">
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero__text">
              <p className="hero__eyebrow">Quick start</p>
              <h2 className="hero__title" id="hero-title">
                Hold <kbd className="kbd">{modifiers}</kbd> and click any element
              </h2>
              <p className="hero__detail">
                A small outline and label appear under the cursor; the click opens or
                copies that element&apos;s JSX source.
              </p>
            </div>
            <ol className="steps">
              <li className="steps__item">
                <span className="steps__index" aria-hidden="true">
                  1
                </span>
                <span className="steps__text">
                  <strong>Hold the modifier</strong> while hovering an element on a
                  localhost dev server.
                </span>
              </li>
              <li className="steps__item">
                <span className="steps__index" aria-hidden="true">
                  2
                </span>
                <span className="steps__text">
                  <strong>Click it.</strong> The configured action runs — open the
                  source, or show the action picker first.
                </span>
              </li>
              <li className="steps__item">
                <span className="steps__index" aria-hidden="true">
                  3
                </span>
                <span className="steps__text">
                  <strong>Right click</strong> with the modifier to browse the whole
                  component chain.
                </span>
              </li>
            </ol>
          </section>

          {/* ------------------------------------------------------- activation */}
          <section className="card" id="activation" aria-labelledby="activation-title">
            <header className="card__head">
              <span className="card__badge" aria-hidden="true">
                1
              </span>
              <div>
                <h2 className="card__title" id="activation-title">
                  Shortcut &amp; activation
                </h2>
                <p className="card__description">
                  Choose the keys that arm the inspector and what a left click does.
                </p>
              </div>
            </header>

            <fieldset className="group">
              <legend className="group__title">Modifier keys</legend>
              <p className="group__hint">
                Every checked key must be held together. Keep one checked for the
                simplest setup.
              </p>
              <div className="chip-grid">
                {MODIFIER_KEYS.map((key) => (
                  <label className="chip" key={key}>
                    <input
                      type="checkbox"
                      className="chip__input"
                      checked={settings.keyboard.includes(key)}
                      disabled={!loaded}
                      onChange={(event) => {
                        toggleModifier(key, event.target.checked)
                      }}
                    />
                    <span className="chip__check" aria-hidden="true" />
                    <span className="chip__body">
                      <span className="chip__label">{MODIFIER_LABELS[key]}</span>
                      <span className="chip__detail">{MODIFIER_DETAILS[key]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="group">
              <legend className="group__title">What {modifiers} + click opens</legend>
              <div className="option-grid">
                {OPEN_MODES.map((mode) => (
                  <label className="option-card" key={mode}>
                    <input
                      type="radio"
                      className="option-card__input"
                      name="open-mode"
                      value={mode}
                      checked={settings.open === mode}
                      disabled={!loaded}
                      onChange={(event) => {
                        changeOpenMode(event.target.value)
                      }}
                    />
                    <span className="option-card__dot" aria-hidden="true" />
                    <span className="option-card__body">
                      <span className="option-card__title">{OPEN_MODE_INFO[mode].label}</span>
                      <span className="option-card__detail">
                        {OPEN_MODE_INFO[mode].detail}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="switch-row">
              <span className="switch-row__text">
                <span className="switch-row__label">
                  Component chain on modifier + right click
                </span>
                <span className="switch-row__detail">
                  Opens the component chain picker so you can jump to any ancestor.
                </span>
              </span>
              <input
                type="checkbox"
                className="switch"
                role="switch"
                checked={settings.menu}
                disabled={!loaded}
                onChange={(event) => {
                  void persist({ ...settings, menu: event.target.checked })
                }}
              />
            </label>
          </section>

          {/* ---------------------------------------------------------- actions */}
          <section className="card" id="actions" aria-labelledby="actions-title">
            <header className="card__head">
              <span className="card__badge" aria-hidden="true">
                2
              </span>
              <div>
                <h2 className="card__title" id="actions-title">
                  Click actions
                </h2>
                <p className="card__description">
                  Checked actions appear in the picker in the numbered order. Keep a
                  single action checked to run it instantly and skip the picker.
                </p>
              </div>
            </header>

            <ul className="action-list">
              {CLICK_ACTIONS.map((action) => {
                const order = settings.clickActions.indexOf(action)
                const checked = order !== -1
                return (
                  <li
                    key={action}
                    className={checked ? "action-row action-row--on" : "action-row"}
                  >
                    <label className="check action-row__check">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!loaded}
                        onChange={(event) => {
                          toggleAction(action, event.target.checked)
                        }}
                      />
                      <span
                        className={
                          checked ? "action-row__order" : "action-row__order action-row__order--empty"
                        }
                        aria-hidden="true"
                      >
                        {checked ? order + 1 : ""}
                      </span>
                      <span className="check__text">
                        <span className="check__label">{ACTION_INFO[action].label}</span>
                        <span className="check__detail">
                          {ACTION_INFO[action].detail}
                        </span>
                      </span>
                    </label>

                    <div className="action-row__move">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Move ${ACTION_INFO[action].label} earlier`}
                        disabled={!loaded || !checked || order <= 0}
                        onClick={() => {
                          moveAction(action, -1)
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Move ${ACTION_INFO[action].label} later`}
                        disabled={
                          !loaded || !checked || order === settings.clickActions.length - 1
                        }
                        onClick={() => {
                          moveAction(action, 1)
                        }}
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="field__detail">
              “Open in IDE” is hidden automatically when the page does not run the Vite
              plugin.
            </p>
          </section>

          {/* ------------------------------------------------------- appearance */}
          <section className="card" id="appearance" aria-labelledby="appearance-title">
            <header className="card__head">
              <span className="card__badge" aria-hidden="true">
                3
              </span>
              <div>
                <h2 className="card__title" id="appearance-title">
                  Appearance
                </h2>
                <p className="card__description">
                  The overlay theme is shared by the outline, label and action menu.
                </p>
              </div>
            </header>

            <fieldset className="group">
              <legend className="group__title">Overlay theme</legend>
              <div className="option-grid option-grid--two">
                {THEME_MODES.map((theme) => (
                  <label className="option-card" key={theme}>
                    <input
                      type="radio"
                      className="option-card__input"
                      name="theme"
                      value={theme}
                      checked={settings.theme === theme}
                      disabled={!loaded}
                      onChange={(event) => {
                        changeTheme(event.target.value)
                      }}
                    />
                    <span
                      className={`theme-swatch theme-swatch--${theme}`}
                      aria-hidden="true"
                    />
                    <span className="option-card__body">
                      <span className="option-card__title">{THEME_INFO[theme].label}</span>
                      <span className="option-card__detail">
                        {THEME_INFO[theme].detail}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          {/* ------------------------------------------------------------ plugin */}
          <section className="card" id="plugin" aria-labelledby="plugin-title">
            <header className="card__head">
              <span className="card__badge" aria-hidden="true">
                4
              </span>
              <div>
                <h2 className="card__title" id="plugin-title">
                  Vite plugin
                </h2>
                <p className="card__description">
                  When the page also runs the tab-to-components Vite plugin, choose whose
                  settings win.
                </p>
              </div>
            </header>

            <fieldset className="group">
              <legend className="group__title">When both are installed</legend>
              <div className="option-grid option-grid--two">
                <label className="option-card">
                  <input
                    type="radio"
                    className="option-card__input"
                    name="settings-source"
                    value="plugin"
                    checked={settings.settingsSource === "plugin"}
                    disabled={!loaded}
                    onChange={(event) => {
                      changeSettingsSource(event.target.value)
                    }}
                  />
                  <span className="option-card__dot" aria-hidden="true" />
                  <span className="option-card__body">
                    <span className="option-card__title">Use the plugin settings</span>
                    <span className="option-card__detail">
                      Keyboard, open mode, click actions and theme follow the plugin;
                      the extension stays idle while the plugin&apos;s overlay is on the
                      page.
                    </span>
                  </span>
                </label>

                <label className="option-card">
                  <input
                    type="radio"
                    className="option-card__input"
                    name="settings-source"
                    value="extension"
                    checked={settings.settingsSource === "extension"}
                    disabled={!loaded}
                    onChange={(event) => {
                      changeSettingsSource(event.target.value)
                    }}
                  />
                  <span className="option-card__dot" aria-hidden="true" />
                  <span className="option-card__body">
                    <span className="option-card__title">Use the extension settings</span>
                    <span className="option-card__detail">
                      The extension takes over with these settings and hides the
                      plugin&apos;s overlay. “Open in IDE” still goes through the plugin.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            <div className="callout">
              <p className="callout__title">How “Open in IDE” works</p>
              <p className="callout__text">
                The extension asks the dev server to open the file; the plugin chooses
                the editor (<code>editor</code> option, <code>auto</code> by default).
                Without the plugin the action is hidden, but source resolution and copy
                actions keep working. The popup shows whether the plugin is connected
                and repeats this choice for quick access.
              </p>
            </div>
          </section>

          {/* ----------------------------------------------------- project roots */}
          <section className="card" id="roots" aria-labelledby="roots-title">
            <header className="card__head">
              <span className="card__badge" aria-hidden="true">
                5
              </span>
              <div>
                <h2 className="card__title" id="roots-title">
                  Project roots
                </h2>
                <p className="card__description">
                  Map an origin to the absolute path of the project on this machine,
                  used when a source location only has a project-relative path.
                </p>
              </div>
            </header>

            <div className="root-list">
              {rows.length === 0 && (
                <div className="empty-state">
                  <p className="empty-state__title">No project roots yet</p>
                  <p className="empty-state__text">
                    Add one when “Copy full path” needs an absolute path for a
                    project-relative source location, for example{" "}
                    <code>localhost:5173</code> → <code>D:/projects/my-app</code>.
                  </p>
                </div>
              )}
              {rows.map((row) => (
                <div key={row.key} className="root-row" onBlur={handleRootRowBlur}>
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
                    className="icon-btn root-row__remove"
                    disabled={!loaded}
                    aria-label="Remove project root"
                    title="Remove project root"
                    onClick={() => {
                      removeRootRow(row.key)
                    }}
                  >
                    ✕
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
                + Add project root
              </button>
              <p className="field__detail">
                Rows save when you leave them. Invalid origins or paths are highlighted
                and not stored.
              </p>
            </div>
          </section>

          {/* -------------------------------------------------------- advanced */}
          <section className="card" id="advanced" aria-labelledby="advanced-title">
            <header className="card__head">
              <div>
                <h2 className="card__title" id="advanced-title">
                  Advanced
                </h2>
                <p className="card__description">
                  Diagnostics and a clean slate. Settings are stored in{" "}
                  <code>chrome.storage.local</code>.
                </p>
              </div>
            </header>

            <label className="switch-row">
              <span className="switch-row__text">
                <span className="switch-row__label">Verbose console logging</span>
                <span className="switch-row__detail">
                  Log inspector decisions to the page console for troubleshooting.
                </span>
              </span>
              <input
                type="checkbox"
                className="switch"
                role="switch"
                checked={settings.debug}
                disabled={!loaded}
                onChange={(event) => {
                  void persist({ ...settings, debug: event.target.checked })
                }}
              />
            </label>

            <div className="danger-zone">
              <div className="danger-zone__text">
                <p className="danger-zone__title">Reset everything</p>
                <p className="danger-zone__detail">
                  Restores the default shortcut, actions, theme, plugin choice and
                  removes all project roots.
                </p>
              </div>
              {resetPending ? (
                <div className="reset-confirm">
                  <p>Reset every setting to its defaults? Project roots will be lost.</p>
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
                  className="btn btn--danger-ghost btn--small"
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

          {/* ------------------------------------------------------------- about */}
          <section className="card" id="about" aria-labelledby="about-title">
            <header className="card__head">
              <div>
                <h2 className="card__title" id="about-title">
                  About
                </h2>
                <p className="card__description">
                  tab-to-components resolves the JSX source behind any React element on
                  a local dev server.
                </p>
              </div>
            </header>

            <ul className="about-list">
              <li>
                “Open in IDE” is delegated to the Vite plugin&apos;s dev-server
                endpoint, so the editor always launches on the machine running the dev
                server.
              </li>
              <li>
                Copy actions work without the plugin: the inspector reads React&apos;s
                development source metadata and Vite&apos;s dev-server source maps
                directly.
              </li>
              <li>
                React 19 only exposes source locations when the dev server serves
                source maps. Without them the overlay can detect React but cannot
                resolve a file.
              </li>
            </ul>

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
            Hold {modifiers} and click an element on a localhost dev server to start.
          </footer>
        </div>
      </main>

      {notice !== null && (
        <p className="toast" role="status" aria-live="polite">
          {notice}
        </p>
      )}
    </div>
  )
}

export default Options
