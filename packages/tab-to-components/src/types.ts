/**
 * Keyboard key that arms the inspector.
 */
export type InspectorKey = "alt" | "ctrl" | "meta" | "shift";

/**
 * What a modifier + left click does.
 *
 * - `component`: open the nearest component usage site (the JSX element that
 *   renders the component the user clicked). Falls back to the clicked
 *   element's own JSX site when the click lands inside a route component.
 * - `element`: open the clicked element's own JSX site.
 * - `menu`: open the component chain picker instead of opening a file.
 */
export type TabToComponentsOpenMode = "component" | "element" | "menu";

/**
 * One action of the modifier + left-click picker.
 *
 * - `open`: open the source location in the configured editor (the pre-0.4
 *   behavior).
 * - `open-code`: open it in VS Code on the dev-server machine.
 * - `open-cursor`: open it in Cursor on the dev-server machine.
 * - `open-webstorm`: open it in WebStorm on the dev-server machine.
 * - `open-trae`: open it in Trae on the dev-server machine.
 * - `copy-file`: copy the bare file name, e.g. `MyBox.tsx`.
 * - `copy-path`: copy the project-relative path, e.g. `app/components/MyBox.tsx`.
 * - `copy-full-path`: copy the absolute path, e.g. `D:/proj/app/components/MyBox.tsx`.
 * - `copy-location`: copy `path:line:column`.
 *
 * The `open-*` actions are independent of the `editor` option: each one always
 * launches its own IDE, so one picker can offer several editors at once.
 */
export type TabToComponentsClickAction =
  | "open"
  | "open-code"
  | "open-cursor"
  | "open-webstorm"
  | "open-trae"
  | "copy-file"
  | "copy-path"
  | "copy-full-path"
  | "copy-location";

/** Actions shown by default: open the editor, copy the file name or full path. */
export const DEFAULT_CLICK_ACTIONS: readonly TabToComponentsClickAction[] = [
  "open",
  "copy-file",
  "copy-full-path",
];

/**
 * Color theme of the overlay UI.
 *
 * - `dark` (default): the original blue-on-black overlay.
 * - `light`: a blue-on-white overlay for light apps and screenshots.
 */
export type TabToComponentsTheme = "dark" | "light";

/**
 * A source location the dev server should open in the editor.
 * Emitted by the browser runtime, consumed by the editor launcher.
 */
export interface EditorTarget {
  /** Absolute file path. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
}

/** Fully custom way of opening a location (runs in the dev server process). */
export type EditorLauncher = (target: EditorTarget) => void | Promise<void>;

/** Explicit command + arguments; `{file}`, `{line}` and `{column}` placeholders are expanded. */
export interface EditorCommandConfig {
  command: string;
  args?: readonly string[];
}

/**
 * Which editor should open a source location.
 *
 * - `"cursor"`, `"code"`, `"trae"`, `"webstorm"`, `"subl"`, `"zed"`, `"vim"`, …
 *   use a built-in preset (the list lives in the README).
 * - `"auto"` hands the request back to Vite's built-in `/__open-in-editor`
 *   endpoint, which auto-detects the running editor and honours
 *   `LAUNCH_EDITOR`.
 * - Any other command name is launched as `<command> <file>:<line>:<column>`.
 * - A string containing spaces or `{file}`/`{line}`/`{column}` placeholders is a
 *   command template, e.g. `"my-ide --goto {file}:{line}:{column}"`.
 * - The object form gives full control over arguments.
 * - The function form runs whatever code you want in the dev server process.
 *
 * @default "code" — VS Code is used when no `editor` is configured.
 */
export type EditorOption = string | EditorCommandConfig | EditorLauncher;

export interface TabToComponentsOptions {
  /**
   * Modifier key(s) that arm the inspector.
   * @default "alt"
   */
  keyboard?: InspectorKey | InspectorKey[];

  /**
   * What a modifier + left click opens.
   * @default "component"
   */
  open?: TabToComponentsOpenMode;

  /**
   * Actions offered by the modifier + left-click picker, in order. By default
   * the picker offers `"open"`, `"copy-file"` and `"copy-full-path"` so the
   * developer can jump to the editor, copy `MyBox.tsx`, or copy
   * `D:/proj/app/components/MyBox.tsx`. Pass a single action (or
   * `clickActions: "open"`) to skip the picker and keep the instant-open
   * behavior.
   *
   * Ignored when `open: "menu"` is used: that mode keeps the component chain
   * picker on left click.
   *
   * @default ["open", "copy-file", "copy-full-path"]
   */
  clickActions?: TabToComponentsClickAction | TabToComponentsClickAction[];

  /**
   * Show the component chain picker on modifier + right click.
   * @default true
   */
  menu?: boolean;

  /**
   * Color theme of the overlay, its labels, menus and toasts.
   *
   * The overlay is dark by default, matching the original design. Pass
   * `"light"` for a light app: blue accents become darker for contrast and the
   * surfaces turn white.
   * @default "dark"
   */
  theme?: TabToComponentsTheme;

  /**
   * How the client runtime gets into the page. `all` injects a side-effect
   * import into every client module, which works for every framework
   * (including React Router framework mode, which never calls
   * `transformIndexHtml`). `entry` only injects it into `entry.client.*`
   * modules. `false` disables the client runtime entirely.
   * @default "all"
   */
  overlay?: "all" | "entry" | false;

  /**
   * Also annotate server-rendered markup. Keeping this on means the markers
   * are present in the SSR HTML, making the client props and the server markup
   * identical during hydration.
   * @default true
   */
  ssr?: boolean;

  /**
   * Only instrument files whose project-root-relative path matches.
   * `node_modules`, `dist`, `build` and `.react-router` are always excluded.
   */
  include?: RegExp | RegExp[];

  /**
   * Skip files whose project-root-relative path matches.
   */
  exclude?: RegExp | RegExp[];

  /**
   * Which editor opens a source location.
   *
   * Defaults to **VS Code** (`"code"`): the plugin launches `code` on the
   * dev-server machine. Pass `"cursor"`, `"trae"`, `"webstorm"`, … for a
   * preset, any command name, a command template, `{ command, args }`, a
   * launcher function, or `"auto"` to go back to Vite's
   * auto-detection / `LAUNCH_EDITOR`.
   *
   * @default "code"
   */
  editor?: EditorOption;

  /**
   * Path of the editor endpoint, relative to the Vite `base`.
   * Defaults to `__ttc/open-in-editor` (the plugin's own endpoint), or to
   * Vite's `__open-in-editor` when `editor: "auto"` is used.
   */
  editorEndpoint?: string;

  /**
   * Log the plugin banner and one-time warnings to the terminal.
   * @default true
   */
  log?: boolean;
}

export interface ResolvedOptions {
  keyboard: InspectorKey[];
  open: TabToComponentsOpenMode;
  clickActions: TabToComponentsClickAction[];
  menu: boolean;
  theme: TabToComponentsTheme;
  overlay: "all" | "entry" | false;
  ssr: boolean;
  include: RegExp[];
  exclude: RegExp[];
  editor: EditorOption;
  /** True when the user passed `editor`; false when it came from the default. */
  editorExplicit: boolean;
  editorEndpoint?: string;
  log: boolean;
}

/**
 * The shape the plugin injects as `globalThis.__TTC_CONFIG__`.
 * Keep this in sync with `src/client/config.ts`.
 */
export interface ClientConfig {
  version: string;
  root: string;
  base: string;
  keyboard: InspectorKey[];
  open: TabToComponentsOpenMode;
  clickActions: TabToComponentsClickAction[];
  menu: boolean;
  theme: TabToComponentsTheme;
  editorEndpoint: string;
}

export const MARKER_ATTR = "data-ttc";
export const NAME_ATTR = "data-ttc-name";
