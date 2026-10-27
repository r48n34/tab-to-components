# Changelog

All notable changes to `tab-to-components` are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Overlay

- Every row of the source action picker and the component chain picker now leads with a small icon for what it acts on: an external link for **Open in IDE**, a page for **Copy file name**, a folder or a hard drive for the relative/full path, a pin for the **file:line:column** location, and a stacked box for chain rows. The icons are hand-drawn `aria-hidden` SVGs rendered inside the existing shadow root, so app CSS cannot affect them, they need no font or network request, and the rows' text content (the copy targets, toasts and e2e selectors) is unchanged.

### Compatibility matrix

- Added Next.js to the compatibility matrix as **not applicable** for React 18 and React 19. `next dev` runs Turbopack (default in Next.js 16) or webpack with the SWC-based Next.js Compiler, not Vite, so the marker transform, virtual client runtime and `__ttc/open-in-editor` endpoint cannot be installed. Next.js 16.4.3 accepts React 18.2+ for the Pages Router and React 19 for the App Router — the React version is not the blocker.
- Both READMEs and the generated matrix now describe Next.js alongside Remix v1 as a non-Vite framework (10-framework × 2-React table).

### Astro and Vike

- **Astro 7 works with React 18 and React 19.** Tested Astro 7.4.2 + `@astrojs/react` 7.1.1 (Vite 8.3.5) with React 18.3.1 and React 19.3.1 in the isolated `compat/astro-react18` and `compat/astro-react19` fixtures. The plugin is installed through Astro's `vite.plugins` option in `astro.config.mjs`, and both the dev server and the production build run through Astro's documented JavaScript API (`dev()` / `build()`). For both majors: version isolation, dev server, source markers, overlay module, SSR markup, the shared React fiber/Alt+click runtime check and the production-build cleanliness scan all pass. `.astro` markup is not instrumented — only React/JSX modules inside hydrated islands are — and `data-ttc-name` reaches SSR HTML only when the component forwards props to a DOM node.
- **Vike 0.4 works with React 19; React 18 is blocked upstream.** Tested Vike 0.4.268 + `vike-react` 0.6.31 on React 19.3.1 (Vite 8.3.5) in `compat/vike-react19`. Version isolation, dev server, markers, overlay module, SSR markup, the shared runtime check and a production scan of both `dist/client` and `dist/server` all pass; no dev-only strings reach the build. `vike-react@0.6.31` declares `peer react ">=19"` / `peer react-dom ">=19"`, so no React 18 fixture exists.
- **Edge frameworks were evaluated but not added as matrix cells.** RedwoodJS classic is upstream-blocked by Vite 5: its `@redwoodjs/vite` package pins Vite 5.4.20, below this plugin's Vite 6–8 peer range (the Vite-based RedwoodSDK is still emerging). Waku is on `1.0.0-rc.x` (1.0.0-rc.4 at the time of writing) and is deferred until a stable release. Shopify Hydrogen is built on React Router 7, so it inherits the React Router v7 row rather than a separate entry. None of these three was tested, and no fixture was created.
- **Honest matrix status:** the verified 20-cell run (10 frameworks × 2 React majors) reports **13 tested (12 works, 1 works-not-verified), 0 failing**, 3 upstream-unsupported cells and 4 not-applicable cells. The works-not-verified cell is Remix v2 on React 18, whose dev/build/SSR checks need esbuild, which this sandbox blocks. Every Browser cell is reported as ⏭ skipped, never passed: the Astro/Vike fixtures do not implement the counter + three-row action-picker contract that the Chrome e2e runner asserts, and headless Chrome could not run in this environment for any cell. The shared Runtime ✅ is the generic React fiber/Alt+click harness check, not framework-specific browser hydration.
- `pnpm test:compat` now builds and scans the Astro and Vike fixtures, `pnpm install:compat` installs **seven** isolated fixture roots, and CI caches all seven lockfiles.
- Documentation: both READMEs gained Astro and Vike setup snippets, a 10-framework compatibility table, the React 18/19 and `.astro` constraints, the Vite 5/RedwoodSDK/Waku/Hydrogen notes and updated reproduce commands. `docs/compatibility-matrix.md` was regenerated from the verified run's recorded JSON (package `0.4.1`) with the browser-tier provenance stated explicitly.

## 0.4.1 - 2026-10-25

Security and reliability release; no API changes.

### Editor launching (Windows)

- Fixed command injection through the editor command line: the editor executable is now resolved to an absolute path (never from the project directory), `.exe`/`.com` binaries are spawned without a shell, and `.cmd`/`.bat` shims go through `cmd.exe /d /s /c` with every token escaped (`& | < > ^ ( )` caret-escaped, `%` and CR/LF rejected). A project or dependency filename containing `&` can no longer run a second command when the source is opened.
- Refuse to launch an executable planted inside the project directory, closing the `code.cmd` binary-planting path.

### Dev-server endpoint

- Reject cross-origin requests to the editor endpoint (`Sec-Fetch-Site: cross-site/same-site` or a mismatched `Origin`) so a visited web page cannot trigger a drive-by editor launch or spawn storm.
- Coalesce rapid duplicate launches and cap the launch rate (`429` above 20 launches / 5 s).
- Log a warning when the dev server is exposed beyond localhost, since the endpoint is reachable by other devices.
- `editor: "auto"`: the plugin now validates `/__open-in-editor` requests against the project root before delegating to Vite, so a page-authored `data-ttc` path cannot open files outside the project.

### Browser runtime

- Validate source markers before opening: absolute paths, UNC paths, `..` traversal and invalid line/column values are refused instead of being sent to the dev server (defense in depth for `data-ttc` attributes authored by app markup).

### Transform

- The compiled-JSX fallback now only rewrites genuine `jsxDEV`/`jsx`/`jsxs` calls (including Babel aliases). Unrelated five-argument calls with a source-like object are no longer given `data-ttc` props, and `null` props are only replaced on a confirmed JSX call.

### Release and CI

- `prepublishOnly` now runs a release guard: a clean tracked tree and a `v<version>` tag at HEAD are required. Adds a tag-driven release workflow that publishes with npm provenance.
- CI: actions pinned to commit SHAs, least-privilege `permissions`, `persist-credentials: false`, job timeout, and an audit of the published package's production dependencies.
- Documentation: the `editor: "auto"` section documents the Vite/`launch-editor` advisory windows; the custom-launcher example URL-encodes its parameters; both READMEs updated.

### Upgrade notes

The public API, options, DOM attributes and output formats are unchanged; these are the observable security-driven behavior changes:

- The editor endpoint now returns `403` for cross-origin browser requests (`Sec-Fetch-Site: cross-site`/`same-site`, or an `Origin` that does not match the dev-server host), and `429` above 20 launches in 5 seconds. Rapid duplicate requests for the same file are coalesced into one launch.
- With `editor: "auto"`, requests to `/__open-in-editor` for files outside the Vite project root now return `400` instead of opening them.
- Source markers written as absolute paths, UNC paths or with `..` segments are refused by the browser runtime instead of being sent to the dev server. Markers generated by the transform are unaffected.
- On Windows, a bare `editor` command must be resolvable on `PATH` (or be given as an absolute path); an executable inside the project directory is no longer used. `.exe` editors are spawned without a shell and `.cmd`/`.bat` shims are escaped.
- `vite preview` is still not supported for the overlay/endpoint (unchanged); dev-only output remains absent from production builds.

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
- Added `pnpm install:compat` for the four isolated compatibility workspaces and ignored their generated build/cache directories. The fixtures link the package (`link:`) instead of installing a packed `file:` copy, so a clean checkout no longer snapshots the package before `dist/` exists and the matrix always tests the current `pnpm build`.
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
