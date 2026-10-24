# tab-to-components

[![npm version](https://img.shields.io/npm/v/tab-to-components.svg)](https://www.npmjs.com/package/tab-to-components)
[![CI](https://github.com/r48n34/tab-to-components/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/r48n34/tab-to-components/actions/workflows/ci.yml)

**Alt+click any React element in your dev server and jump straight to the JSX that rendered it.**

A dev-only Vite plugin for the modern React stack: **React 19**, **Vite 7 & 8**, and **React Router v7 / v8 framework mode** — including streamed SSR, where the other click-to-component tools stopped working.

```
Alt + click the "count is 0" button  →

<button />   app/components/Button.tsx:6:10
<Button />   app/routes/home.tsx:20:9     ← opened in your editor
```

![Hovering the count button: the overlay outlines it and shows the Button component's source location, src/App.tsx:20:9](https://github.com/r48n34/tab-to-components/raw/main/docs/demo-hover.png)

- Zero app-code changes — no `entry.client.tsx` edit, no root route edit, no React runtime patching.
- Works in `react-router dev` (SSR, streaming, SPA mode) **and** plain Vite.
- **Opens VS Code by default**; `editor: "cursor" | "trae" | "webstorm" | …`, a command template, a launcher function, or `"auto"` for auto-detection.
- Never ships to production: no markers, no client code, no extra imports in `vite build` / `react-router build`.

## Install

```bash
pnpm add -D tab-to-components
npm i -D tab-to-components
yarn add -D tab-to-components
bun add -d tab-to-components
```

---

## Setup

### React Router v7 / v8 (framework mode)

```ts
// vite.config.ts
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  plugins: [tabToComponents(), reactRouter()],
});
```

That is the whole setup. The client runtime is injected into client modules by the plugin, so React Router's streamed SSR document needs no edits.

### Plain Vite + React

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  plugins: [react(), tabToComponents()],
});
```

### React Router declarative / data mode (SPA)

Same one-liner as plain Vite — `createBrowserRouter` + `RouterProvider` apps only need the plugin in `vite.config.ts`.

> **Plugin order:** `tabToComponents()` works before or after other JSX-transforming plugins (it has a compiled-JSX fallback). The one exception is `@vitejs/plugin-react` **4.x on Vite 7**, which prepends its HMR preamble before the JSX transform and shifts the positions it reports — use `@vitejs/plugin-react` ≥ 5.1 there, or put `tabToComponents()` first.

---

## What you get

| Action | Result |
| --- | --- |
| Hold <kbd>Alt</kbd> + move the mouse | The element under the cursor is outlined; a label shows `<Component />` and `file:line:column`. |
| <kbd>Alt</kbd> + left click | Opens the **nearest component usage site** (e.g. the `<Button />` line in your page) in your editor. Falls back to the clicked element when it was rendered directly. |
| <kbd>Alt</kbd> + right click | Opens the **component chain picker** listing every marked JSX ancestor (`<button />`, `<Button />`, `<Card />`, …). Click a row, or use <kbd>↑</kbd>/<kbd>↓</kbd>/<kbd>Enter</kbd>, <kbd>Esc</kbd> to close. |
| After opening | A short toast confirms the file that was opened. |

The app's own click handler is **not** triggered (the plugin suppresses it in the capture phase), and no overlay DOM is added except one `<div data-ttc-ui>` shadow root with `pointer-events: none`.

![Alt+right-click opens the component chain picker, listing each marked JSX ancestor and its source file](https://github.com/r48n34/tab-to-components/raw/main/docs/demo-menu.png)

```
data-ttc        "<project relative path>:<line>:<column>"  (1-based)
data-ttc-name   JSX tag name, e.g. "Button"                (component elements only)
```

---

## Options

```ts
tabToComponents({
  keyboard: "alt",
  open: "component",
  menu: true,
  overlay: "all",
  ssr: true,
  editor: "code",              // default: VS Code; "cursor", "trae", { command, args }, fn
  include: [/^app\//],
  exclude: [/\.stories\.tsx$/],
  editorEndpoint: "__ttc/open-in-editor",
  log: true,
});
```

| Option | Default | Description |
| --- | --- | --- |
| `keyboard` | `"alt"` | Modifier key(s) that arm the inspector: `"alt"`, `"ctrl"`, `"meta"`, `"shift"`, or an array (all must be held). |
| `open` | `"component"` | What a modifier + click opens: `"component"` = nearest component usage site (with fallback), `"element"` = the clicked element's own JSX site, `"menu"` = show the picker instead. |
| `menu` | `true` | Enable the modifier + right-click chain picker. |
| `overlay` | `"all"` | `"all"` injects the browser runtime through client modules (works in every framework, including React Router's streamed SSR). `"entry"` only injects it into `entry.client.*` modules. `false` disables the runtime (markers only). |
| `ssr` | `true` | Also annotate server-rendered markup, keeping server and client props identical during hydration. Set `false` if you snapshot SSR HTML. |
| `include` / `exclude` | — | RegExp or RegExp[] matched against project-relative paths. `node_modules`, `dist`, `build`, `.react-router` and `public` are always excluded. |
| `editor` | **`"code"`** | IDE that opens the source. **VS Code is the default**; pass `"cursor"`, `"trae"`, `"webstorm"`, … for a preset, `"auto"` for Vite's auto-detection/`LAUNCH_EDITOR`, or a `{ command, args }` object / launcher function. See [Choosing the editor](#choosing-the-editor). |
| `editorEndpoint` | `"__ttc/open-in-editor"` | Endpoint (relative to `base`) used to open files. Defaults to the plugin's own endpoint (VS Code/default editor), or `"__open-in-editor"` for `editor: "auto"`. |
| `log` | `true` | Print the startup banner (and the selected editor). |

---

## Choosing the editor

### Default: VS Code

With no configuration the plugin opens **VS Code**: it launches `code` on the dev-server machine with `-r -g <file>:<line>:<column>` (reuse the window, go to the location). That is what you get out of the box, with no environment variables and no editor auto-detection.

> `code` must be on `PATH` (install it with *Shell Command: Install 'code' command in PATH* in VS Code, or use `editor` below to point at another binary).

### Pick your IDE

The `editor` option accepts:

```ts
// Built-in presets
tabToComponents({ editor: "cursor" });
tabToComponents({ editor: "trae" });
tabToComponents({ editor: "webstorm" });
tabToComponents({ editor: "code" });      // "code-insiders", "codium", "zed", "subl", "vim", "emacs", …

// Any other CLI: launched as `<command> <file>:<line>:<column>`
tabToComponents({ editor: "pi" });

// Command template, with {file}, {line} and {column} placeholders
tabToComponents({
  editor: "my-ide --goto {file}:{line}:{column}",
});

// Full control over the arguments
tabToComponents({
  editor: {
    command: "pi",
    args: ["--line", "{line}", "--column", "{column}", "{file}"],
  },
});

// Or run any code in the dev server process (remote editors, custom protocols, …)
tabToComponents({
  editor: async ({ file, line, column }) => {
    await fetch(`http://localhost:7777/open?file=${file}&line=${line}&column=${column}`);
  },
});
```

### Let Vite auto-detect instead

Pass `editor: "auto"` to hand the request back to Vite's built-in `/__open-in-editor` endpoint ([`launch-editor`](https://github.com/yyx990803/launch-editor)): it detects the editor you are currently running and honours `LAUNCH_EDITOR`.

```ts
tabToComponents({ editor: "auto" });
```

```bash
LAUNCH_EDITOR=code      pnpm dev
LAUNCH_EDITOR=cursor    pnpm dev
LAUNCH_EDITOR=webstorm  pnpm dev
```

What the presets launch:

| Editor family | Presets | Arguments |
| --- | --- | --- |
| VS Code family | `code`, `code-insiders`, `vscode`, `codium`, `vscodium`, `cursor`, `windsurf`, `trae`, `antigravity` | `-r -g <file>:<line>:<column>` |
| JetBrains | `webstorm`, `idea`, `pycharm`, `phpstorm`, `goland`, `rubymine`, `clion`, `rider`, `appcode`, `fleet` | `--line <line> --column <column> <file>` |
| Colon-style | `zed`, `subl`, `sublime`, `atom`, `charm`, `wstorm`, `textmate` | `<file>:<line>:<column>` |
| Vim family | `vim`, `nvim`, `mvim`, `gvim`, `neovim` | `+call cursor(<line>, <column>) <file>` |
| Emacs | `emacs`, `emacsclient` | `+<line>:<column> <file>` |
| Notepad++ | `notepad++` | `-n<line> -c<column> <file>` |

Anything not in the table is treated as a command name and launched with `<file>:<line>:<column>` appended (works for most VS Code forks). Use a command template or the object form when your IDE needs different flags.

The endpoint only accepts files inside the Vite project root, and the command runs on the **dev-server machine** — exactly like `launch-editor`. If your dev server runs in a container, WSL or over SSH, use the function form (e.g. POST to a helper on your machine) or `editor: "auto"` with `LAUNCH_EDITOR` pointing at a wrapper script.

If the editor cannot be launched, the terminal receives the error and a toast in the browser shows the full `path:line:column` so you can copy it.

---

## Compatibility

Verified in the project's test suite against real dev servers, SSR renders, production builds and headless-Chrome Alt+clicks:

| | Tested |
| --- | --- |
| React Router | **7.18.4** framework mode on Vite 7.3.7 **and** Vite 8.3.5; **8.5.0** framework mode on Vite 8.3.5 |
| Vite | **7.3.7** and **8.3.5** |
| React | **19.3.1** |
| `@vitejs/plugin-react` | 5.2.0 on Vite 7, 6.1.2 on Vite 8 (both plugin orders) |
| Editors | **VS Code (`code`) by default**; presets for the VS Code family (incl. **Cursor/Trae**), JetBrains, Zed, Sublime, Vim, Emacs; command templates and custom launcher functions; `editor: "auto"` for Vite's `launch-editor` auto-detection |

Vite 6 is inside the peer range but untested — use Vite 7+ to be safe.

---

## How it works

1. **Source markers.** An `enforce: "pre"` Vite transform parses app modules with `@babel/parser` and inserts `data-ttc="<path>:<line>:<column>"` (plus `data-ttc-name` on component elements) after the last JSX attribute. Edits go through `magic-string`, so formatting and source maps are preserved. It runs before React Router's own route-module transform, so framework mode still gets raw TSX.
2. **Compiled-JSX fallback.** If another `pre` plugin compiled the module first, the plugin injects the same markers into the compiler's `jsxDEV(...)` calls (Babel and esbuild keep the original source object in development), so plugin order is not critical.
3. **Overlay delivery.** React Router never calls `transformIndexHtml`, so a module import is the only mechanism that works for both `index.html` apps and streamed SSR: client modules get `import "virtual:tab-to-components/client"`, which publishes a config and evaluates a tiny dependency-free DOM runtime.
4. **Resolution.** On click the runtime walks the React fiber tree (`__reactFiber$…` → `memoizedProps["data-ttc"]`) — the same stable technique React DevTools uses — and asks the dev server to open the chosen site. The dev server launches the configured editor (VS Code's `code` by default) through the plugin's `__ttc/open-in-editor` endpoint, or delegates to Vite's endpoint for `editor: "auto"`.

---

## Troubleshooting

**Nothing happens when I Alt+click.**
The plugin is dev-only. Make sure you run the dev server (not `vite preview`/`build`), that `tabToComponents()` is in `vite.config.ts`, and that the startup banner is printed. If the file you click lives in `node_modules` or is generated MDX output, it is intentionally not instrumented.

**The editor does not open.**
The default editor is **VS Code** (`code`), so `code` must be on `PATH` (in VS Code: *Shell Command: Install 'code' command in PATH*). Watch the terminal for a `Could not launch "code"` message and the browser network tab for `__ttc/open-in-editor?file=…`. To use another IDE, pass `editor: "cursor"` / `"trae"` / `"webstorm"` / a command template / a function. To fall back to Vite's detection + `LAUNCH_EDITOR`, pass `editor: "auto"`. The toast shows the exact path to open manually.

**The line number is off by a constant on Vite 7.**
You are on `@vitejs/plugin-react` 4.x, which prepends its HMR preamble before the JSX transform. Upgrade to ≥ 5.1 or put `tabToComponents()` first in the plugins array.

**SSR HTML snapshots changed.**
The plugin annotates server-rendered markup by default so hydration stays consistent. Pass `ssr: false` to keep the server HTML untouched.

**I use a monorepo / custom `root`.**
Markers are relative to the Vite `config.root`. Run the plugin in the app's own Vite config, or scope it with `include`. `node_modules` and `/@fs/` paths outside the root are never instrumented.

**Production build?**
Nothing is injected. The plugin is `apply: "serve"`, and every hook independently refuses to run for a build command, so a stripped or wrapped plugin registration still cannot emit markers, the virtual client module or the browser runtime. The integration suite builds plain Vite and React Router 7/8 apps and scans their output, and `pnpm verify:package` repeats the check against the packed npm artifact.

---

## Limitations (by design)

- **`array.map()` rows** open the JSX inside the callback — the only location that exists in the source — not the row's data.
- **MDX and pre-compiled dependencies** are not instrumented; the component chain still includes the app-level usages that render them.
- **React Server Components** (`react-router/rsc`) are best-effort in 0.1: markers work, the overlay is client-only.
- Markers are dev-only `data-ttc` / `data-ttc-name` attributes: they are visible in dev HTML and the DOM, and never in production output.

---

## Dev-only by construction

`tab-to-components` is a development tool, not a runtime dependency. Its dev-only behaviour is enforced in layers:

| Layer | Guarantee |
| --- | --- |
| `apply: "serve"` | Vite removes the plugin from `vite build` / `react-router build` before any hook runs. |
| Hook-level command guard | If a wrapper re-registers the plugin without `apply`, `configResolved`, `transform`, `resolveId`, `load` and `configureServer` all stay inert for a build command. No marker, no virtual import and no browser runtime can be emitted. |
| Virtual module guard | `virtual:tab-to-components/client` only resolves from a running dev server. A production build that imports it fails to resolve instead of bundling the overlay. |
| Package exports | `dist/client.js` is served by the dev server but is not an importable package subpath. |
| Regression gates | `pnpm test:dev-only` covers the contract; the integration suite builds plain Vite and React Router 7/8 apps and scans output for `data-ttc`, the virtual module id and the `__TTC_*` globals; `pnpm verify:package` reruns the production-build checks against the exact packed artifact. |

Install it with `-D` and keep it in `vite.config.ts`; never import it from application code.

## Development

This package lives in a pnpm workspace together with five playground apps (React Router v7/v8 on Vite 7/8 and plain Vite apps) used by the test suites.

```bash
pnpm install
pnpm build            # tsc + rolldown -> dist/
pnpm test             # unit tests (includes the dev-only contract suite)
pnpm test:dev-only    # fast subset: dev-only guards, virtual module, editor middleware
pnpm test:integration # Vite 8 dev servers, SSR, production builds, default VS Code + custom editor endpoints
pnpm test:matrix      # Vite 7 dev servers, SSR, build and plugin orderings
pnpm e2e              # headless Chrome Alt+click across all 5 playgrounds
pnpm verify:package   # validates the packed npm artifact
```

Issues and pull requests are welcome.

---

## License

MIT © Reemo studio
