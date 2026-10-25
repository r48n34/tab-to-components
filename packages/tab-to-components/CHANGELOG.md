# Changelog

All notable changes to `tab-to-components` are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## 0.4.0 - 2026-10-25

### Source action picker

- <kbd>Alt</kbd>+left click now opens a small **source action picker** instead of opening the editor immediately. The default rows are **Open in IDE**, **Copy file name** (`MyBox.tsx`) and **Copy full path** (`D:/proj/app/components/MyBox.tsx`), so the source file can be pasted into a chat, issue, bug report or terminal.
- New `clickActions` option controls the picker rows, in order: `"open"`, `"copy-file"` (bare `MyBox.tsx`), `"copy-path"` (project-relative `app/components/MyBox.tsx`), `"copy-full-path"` (absolute path, built from the Vite project root) and `"copy-location"` (`app/components/MyBox.tsx:12:5`). Accepts a single value. Passing one action skips the picker and runs it immediately, so `clickActions: ["open"]` keeps the earlier instant-open workflow.
- Copying uses `navigator.clipboard.writeText()` and falls back to `document.execCommand("copy")` when the Clipboard API is unavailable or denied. A toast confirms the copied text; if copying fails, the toast shows the text so it can be copied manually.
- “Copy full path” joins the injected Vite project root with the marker path, so it is the path on the dev-server machine; file names and relative paths stay portable across machines.
- The picker shares the chain picker's keyboard support (<kbd>↑</kbd>/<kbd>↓</kbd>, <kbd>Home</kbd>/<kbd>End</kbd>, <kbd>Enter</kbd>/<kbd>Space</kbd>, <kbd>Esc</kbd>) and never reaches the app's own click handler.
- `clickActions` is injected into the browser config and is ignored for `open: "menu"` (that mode keeps the component chain picker on left click). The component chain picker itself is unchanged for users.
- `DEFAULT_CLICK_ACTIONS`, `TabToComponentsClickAction` and `TabToComponentsTheme` are exported from the package entry point.

### Light theme

- New `theme` option: `"dark"` (default, the original blue-on-black overlay) or `"light"` (white surfaces with darker blue accents for contrast). It themes the hover label, the source action picker, the component chain picker and the toasts. The value is injected into the browser config and exposed as a `data-ttc-theme` attribute on the overlay host.
- The overlay palette now lives in CSS custom properties inside the shadow root, so both themes share one stylesheet and still cannot leak into — or be restyled by — the app's own CSS.

### Framework and React compatibility

- Expanded the tested support matrix to **React 18.3 and 19.3**, **Vite 6, 7 and 8**, **React Router v6 (SPA)**, **React Router v7/v8 framework mode (including streamed SSR)**, **TanStack Start (SSR)** and **Remix v2 (Vite 6, React 18)**. The package description, keywords and both READMEs now advertise the wider matrix, with TanStack Start and Remix v2 setup snippets and the known upstream constraints.
- Added isolated compatibility workspaces under `compat/` (React 18 Vite / React Router v7 / TanStack Start, React Router v6 on React 18 and 19, and Remix v2 on React 18) so each framework resolves its own exact React copy instead of a hoisted one.
- Added a sixth playground, `playground/compat-tanstack-start-react19`, for the React 19 TanStack Start row.
- New `scripts/compat-matrix.mjs` (`pnpm test:compat`) resolves the installed versions, boots each fixture's own Vite dev server, checks markers/overlay injection and SSR markup, exercises the real-React fiber walk with happy-dom, builds the fixture for production and scans the output for dev leakage. `pnpm test:compat:full` adds the headless-Chrome Alt+click tier and regenerates `docs/compatibility-matrix.md`.
- `pnpm gate` and CI now run the compatibility matrix; CI installs the isolated compatibility workspaces and caches each `compat/*/pnpm-lock.yaml`.

### Tests and tooling

- Unit suite: 342 → 379 tests (17 → 19 files; one POSIX-only case is skipped on Windows). Integration suite: 29 tests. Vite 7/8 matrix: 18 tests. Compatibility matrix: 10 verified cells, 2 blocked upstream and 2 not applicable.
- Added unit coverage for the action picker (mouse + keyboard, every copy action, single-action fast path, clipboard failure) and the clipboard helper.
- Added unit coverage for theme resolution in the plugin and browser config, and for the theme attribute and both palettes on the overlay host.
- Added coverage for the new marker helpers (`fileNameOf`, `resolveFullPath`), ordered/deduplicated `clickActions`, and the injected action/theme config.
- The headless-Chrome e2e now opens the picker, copies the page file name and full path, verifies the exact clipboard text before choosing Open in IDE, and exports its helpers so the compatibility matrix reuses the same browser flow.
- The React 18/19 compatibility runtime check pins `clickActions: ["open"]` to keep that check focused on the fiber walk.
- The `rr8` playground now exercises every click action and the light theme.
- Added `pnpm install:compat` for the four isolated compatibility workspaces and ignored their generated build/cache directories.
- Raised the `verify:package` packed-payload budget from 112 KiB to 120 KiB to fit the source actions, the theme palette and the documentation (the packed artifact is 118.5 KiB).

### Documentation

- Both READMEs gained **Copy source paths** and **Theme** sections, `clickActions` / `theme` rows in the options table, TanStack Start and Remix v2 setup snippets, the expanded compatibility table and a link to the generated compatibility matrix.
- The new `docs/compatibility-matrix.md` records the full 7-framework × 2-React evidence table, per-check results, resolved versions, reproduction commands and the upstream constraints: React Router v8 requires React ≥ 19.2.7, Remix v2 requires React 18 and Vite 5/6, and Remix v1 has no Vite integration.

## 0.3.0 - 2026-10-25

### Dev-only hardening

- Added a second, independent build-mode guard to every plugin hook. `apply: "serve"` remains the primary gate, but if a wrapper re-registers the plugin for `vite build` (for example with `apply` stripped), `configResolved`, `transform`, `resolveId`, `load` and `configureServer` now stay inert. No markers, virtual imports or browser runtime can reach a production build.
- `virtual:tab-to-components/client` now resolves only from a running dev server. A production build that imports it fails to resolve instead of bundling the overlay.
- The custom editor middleware is only registered for a dev server.
- The npm exports map keeps `dist/client.js` non-importable from application code; `verify:package` asserts it.

### Cross-platform paths

- Reworked Vite id resolution to be independent of the host platform. Windows drive-letter paths, UNC paths and POSIX roots are normalized lexically, so the same ids resolve on Windows and Linux CI.
- `parseEditorTarget` and `editorNameOf` no longer rely on host-specific `path` semantics; Windows, POSIX and `file://` targets are validated consistently.
- `/@fs/` ids, root-relative URLs and query strings are handled the same way under Windows and POSIX roots.
- Added POSIX-root coverage for module resolution, editor targets and `/@fs/` paths.

### Tests and tooling

- Unit suite: 225 → 342 tests (17 files); integration suite: 26 → 29 tests.
- Added `pnpm test:dev-only` (41 tests): hook-level build guards, virtual module ids/config prelude, and the editor middleware (methods, base paths, traversal, invalid targets, launcher failures).
- Added a production-build integration test that force-enables the plugin with `apply` stripped and scans the output for dev-only artifacts.
- `verify:package` now builds the exact packed artifact in production, proves no dev runtime leaks, verifies the virtual module cannot resolve, and blocks client subpath imports.
- Expanded coverage for path styles, editor parsing/presets, transform edge cases, plugin options, and client hover/boot behavior.
- GitHub Actions: checkout v5, setup-node v5, pnpm/action-setup v6; CI no longer relies on the deprecated Node 20 action runtime.

### Documentation

- Added a “Dev-only by construction” section to the package README and explained the new production-build gates.
- Added demo screenshots of the hover overlay and the component-chain picker to both READMEs.
- Refreshed the test/packaging counts in `PUBLISHING.md` and the README development commands.

## 0.2.0 - 2026-10-25

### Packaging

- The npm artifact is roughly a third smaller, with no runtime behavior change:
  - source maps are no longer published — they referenced `src/`, which the package never ships;
  - the browser runtime (`dist/client.js`) is now minified.
- Published artifact: 37 files / 144 kB unpacked (~41 kB tarball) → 21 files / ~88 kB unpacked (~28 kB tarball).

## 0.1.0

First public release (published as `tab-to-components`).

- Dev-only Vite plugin: hold <kbd>Alt</kbd>, hover to outline an element, <kbd>Alt</kbd>+click to open its JSX source in the editor.
- <kbd>Alt</kbd>+right-click component chain picker with keyboard navigation.
- Source markers injected into raw JSX **and** into already-compiled `jsxDEV(...)` calls, so plugin order does not matter.
- Client runtime injected as a module import — works with React Router v7/v8 framework mode (streamed SSR, SPA mode) and plain Vite, without touching `entry.client.tsx`.
- Supports React 19 (and React 18.3+), Vite 7 and Vite 8.
- **VS Code is the default editor:** with no configuration the plugin launches `code -r -g <file>:<line>:<column>` on the dev-server machine.
- **Choose your IDE:** `editor: "cursor"`, `"trae"`, `"webstorm"`, `"zed"`, `"subl"`, `"vim"`, … built-in presets; any other command is launched as `<command> <file>:<line>:<column>`; command templates with `{file}`/`{line}`/`{column}` placeholders; explicit `{ command, args }`; or a custom launcher function. `editor: "auto"` opts back into Vite's `/__open-in-editor` auto-detection and `LAUNCH_EDITOR`.
- Custom editor requests are served by the plugin's own `__ttc/open-in-editor` endpoint, which refuses paths outside the Vite project root.
- Source maps reference absolute source files, so Vite never warns about missing source maps for instrumented modules.
- Configurable keyboard modifier, open mode, overlay delivery, SSR annotation and include/exclude filters.
- Nothing is emitted into production builds.
