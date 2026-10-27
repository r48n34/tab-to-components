// TEMPORARY verification against the running RR8 dev server with base "/cats/".
import { describe, expect, it } from "vitest";

import { buildEditorUrl } from "../lib/editor";
import { createSourceResolver } from "../lib/source/resolve";

const BASE = "http://localhost:5391";
const MODULE_URL = `${BASE}/cats/app/routes/home.tsx`;

describe("React Router 8 under base /cats/ (live server)", () => {
  it("resolves the absolute path of a base-prefixed route module", async () => {
    const code = await (await fetch(MODULE_URL)).text();
    const index = code.indexOf("_jsxDEV(");
    if (index < 0) throw new Error("no jsxDEV call in module");
    const before = code.slice(0, index);
    const line = before.split("\n").length;
    const column = index - before.lastIndexOf("\n");

    const resolver = createSourceResolver({
      pageOrigin: BASE,
      projectRoot: null,
      fetchText: async (url) => {
        const response = await fetch(url);
        return response.ok ? response.text() : null;
      },
    });
    const resolved = await resolver.resolve({
      name: "Home",
      isHost: false,
      stackFrame: { url: MODULE_URL, line, column },
    });
    if (resolved.location === null) throw new Error("no location");
    // eslint-disable-next-line no-console
    console.log("rr8 base location:", resolved.location);

    const built = buildEditorUrl(
      { preset: "vscode", template: "" },
      { location: resolved.location, root: null },
    );
    // eslint-disable-next-line no-console
    console.log("rr8 base editor url:", built);

    expect(resolved.location.relativeFile).toBe("app/routes/home.tsx");
    expect(resolved.location.absoluteFile).toMatch(
      /^[A-Za-z]:\/.*\/playground\/rr8\/app\/routes\/home\.tsx$/,
    );
    expect(built).toEqual({
      url: `vscode://file/${resolved.location.absoluteFile}:${resolved.location.line}:${resolved.location.column}`,
    });
  }, 30_000);
});
