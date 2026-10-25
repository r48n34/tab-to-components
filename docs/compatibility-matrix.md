# tab-to-components compatibility matrix

Generated from a real run of `node scripts/compat-matrix.mjs` on 2026-10-25.

Environment: Node v24.21.0, pnpm 11.28.5, win32 x64, package `tab-to-components@0.3.0`.

## Matrix

| Framework | React 18.3.1 | React 19.3.1 |
| --- | --- | --- |
| Vite + @vitejs/plugin-react (SPA) | ✅ works | ✅ works |
| React Router v6 (SPA) | ✅ works | ✅ works |
| React Router v7 (framework, SSR) | ✅ works | ✅ works |
| React Router v8 (framework, SSR) | ⛔ upstream | ✅ works |
| TanStack Start (SSR) | ✅ works | ✅ works |
| Remix v1 (classic compiler) | — N/A | — N/A |
| Remix v2 (Vite 6, SSR) | ✅ works | ⛔ upstream |

Legend: ✅ works (all applicable checks pass) · ⚠️ upstream-supported but not verified in this environment · ❌ tested and failing · ⛔ unsupported upstream · — not applicable.

## Details

| React | Framework | Resolved versions | Versions | Dev server | Markers | Overlay module | SSR markup | Runtime | Build | Browser | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18 | Vite + @vitejs/plugin-react | react@18.3.1<br>react-dom@18.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2 | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | works |
| 18 | React Router v6 (SPA) | react@18.3.1<br>react-dom@18.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2<br>react-router-dom@6.30.6 | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | works |
| 18 | React Router v7 (framework, SSR) | react@18.3.1<br>react-dom@18.3.1<br>vite@8.3.5<br>react-router@7.18.4<br>@react-router/dev@7.18.4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | works |
| 18 | TanStack Start | react@18.3.1<br>react-dom@18.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2<br>@tanstack/react-start@1.169.4<br>@tanstack/react-router@1.170.46 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | works |
| 18 | Remix v2 (Vite 6, SSR) | react@18.3.1<br>react-dom@18.3.1<br>vite@6.4.5<br>@remix-run/dev@2.17.5<br>@remix-run/react@2.17.5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | works |
| 19 | Vite + @vitejs/plugin-react | react@19.3.1<br>react-dom@19.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2 | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | works |
| 19 | React Router v6 (SPA) | react@19.3.1<br>react-dom@19.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2<br>react-router-dom@6.30.6 | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | works |
| 19 | React Router v7 (framework, SSR) | react@19.3.1<br>react-dom@19.3.1<br>vite@8.3.5<br>react-router@7.18.4<br>@react-router/dev@7.18.4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | works |
| 19 | React Router v8 (framework, SSR) | react@19.3.1<br>react-dom@19.3.1<br>vite@8.3.5<br>react-router@8.5.0<br>@react-router/dev@8.5.0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | works |
| 19 | TanStack Start | react@19.3.1<br>react-dom@19.3.1<br>vite@8.3.5<br>@vitejs/plugin-react@6.1.2<br>@tanstack/react-start@1.169.4<br>@tanstack/react-router@1.170.46 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | works |
| 18 | React Router v8 (framework, SSR) | peer react >=19.2.7 | react-router@8.5.0 declares peer react >=19.2.7 (and react-dom >=19.2.7), so React 18 cannot be installed without forcing peers. | — | — | — | — | — | — | — | unsupported |
| 19 | Remix v2 (Vite 6, SSR) | peer react ^18.0.0 | @remix-run/react@2.17.5 declares peer react ^18.0.0, so React 19 is outside its supported range. | — | — | — | — | — | — | — | unsupported |
| 18 | Remix v1 (classic compiler) | — | @remix-run/dev@1.19.1 has no Vite plugin (its classic esbuild compiler is not Vite), so a Vite plugin cannot run in a Remix v1 app. | — | — | — | — | — | — | — | not-applicable |
| 19 | Remix v1 (classic compiler) | — | @remix-run/dev@1.19.1 has no Vite plugin (its classic esbuild compiler is not Vite), so a Vite plugin cannot run in a Remix v1 app. | — | — | — | — | — | — | — | not-applicable |

## Notes

- **React Router v8 + React 18 is blocked upstream**: `react-router@8.5.0` declares `peer react >=19.2.7`.
- **Remix v2 + React 19 is blocked upstream**: `@remix-run/react@2.17.5` declares `peer react ^18.0.0`. Remix v2 also supports only Vite 5/6, so it is tested on Vite 6.4.5.
- **Remix v1 has no Vite integration** (`@remix-run/dev@1.19.1` uses its classic esbuild compiler), so this Vite plugin cannot run there.
- **TanStack** is tested as TanStack Start (the Vite-based SSR framework); TanStack Router in SPA mode follows the same plain-Vite path as the Vite row.
- "Works" means the pinned combination passed the version/isolation checks, dev-server marker + overlay injection checks, any applicable SSR-markup check, the real-React fiber/Alt+click check, and the production-build cleanliness check. The browser column is only filled when the run includes `--browser`.
- Vite 7 is covered separately by `pnpm test:matrix` (React 19 only); this table pins Vite 8 for the Vite/React Router/TanStack rows and Vite 6 for Remix v2, matching each framework's current supported range.
- This run included the headless-Chrome tier: for every tested cell, Alt+click opened the expected `<Button>` usage site and the app's own click handler did not run.

## Reproduce

```bash
pnpm install
pnpm install:compat
pnpm build
pnpm test:compat              # dev-server + build matrix
pnpm test:compat:full         # + headless Chrome; writes this file
```

