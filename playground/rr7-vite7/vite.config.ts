import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import { tabToComponents } from "tab-to-components";

export default defineConfig({
  // Vite 7 compiles JSX with esbuild's classic runtime by default; React Router's
  // default entries expect the automatic runtime (Vite 8's OXC does this out of
  // the box). Real Vite 7 + React projects configure this themselves or use
  // @vitejs/plugin-react, so mirror that here.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  plugins: [tabToComponents(), reactRouter()],
});
