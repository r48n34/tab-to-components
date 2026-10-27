// Temporary probe config (not committed): React Router 8 dev server with a
// non-root Vite base, matching the layout of the app the extension failed on
// (`base: "/cats/"`). Used to inspect what the dev server serves.
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  base: "/cats/",
  server: { port: 5391, strictPort: true },
  build: { sourcemap: false },
});
