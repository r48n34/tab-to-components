/**
 * Local dev-server origins.
 *
 * The extension is deliberately narrow: content scripts are only declared for
 * loopback hosts, so a normal browsing session never loads the inspector.
 * Match patterns ignore ports, so `http://localhost/*` covers every dev-server
 * port. `world: "MAIN"` content scripts (the agent) need Chrome 111+.
 */

/** Every host/port the extension activates on (http and https). */
export const LOCAL_DEV_MATCHES: readonly string[] = [
  "http://localhost/*",
  "https://localhost/*",
  "http://127.0.0.1/*",
  "https://127.0.0.1/*",
  "http://[::1]/*",
  "https://[::1]/*",
];

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** `new URL(url).origin`, or `null` for non-http(s) or malformed URLs. */
export function originOf(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url === "") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Whether an origin (or any http(s) URL) points at a loopback dev server. */
export function isLocalDevOrigin(origin: string | null | undefined): boolean {
  if (typeof origin !== "string" || origin === "") return false;
  try {
    const parsed = new URL(origin.includes("://") ? origin : `http://${origin}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return LOCAL_HOSTNAMES.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function isLocalDevUrl(url: string | null | undefined): boolean {
  const origin = originOf(url);
  return origin !== null && isLocalDevOrigin(origin);
}

/**
 * Normalise a user-entered origin: trim, add a scheme when missing, strip
 * paths/ports kept as-is. Returns `null` for invalid or non-http(s) input.
 */
export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const withScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return originOf(withScheme);
}
