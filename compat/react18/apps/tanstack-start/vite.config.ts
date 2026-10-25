import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  plugins: [
    tabToComponents(),
    tanstackStart({ srcDirectory: "src" }),
    react(),
  ],
});
