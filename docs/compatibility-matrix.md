# tab-to-components compatibility matrix

Rendered from the recorded JSON report of a real `node scripts/compat-matrix.mjs` run on 2026-10-25.

The run was recorded on the `0.4.1` release tree, before the `0.5.0` version bump, so the environment line
keeps the version the run actually reported. It is the **`0.5.0` ship baseline**: the report was not re-run
for the version bump, and the only compatibility-matrix change made after it was recorded is the additive
Vite 5 peer range (`vite`: `^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0`). Vite 5 (React 18 and 19) and Vite 7
(React 19) coverage is exercised by `pnpm test:matrix`, not by this table (see Notes).

Environment: Node v24.21.0, pnpm 11.28.5, win32 x64, package `tab-to-components@0.4.1` (the version the
recorded run reported; the `0.5.0` bump landed after it).

Run provenance: `node scripts/compat-matrix.mjs` with the version/dev-server/runtime/build tiers only (no `--browser`). The headless-Chrome tier cannot launch in this environment, so every Browser cell is ⏭ skipped — a skipped check is not a pass. Result: 20 cells (10 frameworks × 2 React majors) — 13 tested (12 works, 1 works-not-verified), 3 upstream-unsupported, 4 not applicable, 0 failing.

## Matrix

| Framework | React 18.3.1 | React 19.3.1 |
| --- | --- | --- |
| Vite + @vitejs/plugin-react (SPA) | ✅ works | ✅ works |
| React Router v6 (SPA) | ✅ works | ✅ works |
| React Router v7 (framework, SSR) | ✅ works | ✅ works |
| React Router v8 (framework, SSR) | ⛔ upstream | ✅ works |
| TanStack Start (SSR) | ✅ works | ✅ works |
| Astro 7 (React islands, SSR) | ✅ works | ✅ works |
| Vike 0.4 + vike-react (SSR) | ⛔ upstream | ✅ works |
| Remix v1 (classic compiler) | — N/A | — N/A |
| Remix v2 (Vite 6, SSR) | ⚠️ not verified here | ⛔ upstream |
| Next.js (Turbopack/webpack) | — N/A | — N/A |

Legend: ✅ works (all applicable checks pass) · ⚠️ upstream-supported but not verified in this environment · ❌ tested and failing · ⛔ unsupported upstream · ⏭ check skipped (not run in this environment) · — not applicable.

## Details

| React | Framework | Resolved versions | Versions | Dev server | Markers | Overlay module | SSR markup | Runtime | Build | Browser | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18 | Vite + @vitejs/plugin-react | react@18.3.1<br>react-dom@18.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2 | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ⏭ | works |
| 18 | React Router v6 (SPA) | react@18.3.1<br>react-dom@18.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2<br>react-router-dom@6.30.6 | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ⏭ | works |
| 18 | React Router v7 (framework, SSR) | react@18.3.1<br>react-dom@18.3.1<br>vite@8.3.5<br>react-router@7.18.4<br>@react-router/dev@7.18.4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏭ | works |
| 18 | TanStack Start | react@18.3.1<br>react-dom@18.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2<br>@tanstack/react-start@1.169.4<br>@tanstack/react-router@1.170.46 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏭ | works |
| 18 | Remix v2 (Vite 6, SSR) | react@18.3.1<br>react-dom@18.3.1<br>vite@6.4.5<br>@remix-run/dev@2.17.5<br>@remix-run/react@2.17.5 | ✅ | ⏭ | ⏭ | ⏭ | ⏭ | ✅ | ⏭ | ⏭ | works-not-verified |
| 18 | Astro 7 (React islands, SSR) | react@18.3.1<br>react-dom@18.3.1<br>astro@7.4.2<br>@astrojs/react@7.1.1<br>vite@8.3.5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏭ | works |
| 19 | Vite + @vitejs/plugin-react | react@19.3.1<br>react-dom@19.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2 | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ⏭ | works |
| 19 | React Router v6 (SPA) | react@19.3.1<br>react-dom@19.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2<br>react-router-dom@6.30.6 | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ⏭ | works |
| 19 | React Router v7 (framework, SSR) | react@19.3.1<br>react-dom@19.3.1<br>vite@8.3.5<br>react-router@7.18.4<br>@react-router/dev@7.18.4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏭ | works |
| 19 | React Router v8 (framework, SSR) | react@19.3.1<br>react-dom@19.3.1<br>vite@8.3.5<br>react-router@8.5.0<br>@react-router/dev@8.5.0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏭ | works |
| 19 | TanStack Start | react@19.3.1<br>react-dom@19.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2<br>@tanstack/react-start@1.169.4<br>@tanstack/react-router@1.170.46 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏭ | works |
| 19 | Astro 7 (React islands, SSR) | react@19.3.1<br>react-dom@19.3.1<br>astro@7.4.2<br>@astrojs/react@7.1.1<br>vite@8.3.5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏭ | works |
| 19 | Vike 0.4 + vike-react (SSR) | react@19.3.1<br>react-dom@19.3.1<br>vike@0.4.268<br>vike-react@0.6.31<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏭ | works |
| 18 | React Router v8 (framework, SSR) | peer react >=19.2.7 | react-router@8.5.0 declares peer react >=19.2.7 (and react-dom >=19.2.7), so React 18 cannot be installed without forcing peers. | — | — | — | — | — | — | — | unsupported |
| 18 | Vike 0.4 + vike-react (SSR) | peer react >=19 | vike-react@0.6.31 declares peer react ">=19" and peer react-dom ">=19", so React 18 is outside the vike-react renderer's supported range. | — | — | — | — | — | — | — | unsupported |
| 19 | Remix v2 (Vite 6, SSR) | peer react ^18.0.0 | @remix-run/react@2.17.5 declares peer react ^18.0.0, so React 19 is outside its supported range. | — | — | — | — | — | — | — | unsupported |
| 18 | Remix v1 (classic compiler) | — | @remix-run/dev@1.19.1 has no Vite plugin (its classic esbuild compiler is not Vite), so a Vite plugin cannot run in a Remix v1 app. | — | — | — | — | — | — | — | not-applicable |
| 19 | Remix v1 (classic compiler) | — | @remix-run/dev@1.19.1 has no Vite plugin (its classic esbuild compiler is not Vite), so a Vite plugin cannot run in a Remix v1 app. | — | — | — | — | — | — | — | not-applicable |
| 18 | Next.js (Turbopack/webpack) | peer react ^18.2.0 \|\| 19.0.0-rc-de68d2f4-20241204 \|\| ^19.0.0 | Next.js does not use Vite: next dev runs Turbopack (default in Next.js 16) or webpack with the SWC-based Next.js Compiler, so there is no Vite hook for the marker transform or overlay runtime. Next.js 16.4.3 accepts React 18.2+ for the Pages Router, but this plugin cannot run there. | — | — | — | — | — | — | — | not-applicable |
| 19 | Next.js (Turbopack/webpack) | peer react ^18.2.0 \|\| 19.0.0-rc-de68d2f4-20241204 \|\| ^19.0.0 | Next.js does not use Vite: next dev runs Turbopack (default in Next.js 16) or webpack with the SWC-based Next.js Compiler, so there is no Vite hook for the marker transform or overlay runtime. Next.js 16.4.3 accepts React 19 for the App Router, but this plugin cannot run there. | — | — | — | — | — | — | — | not-applicable |

## Notes

- **React Router v8 + React 18 is blocked upstream**: `react-router@8.5.0` declares `peer react >=19.2.7`.
- **Remix v2 + React 19 is blocked upstream**: `@remix-run/react@2.17.5` declares `peer react ^18.0.0`. Remix v2 also supports only Vite 5/6, so it is tested on Vite 6.4.5.
- **Remix v1 has no Vite integration** (`@remix-run/dev@1.19.1` uses its classic esbuild compiler), so this Vite plugin cannot run there.
- **Next.js is not applicable**: `next dev` uses Turbopack (default in Next.js 16) or webpack rather than Vite, and the SWC-based Next.js Compiler owns the JSX transform. Next.js 16.4.3 accepts React 18.2+ for the Pages Router and React 19 for the App Router, but this Vite plugin cannot install its transform or overlay runtime there.
- **TanStack** is tested as TanStack Start (the Vite-based SSR framework); TanStack Router in SPA mode follows the same plain-Vite path as the Vite row.
- **Astro** is tested with Astro 7.4.2 + `@astrojs/react` 7.1.1 on React 18.3.1 and React 19.3.1. Astro owns the Vite config, so the plugin is installed through `vite.plugins` in `astro.config.mjs` and both the dev server and the production build go through Astro's documented JavaScript API (`dev()` / `build()`). The marker transform only applies to React/JSX modules; `.astro` markup itself is not instrumented, so the overlay is available on pages that hydrate a JSX island. `data-ttc-name` is a prop on component usage sites, so it only appears in SSR HTML when that component forwards props to a DOM node (the Astro fixture's `Button` does not; the served module still carries the marker).
- **Vike** is tested with Vike 0.4.268 + `vike-react` 0.6.31 on React 19.3.1. React 18 is unsupported upstream because `vike-react` declares `peer react ">=19"` / `peer react-dom ">=19"`. Dev and production builds use the documented `dev()` / `build()` functions from `vike/api`; the production scan covers both `dist/client` and `dist/server`, which contain none of the dev-only strings.
- **The headless-Chrome tier stays scoped to the counter-based playground fixtures**: the existing e2e runner asserts an app counter plus the three-row source action picker, which the static Astro/Vike compatibility fixtures do not implement (they configure `clickActions: ["open"]`). Their browser cell is therefore reported as skipped, not failed; every server-side, runtime and build check still runs for them.
- **Astro/Vike Runtime ✅ is the shared harness check, not browser hydration**: it imports the built `packages/tab-to-components/dist/client.js`, mounts a small React tree in happy-dom and asserts the fiber walk plus Alt+click request for that React major. It does not prove that the framework's own page hydrates; that is the Browser column, which is ⏭ skipped for these cells in this environment.
- **The browser tier was not run for this report**: `node scripts/compat-matrix.mjs` ran without `--browser` because headless Chrome cannot launch in this sandbox (crashpad/mojo named-pipe access is denied). Every Browser cell above is ⏭ skipped, never ✅; regenerate with `pnpm test:compat:full` on a machine with Chrome to fill the column.
- **Remix v2's dev/build/SSR checks are environment-skipped**: Vite 6 transforms TypeScript with esbuild, and this sandbox blocks the esbuild child process (`spawn EPERM`). Its versions and shared runtime check pass, so the row is ⚠️ not verified here rather than failing; this is a sandbox limitation, not a Remix compatibility finding.
- "Works" means the pinned combination passed the version/isolation checks, dev-server marker + overlay injection checks, any applicable SSR-markup check, the real-React fiber/Alt+click check, and the production-build cleanliness check. The browser column is only filled when the run includes `--browser`.
- Vite 5 (React 18 and React 19) and Vite 7 (React 19) are covered separately by `pnpm test:matrix`; this table pins Vite 8 for the Vite / React Router / TanStack Start / Astro / Vike rows and Vite 6 for Remix v2, matching each framework's current supported range.

## Reproduce

```bash
pnpm install
pnpm install:compat            # installs the 7 isolated fixture roots (frozen lockfiles)
pnpm build
pnpm test:compat               # dev-server + build matrix
pnpm test:compat:full          # + headless Chrome; regenerates this file
```

