import { describe, expect, it } from "vitest";
import {
  isClientEntryModule,
  isNonExecutableQuery,
  normalizePath,
  relativeToRoot,
  resolveModuleId,
  toFilePath,
} from "../src/paths.js";

const ROOT = "D:/Github/app";

describe("toFilePath", () => {
  it("keeps absolute windows paths", () => {
    expect(toFilePath(`${ROOT}/app/root.tsx`, ROOT)).toBe(`${ROOT}/app/root.tsx`);
  });

  it("strips the Vite query string", () => {
    expect(toFilePath(`${ROOT}/app/root.tsx?import`, ROOT)).toBe(
      `${ROOT}/app/root.tsx`,
    );
    expect(
      toFilePath(`${ROOT}/app/routes/home.tsx?client-route-module=main`, ROOT),
    ).toBe(`${ROOT}/app/routes/home.tsx`);
  });

  it("resolves root-relative urls", () => {
    expect(toFilePath("/app/routes/home.tsx", ROOT)).toBe(
      `${ROOT}/app/routes/home.tsx`,
    );
  });

  it("unwraps /@fs/ ids including windows drive letters", () => {
    expect(toFilePath("/@fs/D:/other/file.tsx", ROOT)).toBe("D:/other/file.tsx");
  });

  it("rejects virtual ids", () => {
    expect(toFilePath("\0virtual:react-router/dev", ROOT)).toBeUndefined();
    expect(toFilePath("virtual:react-router/client", ROOT)).toBeUndefined();
    expect(toFilePath("/@id/__x00__virtual:x", ROOT)).toBeUndefined();
  });

  it("decodes percent-encoded paths", () => {
    expect(toFilePath(`${ROOT}/app/my%20page.tsx`, ROOT)).toBe(
      `${ROOT}/app/my page.tsx`,
    );
  });
});

describe("relativeToRoot", () => {
  it("returns project relative paths with forward slashes", () => {
    expect(relativeToRoot(ROOT, `${ROOT}/app/routes/home.tsx`)).toBe(
      "app/routes/home.tsx",
    );
  });

  it("rejects files outside the project root", () => {
    expect(relativeToRoot(ROOT, "D:/elsewhere/x.tsx")).toBeUndefined();
  });
});

describe("resolveModuleId", () => {
  it("resolves app modules", () => {
    expect(
      resolveModuleId(`${ROOT}/app/routes/home.tsx`, ROOT, {}),
    ).toEqual({ file: `${ROOT}/app/routes/home.tsx`, rel: "app/routes/home.tsx" });
  });

  it("skips node_modules, declaration files and data queries", () => {
    expect(
      resolveModuleId(`${ROOT}/node_modules/lib/x.tsx`, ROOT, {}),
    ).toBeUndefined();
    expect(
      resolveModuleId(`${ROOT}/app/types.d.ts`, ROOT, {}),
    ).toBeUndefined();
    expect(
      resolveModuleId(`${ROOT}/app/icon.tsx?raw`, ROOT, {}),
    ).toBeUndefined();
    expect(
      resolveModuleId(`${ROOT}/app/icon.tsx?url`, ROOT, {}),
    ).toBeUndefined();
    expect(
      resolveModuleId(`${ROOT}/app/icon.tsx?worker`, ROOT, {}),
    ).toBeUndefined();
  });

  it("skips css, json and other non-source files", () => {
    expect(resolveModuleId(`${ROOT}/app/styles.css`, ROOT, {})).toBeUndefined();
    expect(resolveModuleId(`${ROOT}/app/data.json`, ROOT, {})).toBeUndefined();
  });

  it("honours include and exclude filters", () => {
    expect(
      resolveModuleId(`${ROOT}/app/routes/home.tsx`, ROOT, {
        include: [/^app\/routes\//],
      }),
    ).toBeDefined();
    expect(
      resolveModuleId(`${ROOT}/app/components/Button.tsx`, ROOT, {
        include: [/^app\/routes\//],
      }),
    ).toBeUndefined();
    expect(
      resolveModuleId(`${ROOT}/app/routes/home.tsx`, ROOT, {
        exclude: [/home\.tsx$/],
      }),
    ).toBeUndefined();
  });
});

describe("isClientEntryModule", () => {
  it("matches entry.client files only", () => {
    expect(isClientEntryModule("app/entry.client.tsx")).toBe(true);
    expect(isClientEntryModule("entry.client.jsx")).toBe(true);
    expect(isClientEntryModule("app/root.tsx")).toBe(false);
  });
});

describe("helpers", () => {
  it("normalises slashes", () => {
    expect(normalizePath("app\\routes\\home.tsx")).toBe("app/routes/home.tsx");
  });

  it("detects non executable queries", () => {
    expect(isNonExecutableQuery("raw")).toBe(true);
    expect(isNonExecutableQuery("client-route-module=main")).toBe(false);
    expect(isNonExecutableQuery("")).toBe(false);
  });
});
