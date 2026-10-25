# Astro 7 + React 19 compatibility fixture

Isolated pnpm root that exercises `tab-to-components` inside Astro. It mirrors
the layout of the other `compat/` roots: it is **not** a member of the root
workspace, so its React/Vite versions cannot collide with the playground.

## Pinned stack

| Package | Version |
| --- | --- |
| `astro` | 7.4.2 |
| `@astrojs/react` | 7.1.1 (with `@vitejs/plugin-react` 6.1.2) |
| `react` / `react-dom` | 19.3.1 |
| `vite` | 8.3.5 (the version Astro 7.4.2 depends on) |
| `typescript` | 5.9.3 |
| `@types/react` / `@types/react-dom` | 19.3.0 / 19.3.0 |
| `tab-to-components` | `link:../../packages/tab-to-components` |

## Layout

- `astro.config.mjs` installs the plugin through Astro's `vite` option:
  `vite: { plugins: [tabToComponents({ clickActions: ["open"] })] }`. Astro owns
  the Vite config; `@astrojs/react` adds its JSX-transform plugins alongside it.
- `src/pages/index.astro` renders `<App client:load />`, so the React island is
  server-rendered and hydrated on the client.
- `src/components/App.tsx` renders `<main><Button /></main>` and
  `src/components/Button.tsx` renders `<button>`. Both marker sites live in
  React modules: Astro never transforms `.astro` files through the Vite plugin.

## Running the checks

Build the plugin once at the repo root (`pnpm build`) so
`packages/tab-to-components/dist/` exists, then from this directory:

```bash
pnpm install
pnpm exec astro build          # or: node node_modules/astro/bin/astro.mjs build
```

The sandbox this repo is developed in blocks `child_process.spawn` and cannot
write Astro's telemetry config under `%APPDATA%\astro` (`EPERM` on
`...\AppData\Roaming\astro\Config`). Node/Vite processes therefore need the
repo's shim, and telemetry must be disabled. The verification scripts set
`ASTRO_TELEMETRY_DISABLED=1` themselves before importing Astro; set it yourself
when invoking the Astro CLI directly:

```bash
# PowerShell: $env:ASTRO_TELEMETRY_DISABLED = "1"
# bash:       export ASTRO_TELEMETRY_DISABLED=1
node --import file:///D:/Github/tab-to-components/scripts/sandbox-shim.mjs node_modules/astro/bin/astro.mjs build
```

Verification scripts (`TTC_ASTRO_PORT` overrides the default port 4400; each one
sets `ASTRO_TELEMETRY_DISABLED=1` before importing Astro):

```bash
node --import file:///D:/Github/tab-to-components/scripts/sandbox-shim.mjs scripts/verify-dev.mjs   # dev server, SSR markup, modules
node --import file:///D:/Github/tab-to-components/scripts/sandbox-shim.mjs scripts/verify-build.mjs # dist/ leakage scan (run after astro build)
node --import file:///D:/Github/tab-to-components/scripts/sandbox-shim.mjs scripts/verify-browser.mjs # optional headless-Chrome hydration check
```

`verify-dev.mjs` starts the Astro dev server through the official JavaScript API
(`dev()` from `astro`), stops it cleanly, and prints JSON. `verify-browser.mjs`
reports `na` instead of failing when Chrome cannot be launched (for example in
the restricted sandbox, where Chrome self-terminates on named-pipe creation).

## Expected results

- `GET /` → SSR HTML contains `<main data-ttc="src/components/App.tsx:5:5">`
  and `<button ... data-ttc="src/components/Button.tsx:2:10">`, inside an
  `<astro-island client="load">`.
- `data-ttc-name="Button"` is emitted on the `<Button />` **usage** marker in the
  served `App.tsx` module. It is a React prop, so it only appears in server HTML
  when a component forwards props to its DOM node (this fixture's `Button` does
  not, exactly like the other compat fixtures).
- `/src/components/App.tsx` and `/src/components/Button.tsx` are served as
  transformed client modules with `data-ttc` props and an
  `import "/@id/__x00__virtual:tab-to-components/client"`.
- `/@id/__x00__virtual:tab-to-components/client` → 200 with `__TTC_CONFIG__`
  and the overlay runtime.
- `astro build` → `dist/` contains no `data-ttc`,
  `virtual:tab-to-components/client`, `__TTC_CONFIG__`, `__TTC_READY__` or
  `__TTC_INSTALLED__` (the plugin is `apply: "serve"`, so it is absent from the
  build).
- The page wires the `astro-island` hydration script and the island's
  `component-url` points at `/src/components/App.tsx`; real browser hydration
  and Alt+click are only checked by `verify-browser.mjs` when Chrome is
  available.
