# Changelog

All notable changes to `tab-to-components` are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## 0.5.0 - 2026-10-28

Feature release: icon-led overlay menus, extensible click actions with AI/share presets, a wider verified compatibility matrix, and a companion Chrome extension in the monorepo. Defaults, existing options and output formats are unchanged; the new `customActions` option and eight new `clickActions` values are additive.

### Click actions

**Extensible, copy-only custom actions.** The new `customActions` option appends team-defined rows after the built-in `clickActions` rows. Each entry is JSON-serializable — `{ id, label, copy, icon? }` — and `copy` is a template expanded in the browser from the clicked source marker and component chain: `{file}`, `{absPath}`, `{name}`, `{line}`, `{column}`, `{location}` and `{chain}`. Unknown `{tokens}` are left untouched so a template can still contain literal braces. Up to 12 rows are kept; ids must be unique and URL-safe, labels are capped at 80 characters and templates at 600, and malformed entries are dropped when the options resolve. The expanded text is produced in the browser and is never sent back to the dev server, and custom rows are copy-only: they cannot open files or run commands. (Templates are read from the Vite config and injected into the browser config; only the resulting clipboard value stays local.) Rows render as `data-action="custom:<id>"` and their toast shows a one-line preview (`Copied: …`).

**AI and share presets.** Four new `clickActions` values cover pasting context into a chat, an issue or an AI coding tool: `"copy-ai-context"` copies a markdown block with the target and a numbered `Component chain (outermost → innermost):` list; `"copy-mention"` copies `@path:line:column`; `"copy-markdown"` copies an inline reference such as `` `<MyBox />` — `app/components/MyBox.tsx:12:5` ``; `"copy-chain"` copies the chain names outermost first, including the clicked host element (`App > Card > MyBox > button`). They add three menu icons — a four-point sparkle, an at-sign and a markdown badge — while the chain row reuses the stacked-box icon. Display names and copied path fragments are sanitized before they reach the clipboard (control and bidi characters stripped; whitespace collapsed and a 120-character cap for names), and the AI/share/custom clipboard values are capped at 4,000 characters. The default picker rows are unchanged.

**Per-IDE open actions.**

- Four new `clickActions` values open the source at `file:line:column` in a specific IDE on the dev-server machine: `"open-code"` launches `code` (VS Code), `"open-cursor"` launches `cursor`, `"open-webstorm"` launches `webstorm` and `"open-trae"` launches `trae`. WebStorm receives the JetBrains CLI arguments; the other three use the VS Code-family `-r -g <file>:<line>:<column>` arguments.
- Each per-IDE row is independent of the `editor` option: `editor` still controls the plain `"open"` row, and `editor: "auto"` keeps working there. The IDE command must be launchable from the dev-server machine — on `PATH`, or reachable as that command; a missing IDE shows a copyable error toast such as `Could not open in WebStorm. Copy: D:/proj/app/components/MyBox.tsx:12:5` and logs the failure in the terminal.
- No defaults or existing behavior changed: `clickActions` still defaults to `["open", "copy-file", "copy-full-path"]`, existing options, URLs, DOM attributes and toasts are unchanged, `clickActions` and `customActions` are still ignored for `open: "menu"`, and a single configured row still skips the picker when no custom actions are configured (`clickActions: ["open-cursor"]` opens Cursor immediately).

### Overlay

- Every row of the source action picker and the component chain picker now leads with a small icon for what it acts on: an external link for **Open in IDE**, a page for **Copy file name**, a folder or a hard drive for the relative/full path, a pin for the **file:line:column** location, and a stacked box for chain rows. The icons are hand-drawn `aria-hidden` SVGs rendered inside the existing shadow root, so app CSS cannot affect them, they need no font or network request, and the rows' text content (the copy targets, toasts and e2e selectors) is unchanged.

### Companion Chrome extension

- New private package `packages/tab-to-components-extension` (Manifest V3, Plasmo 0.90.5) brings the Alt+click workflow to **any** local React dev server **without a Vite config or build plugin**. It reads React's runtime metadata instead of injected props: React 18 locations come from fiber `_debugSource`, and React 19 recovers them from `_debugStack` plus the dev server's source maps.
- Vite 7/8 dev source maps carry no absolute path, so the extension also recovers the absolute file the bundler embedded in the transformed module (`_jsxFileName`, react-refresh `RefreshRuntime.register`, or esbuild's `fileName`) and derives the project root from it. “Open in IDE” therefore emits a full URL such as `vscode://file/C:/Users/me/proj/src/App.tsx:20:9` without configuring a project root. The React 19 fixtures are generated from the plugin's playground and assert the same `src/App.tsx:9:5`, `10:7` and `20:9` positions the plugin's `data-ttc` markers carry.
- The isolated-world overlay shares the plugin's source action picker, component chain picker, copy actions, theme and keyboard model; settings live in `chrome.storage.local` under `ttc:settings:v1` and apply live. The editor is opened through IDE URL schemes (VS Code, Cursor, Windsurf, VSCodium, Zed, Sublime, experimental JetBrains, or a custom template) instead of launching a process on the dev-server machine.
- Safety model: loopback-only host permissions (`localhost`, `127.0.0.1`, `[::1]`), same-origin source-map fetches only, shape/size validation of every agent payload, traversal and control-character path rejection, editor-scheme allowlisting, URL length caps and rate-limited launches; no `eval`, no remote code and no telemetry. The package is private and is not published to npm or the Chrome Web Store.
- Coexists with the plugin: the extension idles when the plugin's overlay is detected (`showWhenVitePluginActive` overrides), and with the plugin installed as `overlay: false` it reuses the plugin's exact `data-ttc` markers and supplies its own UI.
- The extension keeps its five built-in path/copy actions; the new per-IDE actions, AI/share presets and `customActions` templates are plugin-only in this release. Its README records the difference.
- Root scripts `dev:extension`, `build:extension`, `test:extension`, `verify:extension` and `gate:extension`, plus the plugin-free `vite.ext.config.ts` configs used by the manual Chrome QA checklist. A dedicated CI job typechecks, tests, builds the Plasmo production bundle and runs `scripts/verify-build.mjs` (manifest and bundle contract).

### Compatibility matrix

- Added Next.js to the compatibility matrix as **not applicable** for React 18 and React 19. `next dev` runs Turbopack (default in Next.js 16) or webpack with the SWC-based Next.js Compiler, not Vite, so the marker transform, virtual client runtime and `__ttc/open-in-editor` endpoint cannot be installed. Next.js 16.4.3 accepts React 18.2+ for the Pages Router and React 19 for the App Router — the React version is not the blocker.
- Both READMEs and the generated matrix now describe Next.js alongside Remix v1 as a non-Vite framework (10-framework × 2-React table).

### Vite 5 support

- **Peer range widened to include Vite 5.** `vite` is now `^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0`, and the package description advertises **Vite 5-8**. This is a semver-minor, additive change: existing Vite 6/7/8 support, options, endpoints, DOM attributes and output formats are unchanged.
- **Vite 5 is covered by the version matrix on React 18 and React 19.** Two playgrounds pin `vite@5.4.21` with `@vitejs/plugin-react@4.7.0`: `playground/vite-react-vite5` (React 19.3.1) and `playground/vite-react-vite5-react18` (React 18.3.1). The version-matrix suite gains a Vite 5 tier that runs on both React majors next to the existing Vite 7 tier (React 19), covering dev-server marker/overlay injection, SSR transform requests, production-build cleanliness and plugin orderings; the two apps are also entries in the browser e2e runner. The main integration suite keeps Vite 8.
- **Vite 5 plugin order.** On Vite 5, list `tabToComponents()` **before** `@vitejs/plugin-react` 4.x. plugin-react 4.x prepends its Fast Refresh preamble before the JSX transform and shifts the source positions it reports when it runs first — the same mechanism as the Vite 7 4.x caveat, now documented for Vite 5 as well (4.x is the only plugin-react major that supports Vite 5). The Vite 5 playgrounds use that order.
- **Scope of the claim.** `pnpm test:matrix` runs the full 38-test version matrix across the Vite 5 and Vite 7 tiers on a machine that allows child processes — that is the CI path — while the repo's confined Windows sandbox skips the esbuild-dependent tiers. The server-only e2e smoke run recorded for this change set passed all seven browser playgrounds, including both Vite 5 apps. No headless-Chrome or CI run is claimed for 0.5.0 in this entry.
- `@vitejs/plugin-react` pairing is documented per tier: **4.7.0** on Vite 5 (the normal pairing there), **5.1.4** on the Vite 7 suite and **6.1.2** on Vite 8. The existing `@vitejs/plugin-react` 4.x-on-Vite-7 caveat is unchanged.

### Astro and Vike

- **Astro 7 works with React 18 and React 19.** Tested Astro 7.4.2 + `@astrojs/react` 7.1.1 (Vite 8.3.5) with React 18.3.1 and React 19.3.1 in the isolated `compat/astro-react18` and `compat/astro-react19` fixtures. The plugin is installed through Astro's `vite.plugins` option in `astro.config.mjs`, and both the dev server and the production build run through Astro's documented JavaScript API (`dev()` / `build()`). For both majors: version isolation, dev server, source markers, overlay module, SSR markup, the shared React fiber/Alt+click runtime check and the production-build cleanliness scan all pass. `.astro` markup is not instrumented — only React/JSX modules inside hydrated islands are — and `data-ttc-name` reaches SSR HTML only when the component forwards props to a DOM node.
- **Vike 0.4 works with React 19; React 18 is blocked upstream.** Tested Vike 0.4.268 + `vike-react` 0.6.31 on React 19.3.1 (Vite 8.3.5) in `compat/vike-react19`. Version isolation, dev server, markers, overlay module, SSR markup, the shared runtime check and a production scan of both `dist/client` and `dist/server` all pass; no dev-only strings reach the build. `vike-react@0.6.31` declares `peer react ">=19"` / `peer react-dom ">=19"`, so no React 18 fixture exists.
- **Edge frameworks were evaluated but not added as matrix cells.** RedwoodJS classic is not in the verified matrix: its `@redwoodjs/vite` package pins Vite 5.4.20, which the widened peer range now accepts, but there is no Redwood fixture (the Vite-based RedwoodSDK is still emerging). Waku is on `1.0.0-rc.x` (1.0.0-rc.4 at the time of writing) and is deferred until a stable release. Shopify Hydrogen is built on React Router 7, so it inherits the React Router v7 row rather than a separate entry. None of these three was tested, and no fixture was created.
- **Honest matrix status:** the verified 20-cell run (10 frameworks × 2 React majors) reports **13 tested (12 works, 1 works-not-verified), 0 failing**, 3 upstream-unsupported cells and 4 not-applicable cells. The works-not-verified cell is Remix v2 on React 18, whose dev/build/SSR checks need esbuild, which this sandbox blocks. Every Browser cell is reported as ⏭ skipped, never passed: the Astro/Vike fixtures do not implement the counter + three-row action-picker contract that the Chrome e2e runner asserts, and headless Chrome could not run in this environment for any cell. The shared Runtime ✅ is the generic React fiber/Alt+click harness check, not framework-specific browser hydration.
- `pnpm test:compat` now builds and scans the Astro and Vike fixtures, `pnpm install:compat` installs **seven** isolated fixture roots, and CI caches all seven lockfiles.
- Documentation: both READMEs gained Astro and Vike setup snippets, a 10-framework compatibility table, the React 18/19 and `.astro` constraints, the Vite 5/RedwoodSDK/Waku/Hydrogen notes and updated reproduce commands. `docs/compatibility-matrix.md` was regenerated from the verified run's recorded JSON (package `0.4.1`) with the browser-tier provenance stated explicitly.

### Tests and packaging

- Unit suite: 490 tests in 21 files (one POSIX-only case is skipped on Windows), including new coverage for the custom-action config normalization, template expansion and sanitization, the AI/share presets, the prototype-token and long-chain caps, `open: "menu"` ignoring custom rows, the new icons and the custom-row click flow.
- Integration suite: 38 tests in 5 files; Vite 5 + Vite 7 version matrix: 38 tests; compatibility matrix: 20 cells.
- Extension: 211 tests in 16 files, including generated Vite 8 source-map fixtures with and without an absolute `file` entry, layered source resolution, fiber walking, the overlay controller, and the settings/protocol contracts.
- `verify:package`: the packed payload grew with the new preset and template runtime and the expanded documentation (~185 KiB unpacked), so the unpacked-size budget was raised from 168 KiB to 192 KiB and the browser-runtime budget from 26 KiB to 30 KiB. The check now also imports the new custom-action constants and asserts that configured `customActions` reach the served client config. The minified client is 29,648 bytes (9,801 bytes gzip).

### Documentation

- Both READMEs gained the eight new `clickActions` rows (with their exact clipboard formats and toasts), a **Custom copy actions** section with the placeholder table and example, and the `customActions` row in the options table.
- Both READMEs now say **Vite 5, 6, 7 & 8**, and their compatibility tables show **5.4.21** through `pnpm test:matrix` (React 18 and 19), **6.4.5** through Remix v2, **7.3.7** through `pnpm test:matrix` (React 19) and **8.3.5** in the main integration suite.
- **RedwoodJS wording corrected.** RedwoodJS classic was previously described as blocked because its `@redwoodjs/vite` package pins Vite 5, which sat below the old peer range. With Vite 5 inside the peer range that pin is now installable, but the Redwood integration is still not in the verified matrix (there is no fixture) and RedwoodSDK is still emerging — the docs do not claim it works.
- **Vite 5 security caveat added** next to the launch-editor advisory note: Vite 5 is end-of-life, 5.4.21 is the last 5.x release and there is no fixed 5.x release for the listed advisories, so `editor: "auto"` (Vite's `/__open-in-editor`) should be treated as unpatched on Vite 5. The default `editor: "code"` path uses the plugin's own endpoint and is unaffected; Vite 5 users should keep the default or upgrade within a maintained major.
- `DEVELOPMENT.md` now describes the eight playgrounds and the `pnpm test:matrix` scope (Vite 5 + Vite 7; Vite 8 stays in `pnpm test:integration`), and `docs/compatibility-matrix.md` (plus its generator note in `scripts/compat-matrix.mjs`) records that Vite 5 (React 18 and 19) and Vite 7 (React 19) are covered by `pnpm test:matrix`.
- The package README cross-links the companion Chrome extension (the root README keeps the full walkthrough), and both READMEs link this changelog.
- The extension ships its own README with load-unpacked steps, settings, editor URL presets, a manual QA checklist, troubleshooting and limitations.
- Fixed the stale "best-effort in 0.1" React Server Components note in the limitations.

### Upgrade notes

- **Vite 5 joins the supported peer range.** `peerDependencies.vite` is now `^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0`, an additive, semver-minor widening: installs on Vite 6/7/8 are unaffected. On Vite 5, list `tabToComponents()` before `@vitejs/plugin-react` 4.x and keep the default `editor: "code"` path (`editor: "auto"` should be treated as unpatched there; see above).
- No upgrade work: `0.5.0` is a drop-in replacement for `0.4.1`. Existing `clickActions` defaults, options, DOM attributes (`data-ttc`, `data-ttc-name`, `data-ttc-theme`), endpoints and output formats are unchanged; dev-only output is still absent from production builds.
- `customActions` and the eight new `clickActions` values are opt-in. Custom rows are copy-only templates expanded in the browser and cannot open files or run commands.
- The new menu icons are decorative `aria-hidden` SVGs inside the existing `[data-ttc-ui]` shadow root. They add no font, sprite sheet or network request and do not change a row's text content, accessible name, copy targets, toasts or e2e selectors.

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
