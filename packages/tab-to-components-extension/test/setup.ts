/**
 * Shared Vitest setup.
 *
 * Chrome extension APIs are stubbed globally so the inspector modules can be
 * imported in plain Node/happy-dom tests. Individual tests replace the stubs
 * they need.
 */
import { vi } from "vitest";

interface ChromeStub {
  runtime: {
    id: string;
    getManifest: () => { version: string };
    getURL: (path: string) => string;
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
    onInstalled: { addListener: ReturnType<typeof vi.fn> };
    lastError?: { message?: string };
    openOptionsPage: ReturnType<typeof vi.fn>;
  };
  storage: {
    local: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
    onChanged: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  tabs: {
    create: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
}

const listeners = {
  message: [] as Array<(...args: unknown[]) => unknown>,
  changed: [] as Array<(...args: unknown[]) => unknown>,
  installed: [] as Array<(...args: unknown[]) => unknown>,
};

const storage = new Map<string, unknown>();

const chromeStub: ChromeStub = {
  runtime: {
    id: "test-extension-id",
    getManifest: () => ({ version: "0.1.0" }),
    getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
    sendMessage: vi.fn(() => Promise.resolve(undefined)),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onInstalled: { addListener: vi.fn() },
    openOptionsPage: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn(async (keys?: string | string[] | null) => {
        if (typeof keys === "string") {
          return storage.has(keys) ? { [keys]: storage.get(keys) } : {};
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const key of keys) if (storage.has(key)) result[key] = storage.get(key);
          return result;
        }
        return Object.fromEntries(storage);
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) storage.set(key, value);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) storage.delete(key);
      }),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    create: vi.fn(async () => ({ id: 1 })),
    query: vi.fn(async () => []),
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeStub;

export { chromeStub, listeners, storage };
