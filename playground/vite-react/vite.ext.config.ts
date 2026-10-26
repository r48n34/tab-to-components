import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The same playground app **without** the tab-to-components Vite plugin.
 *
 * Used to manually test the standalone Chrome extension
 * (`packages/tab-to-components-extension`), which must work on an untouched
 * React dev server. Run with `pnpm dev:ext` (port 5200).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5200,
    strictPort: true,
  },
});
