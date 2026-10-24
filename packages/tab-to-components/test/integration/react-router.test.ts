import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchText, expectedMarker, playgroundDir, startDevServer, type RunningServer } from "./helpers.js";

const CLIENT_ID = "/@id/__x00__virtual:tab-to-components/client";

describe.each(["rr7", "rr8"] as const)(
  "React Router %s framework mode",
  (name) => {
    const PLAYGROUND = playgroundDir(name);
    let running: RunningServer;

    beforeAll(async () => {
      running = await startDevServer(PLAYGROUND);
    });

    afterAll(async () => {
      await running?.close();
    });

    it("server-renders markup that carries source markers", async () => {
      const response = await fetch(running.base);
      expect(response.status).toBe(200);
      const html = await response.text();

      // Host elements carry their marker through to the DOM.
      const mainElement = expectedMarker(
        PLAYGROUND,
        "app/routes/home.tsx",
        "<main",
      );
      expect(html).toContain(`data-ttc="${mainElement}"`);

      const hostElement = expectedMarker(
        PLAYGROUND,
        "app/components/Button.tsx",
        "<button",
      );
      expect(html).toContain(`data-ttc="${hostElement}"`);
    });

    it("annotates route modules and injects the client runtime", async () => {
      for (const path of ["/app/root.tsx", "/app/routes/home.tsx"]) {
        const code = await fetchText(running.base, path);
        expect(code, `${path} should carry markers`).toContain('"data-ttc"');
        expect(
          code,
          `${path} should import the client runtime`,
        ).toContain("virtual:tab-to-components/client");
      }

      // Component usages are annotated as props (they never reach the DOM on
      // their own), which is what makes the component chain resolvable.
      const home = await fetchText(running.base, "/app/routes/home.tsx");
      expect(home).toContain(
        `"data-ttc": "${expectedMarker(PLAYGROUND, "app/routes/home.tsx", "<Button")}"`,
      );
      expect(home).toContain('"data-ttc-name": "Button"');
    });

    it("serves the client runtime with the playground root", async () => {
      const response = await fetch(new URL(CLIENT_ID, running.base));
      expect(response.status).toBe(200);
      const code = await response.text();
      expect(code).toContain("globalThis.__TTC_CONFIG__");
      expect(code).toContain(PLAYGROUND.replace(/\\/g, "/"));
      expect(code).toContain("__TTC_READY__");
    });

    it("does not leak the runtime into route exports analysis", async () => {
      // The React Router plugin transforms route modules in a child compiler
      // too; the injected import must not break export discovery.
      const code = await fetchText(running.base, "/app/routes/home.tsx");
      expect(code).toContain("default");
    });
  },
);
