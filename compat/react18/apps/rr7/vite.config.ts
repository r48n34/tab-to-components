import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  plugins: [tabToComponents(), reactRouter()],
});
