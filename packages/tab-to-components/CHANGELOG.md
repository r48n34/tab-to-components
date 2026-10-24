# Changelog

All notable changes to `tab-to-components` are documented here.
This project follows [Semantic Versioning](https://semver.org/).

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
