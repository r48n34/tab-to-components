# tab-to-components

Alt+click any React element in your dev server to open its JSX source — built for **React 19 + Vite 7/8 + React Router v7/v8**, where the existing click-to-component tools no longer work.

```
<button />   app/components/Button.tsx:6:10
<Button />   app/routes/home.tsx:19:7
```

This repository is a pnpm workspace containing the published plugin and five real applications used to verify it.

## The plugin

📦 [`packages/tab-to-components`](./packages/tab-to-components) — read its [README](./packages/tab-to-components/README.md) for install, options, editor support and limitations.

```ts
// vite.config.ts (React Router v7 / v8 framework mode)
import { reactRouter } from "@react-router/dev/vite";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  plugins: [
    tabToComponents(),                      // opens VS Code (`code`) by default
    // tabToComponents({ editor: "cursor" }), // or "trae", "webstorm", a template, …
    reactRouter(),
  ],
});
```

No `entry.client.tsx` edit, no `root.tsx` edit, no React runtime patching, nothing in production builds.

**VS Code is the default editor** (`code`). Pass `editor` to use another IDE: a preset (`cursor`, `trae`, `webstorm`, `zed`, `subl`, `vim`, …), any command name (`pi`), a command template like `"my-ide --goto {file}:{line}:{column}"`, a `{ command, args }` object, or a launcher function. Pass `editor: "auto"` to go back to Vite/`launch-editor` auto-detection with `LAUNCH_EDITOR`.

## Repository layout

```
packages/tab-to-components/   the plugin (TypeScript, tsc + rolldown build)
  src/                             plugin, babel transform, path filters
  src/client/                      browser overlay (no React dependency)
  test/                            unit tests
  test/integration/                dev-server + production build assertions (Vite 8 apps)
  test/version-matrix/             Vite 7 compatibility matrix (extra playgrounds)
playground/rr8/                    React Router v8 framework-mode app (Vite 8, SSR)
playground/rr7/                    React Router v7 framework-mode app (Vite 8, SSR)
playground/rr7-vite7/              React Router v7 framework-mode app on Vite 7 (SSR)
playground/vite-react/             plain Vite 8 + @vitejs/plugin-react app
playground/vite-react-vite7/       plain Vite 7 + @vitejs/plugin-react app
examples/mantine-demo/             GIT-IGNORED local demo: framework mode + Mantine 9
examples/raw-demo/                 GIT-IGNORED local demo: data mode ("page mode"), no UI kit
scripts/e2e.mjs                    headless-Chrome end-to-end acceptance test (5 committed apps, + 2 examples with --examples)
scripts/sandbox-shim.mjs           dev-environment shim (see notes below)
```

## Local demo apps (git-ignored)

`examples/` contains two extra demo projects for manual testing with your own IDE. They are listed in `.gitignore`, so they stay out of version control, but they are pnpm workspace members: `pnpm install` links the local plugin into them.

| Project | Router mode | What to test |
| --- | --- | --- |
| `examples/mantine-demo` | React Router **v8 framework mode** (`ssr: true`), Mantine 9 | Home, component gallery (buttons, tabs, modal), forms, nested dashboard routes — all SSR-rendered and Mantine-styled |
| `examples/raw-demo` | React Router **v8 data mode** (`createBrowserRouter`, "page mode"), plain CSS | Home, About, dynamic profile route, 404 — client-rendered |

```bash
pnpm install                                 # also installs the examples when the folder exists
pnpm --filter example-mantine-demo dev       # http://localhost:5173 — hold Alt and click around
pnpm --filter example-raw-demo dev           # Vite picks the next free port

# Browser check that clicks through the pages of both examples
node --import ./scripts/sandbox-shim.mjs scripts/e2e.mjs --examples
```

The vite configs call `tabToComponents()` with no options, so they exercise the **VS Code (`code`) default**; change `editor` in `examples/*/vite.config.ts` to try Cursor, Trae, etc.

Because they are workspace members, pnpm-lock.yaml records their importers while the folder exists. On a clone without examples/, pnpm install prunes them and CI's pnpm install --frozen-lockfile still succeeds; commit the lockfile without the examples folder if you want a clean diff.

## Getting started

```bash
pnpm install
pnpm build            # build the plugin (dist/)
pnpm test             # 220 unit tests
pnpm test:integration # Vite 8: dev servers, production builds, default VS Code + custom editor endpoints
pnpm test:matrix      # Vite 7: dev servers, SSR, production build, plugin orderings
pnpm e2e              # headless Chrome: real Alt+click against all 5 playgrounds
pnpm e2e -- --examples  # ...plus the two git-ignored demo apps (7/7)
```

Run a playground:

```bash
pnpm --filter playground-rr8 dev
pnpm --filter playground-rr7 dev
pnpm --filter playground-rr7-vite7 dev
pnpm --filter playground-vite-react dev
pnpm --filter playground-vite-react-vite7 dev
```

Then hold <kbd>Alt</kbd>, hover an element (it gets outlined) and click it: your editor opens at the exact JSX line. <kbd>Alt</kbd> + right-click opens the component chain picker.

Set `LAUNCH_EDITOR=code` (or `cursor`, `webstorm`, …) if auto-detection picks the wrong editor.

## How the acceptance tests work

- **Integration**: in-process Vite **8** dev servers. Asserts that server-rendered HTML contains `data-ttc` markers, that route modules get `"data-ttc"` props and the client runtime import, that the virtual client module serves the resolved config, that production builds of all three Vite 8 apps contain no markers/runtime/`__TTC_*` globals, and that a configured `editor` opens the exact `file:line:column` through the plugin's own endpoint (`__ttc/open-in-editor`) — including rejecting paths outside the project root.
- **Version matrix**: the same checks against real **Vite 7** dev servers (plain React and React Router 7 SSR), plus both plugin orderings and a Vite 7 production build.
- **E2E**: launches headless Chrome, drives the real dev server over the DevTools Protocol, dispatches an Alt+click on the rendered button, and asserts that the browser issued `__open-in-editor?file=<absolute>/<page>:<line>:<column>` for the **usage site** of the component. It also asserts the app's own click handler did not fire and that the chain menu renders.
- **Package**: `pnpm verify:package` stages the exact file set npm would publish, installs it into a clean consumer, type-checks against the packed `.d.ts`, and runs it in a real Vite dev server.

Last full run on this checkout:

```
build      ✓  dist/ (+ client.js 33 KB)
typecheck  ✓  tsc --noEmit
unit       ✓  220 tests  (13 files)
integration ✓  26 tests  (plain Vite, rr7, rr8 on Vite 8, production builds, default VS Code + custom editor endpoints)
matrix     ✓  18 tests  (Vite 7: plain React, React Router 7 SSR, build, both plugin orders)
package    ✓  52 publish-readiness checks (staged tarball, consumer install, types, Vite run)
e2e        ✓  5/5 playgrounds + 2/2 local examples (headless Chrome, Vite 7 and Vite 8)
   rr8              (Vite 8)  → playground/rr8/app/routes/home.tsx:20:9
   rr7              (Vite 8)  → playground/rr7/app/routes/home.tsx:20:9
   vite-react       (Vite 8)  → playground/vite-react/src/App.tsx:20:9
   rr7-vite7        (Vite 7)  → playground/rr7-vite7/app/routes/home.tsx:20:9
   vite-react-vite7 (Vite 7)  → playground/vite-react-vite7/src/App.tsx:20:9
```

The matrix suite runs against real Vite 7 servers and is skipped automatically when esbuild cannot start (Vite 7 compiles with esbuild). In a normal terminal, `pnpm test:matrix` runs it directly.

## Publishing to npm

The publishable package is [`packages/tab-to-components`](./packages/tab-to-components). The npm name **`tab-to-components` is currently unclaimed**; everything below is already wired up.

### Before the first publish

1. Fill in the optional but recommended metadata in `packages/tab-to-components/package.json`:
   ```jsonc
   "author": "Your Name <you@example.com>",
   "repository": { "type": "git", "url": "git+https://github.com/<you>/tab-to-components.git" },
   "homepage": "https://github.com/<you>/tab-to-components#readme",
   "bugs": "https://github.com/<you>/tab-to-components/issues"
   ```
2. Make sure the git repository exists and is pushed (npm links the repository from these fields only).
3. `npm login` (or set `NODE_AUTH_TOKEN`).

### Publish

```bash
pnpm install                 # once
pnpm gate                    # build + typecheck + unit + integration + matrix + package check
pnpm verify:package          # validates the exact npm artifact (52 checks, ~135 KiB)

cd packages/tab-to-components
npm publish --dry-run        # preview the tarball and file list
npm publish                  # goes public
```

(`prepublishOnly` rebuilds `dist/` automatically, so you can publish straight from a clean checkout. `pnpm --filter tab-to-components publish` works too if you prefer pnpm.)

### What gets published

- `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`
- `dist/index.js`, `dist/*.js` (plugin), `dist/client.js` (browser runtime, 33 KB unminified), all `.d.ts` + source maps
- No `src/`, no tests, no playgrounds, no `scripts/` (enforced by the `files` whitelist and asserted by `pnpm verify:package`)

Published size is ~135 KiB unpacked (37 files), and the package has three small runtime dependencies (`@babel/parser`, `@babel/types`, `magic-string`) plus a peer dependency on Vite.

### Versioning

Bump `version` in `packages/tab-to-components/package.json` (and add a `CHANGELOG.md` entry), tag the repo `v<version>`, then publish. The GitHub workflows in `.github/workflows/` run the same gate on pull requests and publish on `v*` tags when an `NPM_TOKEN` repository secret is configured.

## Development-environment notes

This repository was developed inside a Windows sandbox that blocks child processes, which breaks two things unrelated to the plugin itself:

- Vite probes Windows network drives by shelling out to `net use`; the sandbox aborts that. `scripts/sandbox-shim.mjs` makes that single probe take Vite's built-in fallback branch.
- esbuild/postinstall child processes cannot run, so the plugin is built with in-process TypeScript + rolldown (`packages/tab-to-components/scripts/build.mjs`) instead of tsup, and the Vite 7 matrix suite (`pnpm test:matrix`) skips itself there. Headless-Chrome e2e likewise needs process access in that sandbox.

On a normal machine none of this applies: `pnpm install && pnpm build && pnpm gate && pnpm e2e` runs everything confined.

## License

MIT
