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
  createEditorLauncher,
  editorTargetExists,
  parseEditorTarget,
} from "./editor.js";
import { VERSION } from "./version.js";
import {
  DEFAULT_CLICK_ACTIONS,
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
  "copy-file",
  "copy-path",
  "copy-full-path",
  "copy-location",
];

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

  function clientConfig(): ClientConfig {
    return {
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
      if (!editorLauncher) return;

      // A custom editor needs our own endpoint: Vite's built-in one always
      // goes through launch-editor's auto-detection / LAUNCH_EDITOR.
      const requestEndpoint = `/${editorEndpoint}`;
      const basePrefix = base === "/" ? "" : base.replace(/\/+$/, "");

      server.middlewares.use((request, response, next) => {
        const rawUrl = request.url ?? "";
        if (!rawUrl.startsWith("/")) return next();
        const queryIndex = rawUrl.indexOf("?");
        const rawPath = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
        const search = queryIndex === -1 ? "" : rawUrl.slice(queryIndex + 1);
        let pathname = rawPath;
        if (basePrefix && pathname.startsWith(basePrefix)) {
          pathname = pathname.slice(basePrefix.length);
        }
        if (pathname !== requestEndpoint) return next();

        if (request.method !== "GET" && request.method !== "POST") {
          response.statusCode = 405;
          response.end("tab-to-components: method not allowed");
          return;
        }

        const rawFile = new URLSearchParams(search).get("file");
        const target = rawFile ? parseEditorTarget(rawFile, root) : undefined;
        if (!target || !editorTargetExists(target)) {
          response.statusCode = 400;
          response.end(
            "tab-to-components: missing or invalid `file` parameter (expected an absolute path inside the project root)",
          );
          return;
        }

        Promise.resolve()
          .then(() => editorLauncher(target))
          .then(() => {
            if (!response.writableEnded) {
              response.statusCode = 200;
              response.end();
            }
          })
          .catch((error: unknown) => {
            if (!response.writableEnded) {
              response.statusCode = 500;
              response.end(
                `tab-to-components: could not open the editor: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
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
