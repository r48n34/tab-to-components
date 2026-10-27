import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { tabToComponents } from "tab-to-components";

// Vite 5 + React 18 playground: pins @vitejs/plugin-react 4.x, the only
// plugin-react major that supports Vite 5. `tabToComponents()` is listed first
// because plugin-react 4.x shifts the source positions it reports when it runs
// before the plugin.
export default defineConfig({
  plugins: [tabToComponents(), react()],
});
