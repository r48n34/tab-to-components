# Dev-only by construction

`tab-to-components` is a development tool, not a runtime dependency. Its dev-only behaviour is enforced in layers:

| Layer | Guarantee |
| --- | --- |
| `apply: "serve"` | Vite removes the plugin from `vite build` / `react-router build` before any hook runs. |
| Hook-level command guard | If a wrapper re-registers the plugin without `apply`, `configResolved`, `transform`, `resolveId`, `load` and `configureServer` all stay inert for a build command. No marker, no virtual import and no browser runtime can be emitted. |
| Virtual module guard | `virtual:tab-to-components/client` only resolves from a running dev server. A production build that imports it fails to resolve instead of bundling the overlay. |
| Package exports | `dist/client.js` is served by the dev server but is not an importable package subpath. |
| Regression gates | `pnpm test:dev-only` covers the contract; the integration suite builds plain Vite and React Router 7/8 apps and scans output for `data-ttc`, the virtual module id and the `__TTC_*` globals; `pnpm verify:package` reruns the production-build checks against the exact packed artifact. |

Install it with `-D` and keep it in `vite.config.ts`; never import it from application code.

## Development

This package lives in a pnpm workspace together with six playground apps (React Router v7/v8 on Vite 7/8, plain Vite apps and a TanStack Start app) plus isolated compatibility workspaces under `compat/` for React 18, React Router v6 and Remix v2.

The `compat/` fixtures depend on this package with `link:`, not `file:`. A `file:` dependency makes
pnpm pack the package during `pnpm install:compat`; on a fresh checkout that snapshot is taken before
`pnpm build`, so it contains no `dist/` and Vite fails with
`Failed to resolve entry for package "tab-to-components"`. Linking resolves the workspace package
directly, so the install/build order does not matter and `pnpm test:compat` always exercises the
current build.

```bash
pnpm install
pnpm install:compat   # isolated React 18 / RR6 / Remix install roots
pnpm build            # tsc + rolldown -> dist/
pnpm test             # unit tests (includes the dev-only contract suite)
pnpm test:dev-only    # fast subset: dev-only guards, virtual module, editor middleware
pnpm test:integration # Vite 8 dev servers, SSR, production builds, default VS Code + custom editor endpoints
pnpm test:matrix      # Vite 7 dev servers, SSR, build and plugin orderings
pnpm test:compat      # React 18/19 × framework compatibility matrix
pnpm test:compat:full # matrix + headless-Chrome tier, regenerates docs/compatibility-matrix.md
pnpm e2e              # headless Chrome Alt+click across the 5 playgrounds
pnpm verify:package   # validates the packed npm artifact
```