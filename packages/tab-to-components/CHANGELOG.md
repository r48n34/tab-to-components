# Changelog

All notable changes to `tab-to-components` are documented here.
This project follows [Semantic Versioning](https://semver.org/).

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
