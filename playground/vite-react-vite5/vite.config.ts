import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { tabToComponents } from "tab-to-components";

// Vite 5 pairs with @vitejs/plugin-react 4.x (plugin-react 5+ requires Vite 6+).
// `tabToComponents()` is listed first on purpose: plugin-react 4.x prepends its
// Fast Refresh preamble before the JSX transform, which shifts the source
// positions it reports. The plugin's `enforce: "pre"` then annotates raw JSX
// before plugin-react compiles it.
export default defineConfig({
  plugins: [tabToComponents(), react()],
});
