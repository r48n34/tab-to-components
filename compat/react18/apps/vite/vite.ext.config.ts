import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * React 18 counterpart of playground/vite-react/vite.ext.config.ts: the compat
 * fixture **without** the tab-to-components Vite plugin, used to manually test
 * the standalone Chrome extension's React 18 `_debugSource` path.
 *
 * Run after `pnpm install:compat`:
 *   pnpm --dir compat/react18/apps/vite exec vite --config vite.ext.config.ts
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5201,
    strictPort: true,
  },
});
