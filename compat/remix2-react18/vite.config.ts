import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  plugins: [tabToComponents(), remix()],
});
