![tab-to-components banner](https://github.com/r48n34/tab-to-components/raw/main/docs/banner-minimal-dark.jpeg)

# tab-to-components — Chrome extension

A standalone **Manifest V3 Chrome extension** that brings the
[tab-to-components](https://github.com/r48n34/tab-to-components) "Alt+click to
source" workflow to **any React development server**, with **no Vite config and
no build plugin**. Install it once, run your React app, and Alt+click elements.

> This package is a port of the Vite plugin in
> [`packages/tab-to-components`](../tab-to-components). Both share the same
> overlay UX and the same action semantics; the extension works without touching
> the app's build, while the plugin additionally handles SSR/SSR frameworks and
> can open any editor process.

## What you get

| Action | Result |
| --- | --- |
| Hold <kbd>Alt</kbd> + move the mouse | The element under the cursor is outlined; a label shows `<Component />` and `file:line:column`. |
| <kbd>Alt</kbd> + left click | Source action picker for the nearest component usage site: **Open in IDE**, **Copy file name**, **Copy full path**, **Copy relative path**, **Copy location**. |
| <kbd>Alt</kbd> + right click | Component chain picker listing every JSX ancestor of the clicked element. |
| After an action | A toast confirms the file opened or the text copied. |

The page's own click handler is suppressed only when the clicked element really
has React source information, and no overlay DOM exists until the modifier is
held.

## Requirements

- Chrome/Chromium **111+** (the MAIN-world agent is injected with
  `chrome.scripting.registerContentScripts({ world: "MAIN" })`; current Chrome
  releases are fine).
- A page served from **http(s)://localhost:…** or **127.0.0.1** / **[::1]**
  (match patterns ignore ports). Other hosts are deliberately not injected.
- **Development builds** of React 18 or 19. Production builds carry no source
  information.
- For **React 19**, the dev server must serve JavaScript **source maps** (Vite
  does this automatically; Vite 8 is verified). React 18 does not need them.

## Install (load unpacked)

```bash
pnpm install
pnpm --filter tab-to-components-extension build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select:

```
packages/tab-to-components-extension/build/chrome-mv3-prod
```

Reload the extension after rebuilding. For development with automatic rebuilds
run `pnpm --filter tab-to-components-extension dev` and load
`build/chrome-mv3-dev` instead.

## Usage

1. Start your React dev server (any framework: plain Vite, React Router, Remix
   with Vite, Astro islands, …).
2. Hold <kbd>Alt</kbd> and move the mouse over the page. The outline and label
   appear on React elements.
3. <kbd>Alt</kbd> + click opens the source action picker; <kbd>Alt</kbd> +
   right click lists the component chain.
4. **Open in IDE** asks Chrome to hand the location to your editor's URL scheme
   (`vscode://`, `cursor://`, …). Chrome may show an "Open …?" confirmation the
   first time; allow it to keep using the protocol.

Keyboard: <kbd>↑</kbd>/<kbd>↓</kbd>, <kbd>Home</kbd>/<kbd>End</kbd>,
<kbd>Enter</kbd>/<kbd>Space</kbd>, <kbd>Esc</kbd> work in both pickers.

## Settings

Open the toolbar popup for quick controls, or the options page for everything.
Settings are stored in `chrome.storage.local` under `ttc:settings:v1` and apply
live to open tabs.

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `disabledOrigins` | `[]` | Origins where the overlay is off. |
| `keyboard` | `["alt"]` | Modifier(s) that arm the inspector; all must be held. |
| `open` | `"component"` | What Alt+click targets: `component`, `element`, or `menu` (chain picker). |
| `clickActions` | `["open","copy-file","copy-full-path"]` | Rows in the action picker, in order. A single row runs immediately. |
| `menu` | `true` | Enable the Alt+right-click chain picker. |
| `theme` | `"dark"` | Overlay theme (`dark` or `light`). |
| `showWhenVitePluginActive` | `false` | Idle when the Vite plugin's own overlay is detected; enable to run both. |
| `editor` | `vscode` | IDE preset (`vscode`, `cursor`, `windsurf`, `vscodium`, `zed`, `sublime`, `jetbrains`) or a custom URL template. |
| `projectRoots` | `{}` | Origin → absolute project root, used when a location has no absolute path (e.g. Vite-plugin markers). |
| `debug` | `false` | Verbose console logging. |

### Copy actions

| Action | Clipboard content |
| --- | --- |
| `copy-file` | `MyBox.tsx` |
| `copy-path` | `app/components/MyBox.tsx` |
| `copy-full-path` | `D:/proj/app/components/MyBox.tsx` |
| `copy-location` | `app/components/MyBox.tsx:12:5` |

### Editor URL templates

| Preset | Template |
| --- | --- |
| VS Code | `vscode://file/{path}:{line}:{column}` |
| Cursor | `cursor://file/{path}:{line}:{column}` |
| Windsurf | `windsurf://file/{path}:{line}:{column}` |
| VSCodium | `vscodium://file/{path}:{line}:{column}` |
| Zed | `zed://file/{path}:{line}:{column}` |
| Sublime Text | `subl://open?url=file://{path}&line={line}` |
| JetBrains (experimental) | `jetbrains://idea/navigate/reference?path={path}&line={line}` |
| Custom | any URL template using `{path}`, `{file}`, `{fileUri}`, `{line}`, `{column}` |

`{path}` is the absolute path, `{file}` the project-relative path, `{fileUri}`
a `file:///…` URI. The target IDE must register its URL handler (installing the
IDE normally does this). Custom templates are validated: `javascript:`, `data:`,
`file:` and other navigation/script schemes are rejected.

## How it works

An extension cannot add props during the dev server's transform, so the
extension reads React's runtime metadata instead:

```
MAIN world (contents/agent.ts)              ISOLATED world (contents/inspector.ts)
┌──────────────────────────────┐            ┌──────────────────────────────────────┐
│ React fiber tree             │  events    │ overlay (shadow DOM, same UI as the  │
│ capture-phase listeners      │ ─────────▶ │ plugin)                              │
│ synchronous fiber walk       │            │ source resolution (3 layers)         │
│ click suppression            │ ◀───────── │ clipboard + IDE URL launch           │
└──────────────────────────────┘  config    │ settings via chrome.storage          │
                                            └──────────────────────────────────────┘
```

Source locations are recovered per fiber, deepest layer first:

1. **Vite plugin markers** — if the app happens to use the published plugin,
   `memoizedProps["data-ttc"]` already carries the exact project-relative
   location (works even with the plugin's overlay disabled).
2. **React 18 `_debugSource`** — the compiler source object
   (`{ fileName, lineNumber, columnNumber }`), with an absolute path.
3. **React 19 `_debugStack` + source maps** — React 19 ignores the JSX source
   argument and instead captures a stack at element creation. The first
   application frame points at the compiled `_jsxDEV(...)` call; the dev
   server's source map (Vite inlines it in each module) maps that generated
   position back to the original JSX site.

Vite's dev source maps often carry only a server-relative `sources` entry and no
absolute `file` (Vite 7 and 8 on Windows do exactly that), so the map alone is
not enough to build an editor URL. The extension therefore also recovers the
absolute path the bundler embedded in the transformed module
(`_jsxFileName`, the react-refresh `RefreshRuntime.register(...)` call, or
esbuild's `fileName`), derives the project root from it, and uses that root for
every other location on the page — including the Vite plugin's
project-relative `data-ttc` markers. **"Open in IDE" therefore emits a full
absolute URL such as
`vscode://file/C:/Users/me/proj/src/App.tsx:20:9` without configuring a
project root.**

The agent is injected into every frame; the inspector runs in the isolated
world so it can use `chrome.storage`, the clipboard and `chrome.runtime`.

### Safety model

- Only loopback origins are matched: `localhost`, `127.0.0.1`, `[::1]`
  (http and https). No `<all_urls>` and no network requests outside the page's
  own origin.
- The page is treated as untrusted: every agent payload is shape- and
  size-validated, paths are checked for traversal/control characters, editor
  URLs are scheme-allowlisted and length-capped, and launches are rate-limited.
- Source-map fetches are same-origin only, time out after 3 s, and are capped.
- No `eval`, no remote code, no telemetry.

## Differences from the Vite plugin

| | Extension | Vite plugin |
| --- | --- | --- |
| App changes | none | add plugin to Vite config |
| Location source | React runtime metadata (React 18) / dev source maps (React 19) | `data-ttc` attributes injected at transform time |
| Open in IDE | IDE URL schemes + Chrome's protocol prompt | dev server launches any editor command |
| Click actions | five built-in path/copy rows | the same five rows plus per-IDE actions, AI/share presets (`copy-ai-context`, `copy-mention`, `copy-markdown`, `copy-chain`) and team-defined `customActions` templates |
| Supported frameworks | any React dev server (Vite verified) | Vite-based frameworks, including SSR |
| SSR-safe markers | n/a | yes (`data-ttc` identical server/client) |
| Requires dev source maps | React 19 only | no |

The two can be used together: when the plugin's overlay is detected the
extension stays idle (override with `showWhenVitePluginActive`, which also hides
the plugin's overlay). With the plugin installed as `overlay: false` (markers
only), the extension uses the plugin's exact markers and still provides its own
UI.

## Troubleshooting

**"Nothing happens" on an app that also uses the Vite plugin.**
The popup says *"Vite plugin overlay active (idle)"*. That is by design: the
extension yields to the plugin's overlay, and the plugin's Alt+click asks the
**dev server** to launch the editor. If that does not open your IDE (or the dev
server runs in Docker/WSL), either:

- click **"Take over from the Vite plugin"** in the extension popup (it hides
  the plugin overlay and opens `vscode://` on this machine), or
- set `overlay: false` in the plugin options (`tabToComponents({ overlay:
  false })`) so only the extension provides the UI, or
- enable **Options → Advanced → Take over from the Vite plugin overlay**.

**Nothing happens.**
The page must be a loopback dev server (`localhost`, `127.0.0.1`, `[::1]`) and a
**development** React build. Reload the page after installing/reloading the
extension so the agent registers. The popup shows whether React and the
inspector were detected.

**"No source location available" on React 19.**
The dev server did not serve a source map for that module, or React's owner
stack capture was rate-limited (React captures real stacks for 10k elements per
second; it resets after ~1s). Hover again after a moment. Vite always serves
maps; React 18 is unaffected.

**The label shows an absolute path instead of a project-relative one.**
React 18 has no project-relative path in its metadata. Set a project root for
that origin in the options page, or use the Vite plugin's markers.

**"Open in IDE" does nothing.**
The IDE's URL handler is missing or Chrome blocked the external protocol. Allow
the protocol in Chrome's prompt (or chrome://settings/handlers), make sure the
IDE is installed, and use the copy actions as a fallback.

**"Open in IDE" says it needs a project root.**
The extension could not recover an absolute path: the dev server's source map
has no absolute path *and* the transformed module does not embed one (some
non-Vite servers strip `_jsxFileName`/`fileName`). Set a project root for the
origin in the options page, or use the copy actions. Vite 7/8 dev servers on
Windows/Linux are handled automatically.

**Two overlays appear.**
The Vite plugin's overlay was detected late. Reload the page, or disable the
plugin's overlay (`overlay: false`) and keep the extension UI.

**A React Router/Remix/Astro app shows no source for some files.**
Only JSX/TSX modules instrumented by the dev server are visible. `.astro`
markup, MDX output and precompiled dependencies are not.

## Limitations

- Chrome MV3 only; Firefox/Safari and the Chrome Web Store are not covered.
- Loopback origins only. LAN IPs, custom dev hostnames and HTTPS with
  self-signed certificates are not injected.
- React 19 depends on development source maps; production builds, minified
  bundles and HMR-disabled servers may not resolve.
- Non-Vite dev servers (webpack, Next.js) are best effort and not verified.
- Editor launching relies on the editor's URL scheme; there is no native
  companion that runs editor commands.
- `array.map()` rows open the JSX inside the callback (the only location in the
  source), exactly like the plugin.

## Development

```bash
# from the repo root
pnpm --filter tab-to-components-extension dev        # Plasmo dev build + reload
pnpm --filter tab-to-components-extension build      # production MV3 build
pnpm --filter tab-to-components-extension typecheck  # tsc --noEmit
pnpm --filter tab-to-components-extension test       # vitest
node packages/tab-to-components-extension/scripts/verify-build.mjs
```

This repo is developed in a locked-down Windows sandbox where Vite's config
loader shells out (`net use`) and fails with `spawn EPERM`. Run test/typecheck
commands with the repo shim when you hit that:

```powershell
$node = 'C:\Users\devre\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$shim = 'file:///D:/Github/tab-to-components/scripts/sandbox-shim.mjs'
cd packages/tab-to-components-extension
& $node --import $shim ../../node_modules/vitest/vitest.mjs run
```

The production build works in the sandbox without the shim (Plasmo/Parcel uses
worker threads).

### Tests

- `test/source/*` — path safety, stack parsing, React 18 source objects, real
  Vite source-map fixtures (`test/fixtures/vite-react19-module.ts` and
  `test/fixtures/vite-react19-no-map-file.ts`), layered resolution.
- `test/agent/*` — fiber discovery/naming, chain walk, modifier handling.
- `test/install.test.ts` — happy-dom integration of the overlay controller
  (hover label, action/chain menus, copy/open flows, protocol messages).
- `test/ui/overlay.test.ts` — overlay DOM/CSS/keyboard contract.
- `test/editor.test.ts`, `test/settings.test.ts`, `test/protocol.test.ts`,
  `test/actions.test.ts`, `test/chain.test.ts`, `test/clipboard.test.ts`,
  `test/content-config.test.ts` — helpers and static content-script config.

The fixtures are generated from `playground/vite-react/src/App.tsx` through
Vite 8 + `@vitejs/plugin-react` 6; their expected positions
(`src/App.tsx:9:5`, `10:7`, `20:9`) are exactly the markers the Vite plugin
injects, which is the parity guarantee for the React 19 source-map path.
`vite-react19-module.ts` keeps a hand-canonicalized absolute `file` in the map;
`vite-react19-no-map-file.ts` matches what Vite 7/8 actually serve in dev — no
`file`, relative `sources` — so the absolute path can only come from the
transformed code (`_jsxFileName` / `RefreshRuntime.register`).

### Manual QA checklist (Chrome)

1. Build and load `build/chrome-mv3-prod` unpacked.
2. Start `pnpm --dir playground/vite-react dev:ext` (the same app **without**
   the Vite plugin) and open the printed URL.
3. Alt+hover the button → `<Button /> src/App.tsx:20:9`; Alt+click → picker;
   each copy action writes the exact text; Alt+right-click lists
   `<button /> → <Button /> → <FeatureCard /> → <App />`.
4. Open in IDE prompts for VS Code and opens the file at line 20 — with **no
   project root configured**. The launched URL must be a full absolute path,
   e.g. `vscode://file/C:/Users/me/proj/src/App.tsx:20:9` (Windows) or
   `vscode://file/home/me/proj/src/App.tsx:20:9` (macOS/Linux); a relative
   `vscode://file/src/App.tsx` means absolute-path recovery regressed.
5. HMR edit `App.tsx`, save, hover again → updated line.
6. Repeat with React 18:
   `pnpm --dir compat/react18/apps/vite exec vite --config vite.ext.config.ts`.
7. Run `pnpm --dir playground/vite-react dev` (plugin enabled) → the extension
   stays idle and the plugin's overlay handles Alt+click.
8. Non-React page on localhost → no overlay, Alt+click is not suppressed.
9. Production site (not localhost) → extension is not injected at all.

## License

MIT © Reemo studio
