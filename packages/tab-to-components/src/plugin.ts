import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { normalizePath, resolveModuleId, isClientEntryModule } from "./paths.js";
import { transformSource } from "./transform.js";
import type { CreateFilterOptions } from "./paths.js";
import {
  CLIENT_RESOLVED_ID,
  CLIENT_VIRTUAL_ID,
  buildClientModule,
} from "./virtual.js";
import {
  CUSTOM_EDITOR_ENDPOINT,
  IDE_IDS,
  createEditorLauncher,
  editorTargetExists,
  ideOfClickAction,
  isIdeId,
  parseEditorFilePath,
  parseEditorTarget,
  type IdeId,
} from "./editor.js";
import { VERSION } from "./version.js";
import {
  CUSTOM_ACTION_ICONS,
  DEFAULT_CLICK_ACTIONS,
  type TabToComponentsActionIcon,
  type TabToComponentsCustomAction,
  type TabToComponentsOptions,
  type ClientConfig,
  type EditorLauncher,
  type EditorOption,
  type InspectorKey,
  type TabToComponentsClickAction,
  type TabToComponentsOpenMode,
  type TabToComponentsTheme,
  type ResolvedOptions,
} from "./types.js";

const VALID_KEYS: InspectorKey[] = ["alt", "ctrl", "meta", "shift"];
const VALID_OPEN_MODES: TabToComponentsOpenMode[] = [
  "component",
  "element",
  "menu",
];
const VALID_THEMES: TabToComponentsTheme[] = ["dark", "light"];
const VALID_CLICK_ACTIONS: TabToComponentsClickAction[] = [
  "open",
  "open-code",
  "open-cursor",
  "open-webstorm",
  "open-trae",
  "copy-file",
  "copy-path",
  "copy-full-path",
  "copy-location",
  "copy-ai-context",
  "copy-mention",
  "copy-markdown",
  "copy-chain",
];

/** Upper bounds for custom action validation (the config reaches the browser). */
const MAX_CUSTOM_ACTIONS = 12;
const MAX_CUSTOM_ACTION_ID = 40;
const MAX_CUSTOM_ACTION_LABEL = 80;
const MAX_CUSTOM_ACTION_COPY = 600;
const CUSTOM_ACTION_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function isActionIcon(value: unknown): value is TabToComponentsActionIcon {
  return (
    typeof value === "string" &&
    (CUSTOM_ACTION_ICONS as readonly string[]).includes(value)
  );
}

/**
 * Keep the declarative custom actions that can safely reach the browser: plain
 * strings only (the client config is JSON-serialized), unique ids, bounded
 * lengths. Invalid entries are dropped like other invalid option values.
 */
function resolveCustomActions(
  input: readonly TabToComponentsCustomAction[] | undefined,
): TabToComponentsCustomAction[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const actions: TabToComponentsCustomAction[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const copy = typeof record.copy === "string" ? record.copy : "";
    if (id === "" || id.length > MAX_CUSTOM_ACTION_ID) continue;
    if (!CUSTOM_ACTION_ID_RE.test(id) || seen.has(id)) continue;
    if (label === "" || label.length > MAX_CUSTOM_ACTION_LABEL) continue;
    if (copy.trim() === "" || copy.length > MAX_CUSTOM_ACTION_COPY) continue;
    seen.add(id);
    const icon = isActionIcon(record.icon) ? record.icon : undefined;
    actions.push(icon === undefined ? { id, label, copy } : { id, label, copy, icon });
    if (actions.length >= MAX_CUSTOM_ACTIONS) break;
  }
  return actions;
}

/** IDE opened when the user does not pass `editor`. */
export const DEFAULT_EDITOR = "code";

/** `editor: "auto"` delegates to Vite's `/__open-in-editor` (launch-editor). */
export const AUTO_EDITOR = "auto";

function resolveOptions(options: TabToComponentsOptions): ResolvedOptions {
  const keys = [
    ...new Set(
      (Array.isArray(options.keyboard)
        ? options.keyboard
        : [options.keyboard ?? "alt"]
      ).filter((key): key is InspectorKey =>
        VALID_KEYS.includes(key as InspectorKey),
      ),
    ),
  ];
  const open = VALID_OPEN_MODES.includes(
    options.open as TabToComponentsOpenMode,
  )
    ? (options.open as TabToComponentsOpenMode)
    : "component";
  const requestedActions = Array.isArray(options.clickActions)
    ? options.clickActions
    : options.clickActions === undefined
      ? DEFAULT_CLICK_ACTIONS
      : [options.clickActions];
  const clickActions = [
    ...new Set(
      requestedActions.filter((action): action is TabToComponentsClickAction =>
        VALID_CLICK_ACTIONS.includes(action as TabToComponentsClickAction),
      ),
    ),
  ];
  const include = options.include
    ? Array.isArray(options.include)
      ? options.include
      : [options.include]
    : [];
  const exclude = options.exclude
    ? Array.isArray(options.exclude)
      ? options.exclude
      : [options.exclude]
    : [];

  return {
    keyboard: keys.length > 0 ? keys : ["alt"],
    open,
    clickActions:
      clickActions.length > 0 ? clickActions : [...DEFAULT_CLICK_ACTIONS],
    customActions: resolveCustomActions(options.customActions),
    menu: options.menu !== false,
    theme: VALID_THEMES.includes(options.theme as TabToComponentsTheme)
      ? (options.theme as TabToComponentsTheme)
      : "dark",
    overlay: options.overlay ?? "all",
    ssr: options.ssr !== false,
    include,
    exclude,
    editor: options.editor ?? DEFAULT_EDITOR,
    editorExplicit: options.editor !== undefined,
    ...(options.editorEndpoint !== undefined
      ? { editorEndpoint: options.editorEndpoint }
      : {}),
    log: options.log !== false,
  };
}

function describeEditor(editor: EditorOption): string {
  if (typeof editor === "string") return editor;
  if (typeof editor === "function") return "custom launcher";
  const args = editor.args?.join(" ") ?? "";
  return args ? `${editor.command} ${args}` : editor.command;
}

type PluginContextWithEnvironment = {
  environment?: { name?: string };
  error?: (message: string) => never;
};

/**
 * `@vitejs/plugin-react` (and similar) also use `enforce: "pre"` and compile
 * JSX before we see it. The transform then falls back to injecting markers into
 * the compiled `jsxDEV(...)` calls, so plugin order does not matter — but the
 * fallback needs the compiler to keep the JSX source object, which Babel and
 * esbuild do in development.
 */
const COMPILED_JSX_RE = /\b(?:jsxDEV|jsxs?|createElement)\s*\(/;

type RequestHeaders = Record<string, string | string[] | undefined>;

function headerValue(
  headers: RequestHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Reject a request that a browser reports as coming from another origin.
 * The endpoint launches a process, so a hostile page must not be able to
 * trigger it with an `<img>`, a form, or a `no-cors` fetch. Requests without
 * either header (CLI tools, older browsers, tests) are allowed: they cannot
 * be distinguished, and the remaining local-only guard is the endpoint URL.
 */
function crossOriginRejection(
  headers: RequestHeaders,
  configuredOrigin: string | undefined,
): string | undefined {
  const secFetchSite = headerValue(headers, "sec-fetch-site");
  if (
    secFetchSite !== undefined &&
    secFetchSite !== "same-origin" &&
    secFetchSite !== "none"
  ) {
    return "cross-origin request rejected";
  }

  const origin = headerValue(headers, "origin");
  if (origin === undefined || origin === "") return undefined;

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return "invalid Origin header";
  }
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    return "unsupported request origin";
  }

  const host = headerValue(headers, "host");
  if (host !== undefined && parsedOrigin.host === host) return undefined;
  if (configuredOrigin !== undefined) {
    try {
      if (parsedOrigin.origin === new URL(configuredOrigin).origin) {
        return undefined;
      }
    } catch {
      // Ignore an invalid configured origin and fall through to the rejection.
    }
  }
  return "cross-origin request rejected";
}

/**
 * Match an editor endpoint URL (with or without the Vite `base` prefix) and
 * return its query parameters, or `undefined` when the request is unrelated.
 */
function matchEditorEndpoint(
  rawUrl: string,
  endpoint: string,
  basePrefix: string,
): URLSearchParams | undefined {
  if (!rawUrl.startsWith("/")) return undefined;
  const queryIndex = rawUrl.indexOf("?");
  const rawPath = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const search = queryIndex === -1 ? "" : rawUrl.slice(queryIndex + 1);
  let pathname = rawPath;
  if (basePrefix && pathname.startsWith(basePrefix)) {
    pathname = pathname.slice(basePrefix.length);
  }
  if (pathname !== endpoint) return undefined;
  return new URLSearchParams(search);
}


/**
 * Alt+click to open components.
 *
 * Dev-only Vite plugin that annotates every JSX element with its original
 * source location and serves a tiny DOM overlay. Works with plain Vite, React
 * Router v6 (SPA), React Router v7/v8 framework mode (including SSR),
 * TanStack Start and Remix v2, on React 18 and React 19.
 *
 * By default the location is opened in VS Code (`code`); pass `editor` to use
 * Cursor, Trae, WebStorm, any other command, or `"auto"` for Vite's
 * launch-editor auto-detection.
 */
export function tabToComponents(
  options: TabToComponentsOptions = {},
): Plugin {
  const resolved = resolveOptions(options);
  const filter: CreateFilterOptions = {
    include: resolved.include,
    exclude: resolved.exclude,
  };

  let config: ResolvedConfig | undefined;
  let root = normalizePath(process.cwd());
  let base = "/";
  let warnedAboutMissingClient = false;
  let warnedAboutCompiledJsx = false;
  // `apply: "serve"` is the primary dev-only guard, but it is repeated here as
  // defense in depth: if a wrapper re-registers this plugin object for a build
  // (for example by removing `apply`), every hook below stays inert so no
  // marker, virtual module or browser runtime can reach a production artifact.
  let devServer = false;
  let warnedAboutBuild = false;

  // `editor: "auto"` opts out of the built-in launcher and delegates to Vite's
  // own /__open-in-editor endpoint (launch-editor: auto-detection +
  // LAUNCH_EDITOR). Every other value — including the default `code` — is
  // launched by the plugin itself through its own endpoint.
  const usesViteEditorEndpoint = resolved.editor === AUTO_EDITOR;
  const defaultEndpoint = usesViteEditorEndpoint
    ? "__open-in-editor"
    : CUSTOM_EDITOR_ENDPOINT;
  const editorEndpoint = (resolved.editorEndpoint ?? defaultEndpoint).replace(
    /^\/+/,
    "",
  );
  const editorLauncher: EditorLauncher | undefined = usesViteEditorEndpoint
    ? undefined
    : createEditorLauncher(resolved.editor, {
        onError: (message) => {
          config?.logger.warn(`  tab-to-components: ${message}`);
        },
      });

  // Per-IDE actions (`open-code`, …) launch a fixed IDE on the dev-server
  // machine, independently of `editor` — including when `editor: "auto"`
  // delegates the plain "open" row to Vite. Only the IDEs whose action is
  // configured are reachable through the endpoint, and their launchers are
  // strict: a missing command answers 500 instead of a false success.
  const configuredIdes = new Set<IdeId>();
  for (const action of resolved.clickActions) {
    const ide = ideOfClickAction(action);
    if (ide !== null) configuredIdes.add(ide);
  }
  const ideLaunchers = new Map<IdeId, EditorLauncher>();
  for (const ide of IDE_IDS) {
    if (!configuredIdes.has(ide)) continue;
    ideLaunchers.set(
      ide,
      createEditorLauncher(ide, {
        strict: true,
        onError: (message) => {
          config?.logger.warn(`  tab-to-components: ${message}`);
        },
      }),
    );
  }

  function clientConfig(): ClientConfig {
    const config: ClientConfig = {
      version: VERSION,
      root: root.replace(/\/+$/, "") || "/",
      base,
      keyboard: resolved.keyboard,
      open: resolved.open,
      clickActions: resolved.clickActions,
      menu: resolved.menu,
      theme: resolved.theme,
      editorEndpoint,
    };
    // Keep the injected prelude byte-identical for apps that do not use custom
    // actions (the integration suite asserts its exact shape); the browser
    // config falls back to an empty list.
    if (resolved.customActions.length > 0) {
      config.customActions = resolved.customActions;
    }
    return config;
  }

  const plugin: Plugin = {
    name: "tab-to-components",
    // Primary dev-only guard. Vite removes the plugin from `vite build` (and
    // from the build's child compilers) before any hook can run. The command
    // checks in the hooks below are defense in depth for wrappers that strip
    // `apply`; production output must stay clean even then.
    apply: "serve",
    enforce: "pre",

    configResolved(resolvedConfig) {
      // Normally unreachable: `apply: "serve"` keeps Vite from resolving this
      // plugin for a build. If the plugin was forced in anyway, stay inert
      // instead of throwing, so a production build still succeeds without any
      // dev-only output.
      if (resolvedConfig.command !== "serve") {
        if (!devServer && !warnedAboutBuild) {
          warnedAboutBuild = true;
          resolvedConfig.logger.warn(
            "\n  tab-to-components: this is a dev-only plugin and was ignored for this production build.",
          );
        }
        return;
      }

      // React Router framework mode creates a child Vite server that reuses
      // user plugins (with `configureServer` stripped). Both servers resolve
      // the same project root, so the first serve config is authoritative.
      if (config) return;
      config = resolvedConfig;
      devServer = true;
      root = normalizePath(resolvedConfig.root);
      base = resolvedConfig.base.endsWith("/")
        ? resolvedConfig.base
        : `${resolvedConfig.base}/`;
    },

    resolveId(id) {
      // The client runtime can only be resolved from a running dev server. A
      // production build that imports it fails to resolve instead of bundling
      // the overlay.
      if (!devServer) return null;
      if (id === CLIENT_VIRTUAL_ID) return CLIENT_RESOLVED_ID;
      return null;
    },

    load(id) {
      if (!devServer || id !== CLIENT_RESOLVED_ID) return null;
      try {
        return buildClientModule(clientConfig());
      } catch (error) {
        if (!warnedAboutMissingClient) {
          warnedAboutMissingClient = true;
          config?.logger.error((error as Error).message);
        }
        return "export {};";
      }
    },

    transform(code, id, transformOptions) {
      if (!devServer || !config) return null;

      const parts = resolveModuleId(id, root, filter);
      if (!parts) return null;

      const context = this as unknown as PluginContextWithEnvironment;
      const environmentName = context.environment?.name;
      const isClient =
        environmentName === undefined
          ? !transformOptions?.ssr
          : environmentName === "client";

      const marker = resolved.ssr || isClient;
      const overlayImport =
        resolved.overlay !== false &&
        isClient &&
        (resolved.overlay === "all" || isClientEntryModule(parts.rel))
          ? CLIENT_VIRTUAL_ID
          : undefined;

      if (!marker && !overlayImport) return null;

      const result = transformSource(code, parts.file, {
        relPath: parts.rel,
        marker,
        ...(overlayImport ? { overlayImport } : {}),
      });

      if (!result) {
        // A `pre` plugin compiled this module *and* dropped the JSX source
        // information (for example the React Compiler or a production-mode
        // transform), so the markers cannot be recovered.
        if (!warnedAboutCompiledJsx && looksCompiled(code)) {
          warnedAboutCompiledJsx = true;
          config.logger.warn(
            `\n  tab-to-components: \`${parts.rel}\` reached the plugin already compiled ` +
              `and without JSX source information, so source markers were not added.\n` +
              `  Put \`tabToComponents()\` before other JSX-transforming plugins in your Vite config.\n`,
          );
        }
        return null;
      }
      return { code: result.code, map: result.map };
    },

    configureServer(server: ViteDevServer) {
      // Vite only calls this hook for a dev server, but keep the guard close
      // to the middleware so a programmatic caller cannot register the editor
      // endpoint in a build context either.
      if (!devServer) return;

      if (resolved.log) {
        const logger = server.config.logger;
        logger.info(
          `  tab-to-components v${VERSION}  hold ${resolved.keyboard
            .map((key) => key.toUpperCase())
            .join("+")} and click an element for source actions (dev only)`,
        );
        if (editorLauncher) {
          const suffix = resolved.editorExplicit ? "" : " (default)";
          logger.info(
            `  tab-to-components  editor: ${describeEditor(resolved.editor)}${suffix}`,
          );
          if (!resolved.editorExplicit && process.env.LAUNCH_EDITOR) {
            logger.info(
              "  tab-to-components  LAUNCH_EDITOR is set but the default editor is \"code\"; " +
                "pass editor: \"auto\" to keep using LAUNCH_EDITOR.",
            );
          }
        } else {
          logger.info(
            "  tab-to-components  editor: auto (Vite / launch-editor detection)",
          );
        }
      }
      const configuredHost = server.config.server?.host;
      const exposedBeyondLoopback =
        configuredHost === true ||
        (typeof configuredHost === "string" &&
          configuredHost !== "" &&
          configuredHost !== "localhost" &&
          configuredHost !== "127.0.0.1" &&
          configuredHost !== "::1");
      if (exposedBeyondLoopback) {
        server.config.logger.warn(
          "\n  tab-to-components: the dev server is exposed beyond localhost; " +
            "the editor endpoint can be called by other devices on the network. " +
            "Bind the dev server to localhost when you do not need network access.",
        );
      }

      // A custom editor needs our own endpoint; `editor: "auto"` still asks
      // Vite's built-in endpoint, but both paths are validated here first. For
      // `auto` the middleware only validates and calls `next()`, so Vite's
      // launch-editor keeps doing the actual launch.
      const requestEndpoint = `/${editorEndpoint}`;
      const basePrefix = base === "/" ? "" : base.replace(/\/+$/, "");
      const autoEditor = editorLauncher === undefined;
      const configuredOrigin =
        typeof server.config.server?.origin === "string"
          ? server.config.server.origin
          : undefined;

      // A browser request is one request, but nothing stops a page from
      // emitting hundreds at once. Coalesce concurrent/rapid duplicates and
      // cap the overall rate so a drive-by page cannot spawn an editor storm.
      const inFlightTargets = new Set<string>();
      const lastLaunchAt = new Map<string, number>();
      const recentLaunches: number[] = [];
      const MIN_LAUNCH_INTERVAL_MS = 250;
      const LAUNCH_WINDOW_MS = 5_000;
      const MAX_LAUNCHES_PER_WINDOW = 20;

      function reserveLaunch(key: string): "launch" | "duplicate" | "limited" {
        const now = Date.now();
        if (inFlightTargets.has(key)) return "duplicate";
        const last = lastLaunchAt.get(key);
        if (last !== undefined && now - last < MIN_LAUNCH_INTERVAL_MS) {
          return "duplicate";
        }

        while (recentLaunches.length > 0) {
          const oldest = recentLaunches[0];
          if (oldest === undefined || now - oldest <= LAUNCH_WINDOW_MS) break;
          recentLaunches.shift();
        }
        if (recentLaunches.length >= MAX_LAUNCHES_PER_WINDOW) return "limited";

        inFlightTargets.add(key);
        lastLaunchAt.set(key, now);
        recentLaunches.push(now);
        if (lastLaunchAt.size > 512) {
          for (const [key, launchedAt] of lastLaunchAt) {
            if (now - launchedAt > LAUNCH_WINDOW_MS) lastLaunchAt.delete(key);
          }
        }
        return "launch";
      }

      server.middlewares.use((request, response, next) => {
        const searchParams = matchEditorEndpoint(
          request.url ?? "",
          requestEndpoint,
          basePrefix,
        );
        if (!searchParams) return next();

        // Per-IDE actions (`open-code`, …) send `ide`. Only a known IDE whose
        // own action is configured may be launched; an unknown or disabled
        // value fails closed instead of falling back to the configured editor.
        const rawIde = searchParams.get("ide");
        let ide: IdeId | undefined;
        if (rawIde !== null) {
          if (!isIdeId(rawIde) || !ideLaunchers.has(rawIde)) {
            response.statusCode = 400;
            response.end(
              "tab-to-components: invalid `ide` parameter (expected one of the configured open-code, open-cursor, open-webstorm or open-trae click actions)",
            );
            return;
          }
          ide = rawIde;
        }

        if (request.method !== "GET" && request.method !== "POST") {
          // In auto mode a plain request belongs to Vite; leave it alone.
          if (autoEditor && ide === undefined) return next();
          response.statusCode = 405;
          response.end("tab-to-components: method not allowed");
          return;
        }

        const rejection = crossOriginRejection(
          request.headers,
          configuredOrigin,
        );
        if (rejection !== undefined) {
          response.statusCode = 403;
          response.end(`tab-to-components: ${rejection}`);
          return;
        }

        const rawFile = searchParams.get("file");

        if (autoEditor && ide === undefined) {
          // Vite's launch-editor resolves the path with `path.resolve` and only
          // checks existence, so validate containment before delegating. A
          // legitimate request may omit the line/column suffix.
          const file = rawFile ? parseEditorFilePath(rawFile, root) : undefined;
          if (file === undefined || !editorTargetExists({ file, line: 1, column: 1 })) {
            response.statusCode = 400;
            response.end(
              "tab-to-components: refused to open a file outside the project root",
            );
            return;
          }
          return next();
        }

        const target = rawFile ? parseEditorTarget(rawFile, root) : undefined;
        if (!target || !editorTargetExists(target)) {
          response.statusCode = 400;
          response.end(
            "tab-to-components: missing or invalid `file` parameter (expected an absolute path inside the project root)",
          );
          return;
        }

        const launcher =
          ide === undefined ? editorLauncher : ideLaunchers.get(ide);
        if (launcher === undefined) {
          // Unreachable: the `ide` branch above only admits configured IDEs.
          response.statusCode = 400;
          response.end("tab-to-components: no editor is configured for this request");
          return;
        }

        // Different IDEs may legitimately open the same file at once, so the
        // coalescing key includes the IDE (and `"editor"` for a plain open).
        const launchKey = `${ide ?? "editor"}\u0000${target.file}`;
        const reservation = reserveLaunch(launchKey);
        if (reservation === "limited") {
          response.statusCode = 429;
          response.end(
            "tab-to-components: too many editor launches, try again shortly",
          );
          return;
        }
        if (reservation === "duplicate") {
          response.statusCode = 200;
          response.end();
          return;
        }

        Promise.resolve()
          .then(() => launcher(target))
          .then(() => {
            if (!response.writableEnded) {
              response.statusCode = 200;
              response.end();
            }
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            server.config.logger.warn(
              `  tab-to-components: could not open the editor: ${message}`,
            );
            if (!response.writableEnded) {
              response.statusCode = 500;
              response.end(
                `tab-to-components: could not open the editor: ${message}`,
              );
            }
          })
          .finally(() => {
            inFlightTargets.delete(launchKey);
          });
      });
    },
  };

  return plugin;
}

function looksCompiled(code: string): boolean {
  if (code.includes("<") && /<[A-Za-z][\w.-]*[\s/>]/.test(code)) return false;
  return COMPILED_JSX_RE.test(code);
}
