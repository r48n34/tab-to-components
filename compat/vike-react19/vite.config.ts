import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import vike from "vike/plugin";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  plugins: [tabToComponents({ clickActions: ["open"] }), react(), vike()],
});
