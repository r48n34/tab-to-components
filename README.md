# tab-to-components

[![npm version](https://img.shields.io/npm/v/tab-to-components.svg)](https://www.npmjs.com/package/tab-to-components)
[![CI](https://github.com/r48n34/tab-to-components/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/r48n34/tab-to-components/actions/workflows/ci.yml)

**Alt+click any React element in your dev server: jump to the JSX that rendered it, or copy its file name to the clipboard.**

A dev-only Vite plugin for the modern React stack: **React 18 & 19**, **Vite 6, 7 & 8**, **React Router v6 / v7 / v8**, **TanStack Start**, **Astro 7** (React islands), **Vike 0.4** (`vike-react`), and **Remix v2** — including streamed SSR, where the other click-to-component tools stopped working.


![Hovering the count button: the overlay outlines it and shows the Button component's source location, src/App.tsx:20:9](https://github.com/r48n34/tab-to-components/raw/main/docs/demo-hover.png)

- Zero app-code changes — no `entry.client.tsx` edit, no root route edit, no React runtime patching.
- Works in `react-router dev` (SSR, streaming, SPA mode), TanStack Start, Astro islands, Vike SSR, Remix v2 **and** plain Vite.
- **Opens VS Code by default**; `editor: "cursor" | "trae" | "webstorm" | …`, a command template, a launcher function, or `"auto"` for auto-detection.
- **Open or copy:** the Alt+click picker can open the source in your IDE or copy the file name (`MyBox.tsx`), the project-relative path, the full absolute path (`D:/proj/app/components/MyBox.tsx`), or `path:line:column` to the clipboard.
- Never ships to production: no markers, no client code, no extra imports in `vite build`, `react-router build`, `astro build` or `vike build`.

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

### React Router v6 (declarative / data mode, SPA)

Same one-liner as plain Vite — `react-router-dom` v6 apps (`BrowserRouter` / `createBrowserRouter` + `RouterProvider`) only need the plugin in `vite.config.ts`.

### TanStack Start

```ts
// vite.config.ts
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  plugins: [
    tabToComponents(),
    tanstackStart({ srcDirectory: "src" }),
    react(),
  ],
});
```

The plugin runs before TanStack Start's route-module transform, so both the server-rendered markup and the client route modules carry source markers. The overlay runtime is injected into the client entry with no `entry.client.tsx` edit.

### Astro 7 (React islands)

```ts
// astro.config.mjs
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  integrations: [react()],
  vite: { plugins: [tabToComponents()] },
});
```

Astro owns the Vite config, so the plugin goes in Astro's `vite.plugins` option. Markers and the overlay apply to React/JSX modules inside hydrated islands; `.astro` markup itself is not instrumented.

### Vike 0.4 (vike-react)

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import vike from "vike/plugin";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  plugins: [tabToComponents(), react(), vike()],
});
```

Vike is tested with the `vike-react` renderer on React 19. `vike-react` 0.6 declares `peer react ">=19"` / `peer react-dom ">=19"`, so React 18 is not supported there.

### Remix v2 (Vite)

```ts
// vite.config.ts
import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  plugins: [tabToComponents(), remix()],
});
```

Remix v2 supports Vite 5/6 and React 18. Remix v1 uses its classic esbuild compiler, not Vite, so it is not supported by this plugin.

> **Plugin order:** `tabToComponents()` works before or after other JSX-transforming plugins (it has a compiled-JSX fallback). The one exception is `@vitejs/plugin-react` **4.x on Vite 7**, which prepends its HMR preamble before the JSX transform and shifts the positions it reports — use `@vitejs/plugin-react` ≥ 5.1 there, or put `tabToComponents()` first.

---

## What you get

| Action | Result |
| --- | --- |
| Hold <kbd>Alt</kbd> + move the mouse | The element under the cursor is outlined; a label shows `<Component />` and `file:line:column`. |
| <kbd>Alt</kbd> + left click | Opens the **source action picker** for the nearest component usage site (e.g. the `<Button />` line in your page): **Open in IDE**, **Copy file name** (`MyBox.tsx`) or **Copy full path** (`D:/proj/app/components/MyBox.tsx`). Falls back to the clicked element when it was rendered directly. |
| <kbd>Alt</kbd> + right click | Opens the **component chain picker** listing every marked JSX ancestor (`<button />`, `<Button />`, `<Card />`, …). Click a row, or use <kbd>↑</kbd>/<kbd>↓</kbd>/<kbd>Enter</kbd>, <kbd>Esc</kbd> to close. |
| After an action | A short toast confirms the file that was opened or the text that was copied. |

Configuring a **single** action skips the picker and runs it immediately — `clickActions: ["open"]` keeps the pre-0.4 instant-open behavior (see [Copy source paths](#copy-source-paths)).

The app's own click handler is **not** triggered (the plugin suppresses it in the capture phase), and no overlay DOM is added except one `<div data-ttc-ui>` shadow root with `pointer-events: none`. The overlay is **dark by default**; set `theme: "light"` to match a light app (see [Theme](#theme)).

![Alt+right-click opens the component chain picker, listing each marked JSX ancestor and its source file](https://github.com/r48n34/tab-to-components/raw/main/docs/demo-menu.png)

```
data-ttc        "<project relative path>:<line>:<column>"  (1-based)
data-ttc-name   JSX tag name, e.g. "Button"                (component elements only)
```

---

## Copy source paths

By default the Alt+click picker offers **Open in IDE**, **Copy file name** and **Copy full path**. “Copy file name” writes the bare file (`MyBox.tsx`) for a chat message or an issue; “Copy full path” writes the absolute path built from the Vite project root (`D:/proj/app/components/MyBox.tsx`) for a terminal or a script:

```
<Button />   app/components/MyBox.tsx:12:5
             → Copy file name         MyBox.tsx
             → Copy full path         D:/proj/app/components/MyBox.tsx
             → Copy relative path     app/components/MyBox.tsx
             → Copy file:line:column  app/components/MyBox.tsx:12:5
```

Choose which copy actions the picker offers with `clickActions` (order is preserved):

```ts
tabToComponents({
  // Default: open the editor, copy the file name or copy the full path.
  clickActions: ["open", "copy-file", "copy-full-path"],

  // Add every copy variant, including the project-relative path and location.
  // clickActions: ["open", "copy-file", "copy-full-path", "copy-path", "copy-location"],

  // One action skips the picker entirely: instant open, the pre-0.4 behavior.
  // clickActions: ["open"],

  // Copy-only: Alt+click never opens the editor.
  // clickActions: ["copy-full-path"],
});
```

| Action | Clipboard content | Toast |
| --- | --- | --- |
| `"open"` | — (asks the dev server to open the source in your editor) | `Opened <Button /> app/routes/home.tsx:19:7` |
| `"copy-file"` | `MyBox.tsx` | `Copied file name: MyBox.tsx` |
| `"copy-path"` | `app/components/MyBox.tsx` | `Copied path: app/components/MyBox.tsx` |
| `"copy-full-path"` | `D:/proj/app/components/MyBox.tsx` | `Copied full path: D:/proj/app/components/MyBox.tsx` |
| `"copy-location"` | `app/components/MyBox.tsx:12:5` | `Copied location: app/components/MyBox.tsx:12:5` |

The picker supports the mouse and the keyboard (<kbd>↑</kbd>/<kbd>↓</kbd>, <kbd>Home</kbd>/<kbd>End</kbd>, <kbd>Enter</kbd>/<kbd>Space</kbd>, <kbd>Esc</kbd>). Every row refers to the **same source location** the row would open — the nearest component usage site, or the clicked element for `open: "element"`; use <kbd>Alt</kbd>+right click to reach another marked ancestor. “Copy full path” joins the injected Vite project root with the marker path, so it is the path on the **dev-server machine** (a container/WSL/SSH path if the server runs there). Copying uses `navigator.clipboard.writeText` on localhost and falls back to `document.execCommand("copy")` when the Clipboard API is unavailable; if both fail the toast shows the text so it can be copied manually. `clickActions` is ignored when `open: "menu"` is used — that mode keeps the component chain picker on left click.

---

## Theme

The overlay is **dark by default** — the original blue-on-black UI. For a light app, pass `theme: "light"`: the hover label, both pickers and the toasts switch to white surfaces with darker blue accents, so the text keeps its contrast on light backgrounds.

```ts
tabToComponents({
  theme: "light", // default: "dark"
});
```

The choice is rendered as a `data-ttc-theme` attribute on the `[data-ttc-ui]` host together with CSS custom properties inside its shadow root, so it cannot leak into the app's own styles and the app's CSS cannot restyle the overlay.

---

## Options

```ts
tabToComponents({
  keyboard: "alt",
  open: "component",
  clickActions: ["open", "copy-file", "copy-full-path"],
  menu: true,
  theme: "dark",               // "dark" (default) or "light"
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
| `clickActions` | `["open", "copy-file", "copy-full-path"]` | Rows of the modifier + left-click source action picker, in order: `"open"`, `"copy-file"`, `"copy-path"`, `"copy-full-path"`, `"copy-location"` (or a single value). One action skips the picker. Ignored for `open: "menu"`. See [Copy source paths](#copy-source-paths). |
| `menu` | `true` | Enable the modifier + right-click chain picker. |
| `theme` | `"dark"` | Color theme of the overlay: `"dark"` (the original blue-on-black UI) or `"light"` (white surfaces with darker blue accents for contrast). See [Theme](#theme). |
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
    const url = new URL("http://localhost:7777/open");
    // `file` is an absolute path and may contain URL metacharacters.
    url.searchParams.set("file", file);
    url.searchParams.set("line", String(line));
    url.searchParams.set("column", String(column));
    await fetch(url);
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

> **Windows security note.** `editor: "auto"` delegates to Vite's `/__open-in-editor` endpoint, which comes from Vite/`launch-editor` and exists on every Vite dev server. Keep Vite patched: [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) affects Vite 6 ≤ 6.4.3, 7.0–7.3.6, 8.0–8.1.5, 8.2.0–8.2.3 and 8.3.0–8.3.2 (fixed in 6.4.4 / 7.3.7 / 8.1.6 / 8.2.4 / 8.3.3), and [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) affects Vite 6 ≤ 6.4.2, 7.0–7.3.4 and 8.0.0–8.0.15 (fixed in 6.4.3 / 7.3.5 / 8.0.16). The default `editor: "code"` path uses the plugin's own endpoint and is not affected by those advisories.

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

The plugin's endpoints only accept files inside the Vite project root — requests handed to Vite's endpoint in `editor: "auto"` mode are validated by the plugin before Vite sees them — and the command runs on the **dev-server machine**, exactly like `launch-editor`. If your dev server runs in a container, WSL or over SSH, use the function form (e.g. POST to a helper on your machine) or `editor: "auto"` with `LAUNCH_EDITOR` pointing at a wrapper script.

If the editor cannot be launched, the terminal receives the error and a toast in the browser shows the full `path:line:column` so you can copy it.

---

## Browser extension (Chrome, no Vite config)

A standalone **Plasmo-based Manifest V3 Chrome extension** ports the same
workflow to any React dev server **without touching the app's Vite config**:
[`packages/tab-to-components-extension`](./packages/tab-to-components-extension).

- React 18 locations come from fiber `_debugSource`; React 19 recovers them from
  `_debugStack` plus the dev server's source maps (Vite 8 verified — the mapped
  positions match this plugin's `data-ttc` markers exactly).
- The editor is opened through IDE URL schemes (`vscode://`, `cursor://`, …)
  instead of launching a process on the dev-server machine.
- Narrow loopback-only permissions (`localhost`, `127.0.0.1`, `[::1]`); not
  published to the Chrome Web Store.
- Coexists with this plugin: with `overlay: false` the extension reuses the
  plugin's exact markers and provides its own UI.

```bash
pnpm gate:extension   # typecheck + tests + production build + manifest check
```

See the [extension README](./packages/tab-to-components-extension/README.md) for
install/load-unpacked steps, settings, editor presets, QA checklist and
limitations.

---

## Compatibility

Verified against real dev servers, SSR renders and production builds. The full 10-framework × 2-React evidence table, per-check results and resolved versions live in [docs/compatibility-matrix.md](https://github.com/r48n34/tab-to-components/blob/main/docs/compatibility-matrix.md); regenerate it with `pnpm install:compat` (seven isolated fixture roots) and `pnpm test:compat:full`, or run the same matrix without the Chrome tier via `pnpm test:compat`. The matrix also records an optional headless-Chrome Alt+click tier: a Browser cell is ✅ only when Chrome actually ran, and is reported as ⏭ skipped — never passed — when it cannot launch.

| | Support |
| --- | --- |
| React | **18.3.1** and **19.3.1** |
| Vite | **8.3.5** on the Vite / React Router / TanStack Start / Astro / Vike rows; **7.3.7** through `pnpm test:matrix`; **6.4.5** through Remix v2 |
| React Router | v6 **6.30.6** (SPA), v7 **7.18.4** and v8 **8.5.0** framework mode (SSR) |
| TanStack Start | **1.169.4** (TanStack Router **1.170.46**) on Vite 8 |
| Astro | **7.4.2** with `@astrojs/react` **7.1.1** on React **18.3.1** and **19.3.1**; React islands only (`.astro` markup is not instrumented) |
| Vike | **0.4.268** with `vike-react` **0.6.31** on React **19.3.1**; React 18 is outside the renderer's peer range |
| RedwoodJS | Classic **not supported**: its `@redwoodjs/vite` package pins **Vite 5**, below this plugin's Vite 6+ range; the Vite-based **RedwoodSDK** is emerging and not yet covered |
| Waku | **1.0.0-rc.x** (rc.4 at the time of writing) — **deferred** until a stable release; not tested |
| Shopify Hydrogen | Built on **React Router 7**, so it inherits the React Router v7 row instead of a separate matrix entry |
| Remix | v2 **2.17.5** on Vite 6 (React 18 only); v1 has no Vite integration |
| Next.js | **16.4.3** — **not supported**: `next dev` uses Turbopack (default) or webpack, not Vite; Next.js 16 accepts React 18.2+ (Pages Router) and React 19 (App Router) upstream |
| `@vitejs/plugin-react` | **6.1.2** on Vite 8; 5.x for the Vite 7 suite |
| Editors | **VS Code (`code`) by default**; presets for the VS Code family (incl. **Cursor/Trae**), JetBrains, Zed, Sublime, Vim, Emacs; command templates and custom launcher functions; `editor: "auto"` for Vite's `launch-editor` auto-detection |

Known compatibility constraints (not plugin bugs):

- **React Router v8** declares `peer react >=19.2.7`, so **React 18 is not supported** there.
- **Remix v2** declares `peer react ^18.0.0` and supports Vite 5/6, so **React 19 is not supported** there.
- **Remix v1** uses a classic esbuild compiler, not Vite, so this Vite plugin cannot run in a Remix v1 app.
- **Vike + React 18 is blocked upstream**: `vike-react@0.6.31` declares `peer react ">=19"` / `peer react-dom ">=19"`, so React 18 is not supported there.
- **Astro** only instruments React/JSX modules: `.astro` markup gets no markers, so the overlay is available on pages that hydrate a React island.
- **RedwoodJS classic is upstream-blocked by Vite 5**: its `@redwoodjs/vite` package pins Vite 5, below this plugin's Vite 6+ range. The Vite-based **RedwoodSDK** is emerging and not yet in the matrix.
- **Waku** is still on `1.0.0-rc.x` (rc.4 at the time of writing), so it is deferred until a stable release.
- **Shopify Hydrogen** runs on React Router 7 and inherits the React Router v7 row rather than a separate matrix entry.
- **Next.js** has no Vite integration: `next dev` runs Turbopack (default in Next.js 16) or webpack with the SWC-based Next.js Compiler, so the plugin's transform, virtual client module and editor endpoint cannot be installed. React is not the blocker — Next.js 16.4.3 accepts React 18.2+ (Pages Router) and React 19 (App Router).

---

## How it works

1. **Source markers.** An `enforce: "pre"` Vite transform parses app modules with `@babel/parser` and inserts `data-ttc="<path>:<line>:<column>"` (plus `data-ttc-name` on component elements) after the last JSX attribute. Edits go through `magic-string`, so formatting and source maps are preserved. It runs before React Router's own route-module transform, so framework mode still gets raw TSX.
2. **Compiled-JSX fallback.** If another `pre` plugin compiled the module first, the plugin injects the same markers into the compiler's `jsxDEV(...)` calls (Babel and esbuild keep the original source object in development), so plugin order is not critical.
3. **Overlay delivery.** React Router never calls `transformIndexHtml`, so a module import is the only mechanism that works for both `index.html` apps and streamed SSR: client modules get `import "virtual:tab-to-components/client"`, which publishes a config and evaluates a tiny dependency-free DOM runtime.
4. **Resolution.** On click the runtime walks the React fiber tree (`__reactFiber$…` → `memoizedProps["data-ttc"]`) — the same stable technique React DevTools uses — and shows the source action picker. Choosing “Open in IDE” asks the dev server to open the chosen site; the dev server launches the configured editor (VS Code's `code` by default) through the plugin's `__ttc/open-in-editor` endpoint, or delegates to Vite's endpoint for `editor: "auto"`. The copy rows write the file name, relative path or `path:line:column` to the clipboard in the browser.

---

## Troubleshooting

**Nothing happens when I Alt+click.**
The plugin is dev-only. Make sure you run the dev server (not `vite preview`/`build`), that `tabToComponents()` is in `vite.config.ts` (or Astro's `vite.plugins`), and that the startup banner is printed. If the file you click lives in `node_modules` or is generated MDX output, it is intentionally not instrumented. Astro `.astro` markup is not instrumented either — only the React/JSX modules inside hydrated islands are.

**The editor does not open.**
The default editor is **VS Code** (`code`), so `code` must be on `PATH` (in VS Code: *Shell Command: Install 'code' command in PATH*). Watch the terminal for a `Could not launch "code"` message and the browser network tab for `__ttc/open-in-editor?file=…`. To use another IDE, pass `editor: "cursor"` / `"trae"` / `"webstorm"` / a command template / a function. To fall back to Vite's detection + `LAUNCH_EDITOR`, pass `editor: "auto"`. The toast shows the exact path to open manually.

**The line number is off by a constant on Vite 7.**
You are on `@vitejs/plugin-react` 4.x, which prepends its HMR preamble before the JSX transform. Upgrade to ≥ 5.1 or put `tabToComponents()` first in the plugins array.

**SSR HTML snapshots changed.**
The plugin annotates server-rendered markup by default so hydration stays consistent. Pass `ssr: false` to keep the server HTML untouched.

**I use a monorepo / custom `root`.**
Markers are relative to the Vite `config.root`. Run the plugin in the app's own Vite config, or scope it with `include`. `node_modules` and `/@fs/` paths outside the root are never instrumented.

**Production build?**
Nothing is injected. The plugin is `apply: "serve"`, and every hook independently refuses to run for a build command, so a stripped or wrapped plugin registration still cannot emit markers, the virtual client module or the browser runtime. The integration suite builds plain Vite and React Router 7/8 apps, `pnpm test:compat` builds the Astro, Vike, Remix and TanStack fixtures and scans their output, and `pnpm verify:package` repeats the check against the packed npm artifact.

---

## Limitations (by design)

- **`array.map()` rows** open the JSX inside the callback — the only location that exists in the source — not the row's data.
- **MDX and pre-compiled dependencies** are not instrumented; the component chain still includes the app-level usages that render them.
- **React Server Components** (`react-router/rsc`) are best-effort in 0.1: markers work, the overlay is client-only.
- **Astro** markers cover React/JSX modules in hydrated islands; `.astro` markup itself is not instrumented.
- **Vike** is supported with the `vike-react` renderer on React 19 only; React 18 is outside its peer range.
- **RedwoodJS classic**, **Waku** and **Shopify Hydrogen** are not separately tested: Redwood classic is upstream-blocked by Vite 5, Waku is still pre-1.0, and Hydrogen follows the React Router 7 row.
- **Remix v1** is not supported: it predates Remix's Vite integration and uses its classic esbuild compiler.
- **Next.js** is not supported: it runs its own Turbopack/webpack pipeline instead of Vite, so markers and the overlay cannot be injected.
- **React Router v8 + React 18** and **Remix v2 + React 19** are outside those frameworks' declared peer ranges, so the plugin does not claim them.
- Markers are dev-only `data-ttc` / `data-ttc-name` attributes: they are visible in dev HTML and the DOM, and never in production output.



---

## License

MIT © Reemo studio
