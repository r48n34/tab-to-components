import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { tabToComponents } from "tab-to-components";

// Astro owns the Vite config, so the plugin is installed through Astro's
// `vite` option exactly as an Astro user would install it. The React
// integration contributes its own JSX-transform plugins alongside it.
export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tabToComponents({ clickActions: ["open"] })],
  },
});
