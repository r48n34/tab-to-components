/**
 * React bridge between `chrome.storage` and the extension pages.
 *
 * The store (lib/settings.ts) owns normalization and storage I/O; this hook
 * keeps one subscription per page and exposes an optimistic `save()` so the UI
 * reacts immediately while the write is in flight.
 */

import { useCallback, useEffect, useState } from "react"

import {
  createChromeSettingsStore,
  createDefaultSettings,
  normalizeSettings,
  type Settings,
  type SettingsStore,
} from "../settings"

export interface UseSettingsResult {
  /** Always a fully normalized Settings object (defaults until loaded). */
  settings: Settings
  /** Persist a change; local state updates optimistically before the write. */
  save: (next: Settings) => Promise<void>
  /** False until the first `chrome.storage.local` read has completed. */
  loaded: boolean
}

/**
 * Load settings once, then follow every change (including writes from the
 * popup, options page, content scripts or another window).
 */
export function useSettings(): UseSettingsResult {
  const [store] = useState<SettingsStore>(() => createChromeSettingsStore())
  const [settings, setSettings] = useState<Settings>(() => createDefaultSettings())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    const unsubscribe = store.watch((next) => {
      if (active) setSettings(next)
    })

    store
      .load()
      .then((stored) => {
        if (!active) return
        setSettings(stored)
        setLoaded(true)
      })
      .catch(() => {
        // Storage can be unavailable (e.g. tests or a broken profile). Keep
        // usable defaults rather than leaving the page stuck on "loading".
        if (active) setLoaded(true)
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [store])

  const save = useCallback(
    async (next: Settings) => {
      const normalized = normalizeSettings(next)
      setSettings(normalized)
      await store.save(normalized)
    },
    [store],
  )

  return { settings, save, loaded }
}
