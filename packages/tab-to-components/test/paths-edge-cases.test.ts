import { describe, expect, it } from "vitest";
import {
  isDeclarationFile,
  isNonExecutableQuery,
  isSourceFile,
  normalizePath,
  relativeToRoot,
  resolveModuleId,
  toFilePath,
} from "../src/paths.js";

const ROOT = "D:/GitHub/app";

describe("toFilePath edge cases", () => {
  it("keeps both a query and a fragment out of the path", () => {
    expect(toFilePath(`${ROOT}/app/App.tsx?import#frag`, ROOT)).toBe(
      `${ROOT}/app/App.tsx`,
    );
  });

  it("normalises backslash absolute ids from Windows", () => {
    expect(toFilePath("D:\\GitHub\\app\\app\\App.tsx", ROOT)).toBe(
      `${ROOT}/app/App.tsx`,
    );
  });

  it("keeps a Vite version query (it is still executable code)", () => {
    expect(toFilePath(`${ROOT}/app/App.tsx?v=1234`, ROOT)).toBe(
      `${ROOT}/app/App.tsx`,
    );
  });

  it("handles an uppercase drive letter", () => {
    expect(toFilePath("/@fs/D:/proj/app.tsx", ROOT)).toBe("D:/proj/app.tsx");
  });

  it("returns undefined for empty input", () => {
    expect(toFilePath("", ROOT)).toBeUndefined();
    expect(toFilePath("?", ROOT)).toBeUndefined();
  });

  it("does not throw on malformed percent escapes", () => {
    expect(() => toFilePath(`${ROOT}/app/%E0%A4%A.tsx`, ROOT)).not.toThrow();
    expect(toFilePath(`${ROOT}/app/%E0%A4%A.tsx`, ROOT)).toBeUndefined();
  });
});

describe("relativeToRoot edge cases", () => {
  it("returns the posix relative path for nested files", () => {
    expect(relativeToRoot(ROOT, `${ROOT}/app/routes/_index.tsx`)).toBe(
      "app/routes/_index.tsx",
    );
  });

  it("rejects a file in a sibling directory that shares a prefix", () => {
    expect(relativeToRoot(ROOT, "D:/GitHub/app-extra/x.tsx")).toBeUndefined();
  });

  it("rejects the root itself", () => {
    expect(relativeToRoot(ROOT, ROOT)).toBeUndefined();
  });
});

describe("resolveModuleId edge cases", () => {
  it("accepts mts/cts/mjs/cjs source files", () => {
    for (const file of ["a.mts", "a.cts", "a.mjs", "a.cjs", "a.jsx", "a.tsx"]) {
      expect(resolveModuleId(`${ROOT}/app/${file}`, ROOT, {}), file).toBeDefined();
    }
  });

  it("rejects declaration files in every flavour", () => {
    for (const file of ["a.d.ts", "a.d.mts", "a.d.cts"]) {
      expect(resolveModuleId(`${ROOT}/app/${file}`, ROOT, {}), file).toBeUndefined();
    }
  });

  it("rejects /@fs files outside the project root", () => {
    expect(
      resolveModuleId("/@fs/D:/elsewhere/app.tsx", ROOT, {}),
    ).toBeUndefined();
  });

  it("lets exclude win over include", () => {
    expect(
      resolveModuleId(`${ROOT}/app/routes/home.tsx`, ROOT, {
        include: [/^app\/routes\//],
        exclude: [/home\.tsx$/],
      }),
    ).toBeUndefined();
  });

  it("supports several exclude patterns", () => {
    const filter = { exclude: [/\.stories\.tsx$/, /\.test\.tsx$/] };
    expect(
      resolveModuleId(`${ROOT}/app/Button.stories.tsx`, ROOT, filter),
    ).toBeUndefined();
    expect(
      resolveModuleId(`${ROOT}/app/Button.test.tsx`, ROOT, filter),
    ).toBeUndefined();
    expect(resolveModuleId(`${ROOT}/app/Button.tsx`, ROOT, filter)).toBeDefined();
  });

  it("ignores generated and vendored directories", () => {
    for (const rel of [
      "node_modules/pkg/index.tsx",
      "dist/app.js",
      "build/app.js",
      ".react-router/types/app.ts",
      "public/thing.js",
    ]) {
      expect(resolveModuleId(`${ROOT}/${rel}`, ROOT, {}), rel).toBeUndefined();
    }
  });

  it("returns the normalised file and relative path", () => {
    expect(
      resolveModuleId(`${ROOT}\\app\\routes\\home.tsx?import`, ROOT, {}),
    ).toEqual({ file: `${ROOT}/app/routes/home.tsx`, rel: "app/routes/home.tsx" });
  });
});

describe("path helpers", () => {
  it("normalises both slash kinds", () => {
    expect(normalizePath("a\\b/c")).toBe("a/b/c");
  });

  it("detects declaration and source files", () => {
    expect(isDeclarationFile("x.d.ts")).toBe(true);
    expect(isDeclarationFile("x.ts")).toBe(false);
    expect(isSourceFile("x.d.ts")).toBe(false);
    expect(isSourceFile("x.tsx")).toBe(true);
    expect(isSourceFile("x.css")).toBe(false);
  });

  it("classifies data-only queries", () => {
    for (const query of ["raw", "url", "inline", "worker", "direct"]) {
      expect(isNonExecutableQuery(query), query).toBe(true);
    }
    for (const query of ["import", "v=1", "client-route-module=main", ""]) {
      expect(isNonExecutableQuery(query), query).toBe(false);
    }
    expect(isNonExecutableQuery("raw&import")).toBe(true);
    expect(isNonExecutableQuery("import&raw")).toBe(true);
  });
});
