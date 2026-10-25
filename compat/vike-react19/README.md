# Vike 0.4 + React 19 compatibility fixture

Isolated app used to verify that `tab-to-components` works inside
[Vike](https://vike.dev) with the `vike-react` renderer. It is not part of the
published package; it exists so the compatibility matrix can test this framework
combination for real.

## Pinned versions

| Package | Version |
| --- | --- |
| `vike` | 0.4.268 |
| `vike-react` | 0.6.31 |
| `react` / `react-dom` | 19.3.1 |
| `vite` | 8.3.5 |
| `@vitejs/plugin-react` | 6.1.2 |
| `tab-to-components` | `link:../../packages/tab-to-components` |

`vike-react@0.6.31` declares `peer react ">=19"` / `peer react-dom ">=19"`, so
React 18 is unsupported upstream for this renderer and no React 18 fixture
exists.

## Layout

```
pages/+config.ts          extends vike-react/config
pages/index/+Page.tsx     <main> with a <Button> usage site
src/components/Button.tsx <button> host element; forwards injected props
vite.config.ts            tabToComponents({ clickActions: ["open"] }), react(), vike()
verify.mjs                dev-server + production-build assertions
```

`Button` spreads its remaining props onto the host `<button>` on purpose: the
injected `data-ttc-name="Button"` is a prop on the `<Button>` usage site, so it
only reaches server-rendered HTML when a component forwards props to a DOM
element (a real design-system button does). Without forwarding, the marker still
lives on the React fiber, which is what the overlay reads.

## Commands

```bash
pnpm install                 # creates this fixture's own lockfile
pnpm dev                     # $ vike dev (documented Vike CLI)
pnpm build                   # $ vike build -> dist/client + dist/server
```

`verify.mjs` starts Vike's dev server with the documented JavaScript API
(`dev()` from `vike/api`, which is what `$ vike dev` calls), runs the HTTP
assertions, and closes the server again:

```bash
# In this Windows sandbox the Vite realpath probe needs the repo shim:
node --import file:///D:/Github/tab-to-components/scripts/sandbox-shim.mjs verify.mjs
node --import file:///D:/Github/tab-to-components/scripts/sandbox-shim.mjs verify.mjs --scan-build
```

Outside the sandbox the shim is unnecessary (`pnpm verify` / `pnpm verify:build`).

## What must pass

- `GET /` returns 200 with SSR `data-ttc` markers for the `<main>` site
  (`pages/index/+Page.tsx`) and the `<button>` host site
  (`src/components/Button.tsx`), plus `data-ttc-name="Button"`.
- `GET /pages/index/+Page.tsx` returns the instrumented module with `data-ttc`
  markers and the `virtual:tab-to-components/client` import.
- `GET /@id/__x00__virtual:tab-to-components/client` returns 200 with
  `__TTC_CONFIG__` and the bundled overlay runtime.
- `vike build` succeeds and `dist/client` / `dist/server` contain none of
  `data-ttc`, `virtual:tab-to-components/client`, `__TTC_CONFIG__`,
  `__TTC_READY__`, `__TTC_INSTALLED__`.

Vike also supports third-party CLIs for the dev server: a plain
`vite.createServer()` loads this same config and passes the dev checks above.
Production output must still be produced with `vike build`, because Vike
orchestrates the separate client and SSR environments and writes
`dist/assets.json`.
