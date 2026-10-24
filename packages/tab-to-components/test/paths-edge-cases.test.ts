import { describe, expect, it } from "vitest";
import {
  isClientEntryModule,
  isDeclarationFile,
  isNonExecutableQuery,
  isSourceFile,
  isWindowsAbsolutePath,
  normalizePath,
  relativeToRoot,
  resolveFromRoot,
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
    expect(isNonExecutableQuery("raw=true")).toBe(true);
    expect(isNonExecutableQuery("url=")).toBe(true);
    expect(isNonExecutableQuery("worker&type=module")).toBe(true);
    expect(isNonExecutableQuery("?raw")).toBe(true);
    expect(isNonExecutableQuery("foo=1&bar=2")).toBe(false);
  });
});

describe("isWindowsAbsolutePath", () => {
  it("recognises Windows drive and UNC paths in either slash style", () => {
    for (const value of ["C:/x", "D:\\x", "c:/", "//server/share/x"]) {
      expect(isWindowsAbsolutePath(value), value).toBe(true);
    }
    for (const value of ["/home/x", "C:", "src/x", ""]) {
      expect(isWindowsAbsolutePath(value), value).toBe(false);
    }
  });
});

describe("resolveFromRoot", () => {
  it("collapses dot segments without consulting the host platform", () => {
    expect(resolveFromRoot("D:/Github/app", "src/../app.tsx")).toBe(
      "D:/Github/app/app.tsx",
    );
    expect(resolveFromRoot("/home/runner/app/", "routes/../app.tsx")).toBe(
      "/home/runner/app/app.tsx",
    );
  });

  it("joins relative paths under drive and UNC roots", () => {
    expect(resolveFromRoot("D:/", "app.tsx")).toBe("D:/app.tsx");
    expect(resolveFromRoot("//server/share/app", "src/a.tsx")).toBe(
      "//server/share/app/src/a.tsx",
    );
  });

  it("treats leading-slash paths differently per root style", () => {
    // Under a Windows root a leading slash is a root-relative path.
    expect(resolveFromRoot("D:/Github/app", "/src/App.tsx")).toBe(
      "D:/Github/app/src/App.tsx",
    );
    // Under a POSIX root it is already absolute and must not be re-rooted.
    expect(resolveFromRoot("/home/runner/app", "/tmp/other.tsx")).toBe(
      "/tmp/other.tsx",
    );
  });

  it("keeps absolute paths on the matching platform", () => {
    expect(resolveFromRoot("D:/app", "D:\\other\\x.tsx")).toBe("D:/other/x.tsx");
    expect(resolveFromRoot("D:/app", "//server/share/x.tsx")).toBe(
      "//server/share/x.tsx",
    );
  });
});

describe("relativeToRoot path styles", () => {
  it("compares Windows paths case-insensitively", () => {
    expect(relativeToRoot("D:/GitHub/app", "d:/github/APP/app/x.tsx")).toBe(
      "app/x.tsx",
    );
  });

  it("handles drive, POSIX and UNC roots", () => {
    expect(relativeToRoot("D:/", "D:/app.tsx")).toBe("app.tsx");
    expect(relativeToRoot("/", "/app.tsx")).toBe("app.tsx");
    expect(relativeToRoot("/", "/")).toBeUndefined();
    expect(relativeToRoot("//server/share/app", "//server/share/app/x.tsx")).toBe(
      "x.tsx",
    );
  });

  it("does not accept a sibling that only shares a prefix", () => {
    expect(
      relativeToRoot("D:/GitHub/app", "D:/GitHub/application/x.tsx"),
    ).toBeUndefined();
    expect(
      relativeToRoot("//server/share/app", "//server/share/other/x.tsx"),
    ).toBeUndefined();
  });
});

describe("toFilePath path styles", () => {
  it("normalises a root-absolute Windows id", () => {
    expect(toFilePath("/D:/proj/app.tsx", "D:/proj")).toBe("D:/proj/app.tsx");
  });

  it("accepts a root with a trailing slash", () => {
    expect(toFilePath(`${ROOT}/app/App.tsx`, `${ROOT}/`)).toBe(
      `${ROOT}/app/App.tsx`,
    );
  });

  it("maps root-relative URLs under a Windows root", () => {
    expect(toFilePath("/app/App.tsx", ROOT)).toBe(`${ROOT}/app/App.tsx`);
    // A leading slash under a POSIX root is an absolute POSIX path, not a
    // root-relative URL (mirrors resolveFromRoot's documented resolution).
    expect(toFilePath("/app/App.tsx", "/home/runner/app")).toBe(
      "/app/App.tsx",
    );
  });
});

describe("resolveModuleId path styles", () => {
  it("accepts uppercase source extensions", () => {
    expect(resolveModuleId(`${ROOT}/app/App.TSX`, ROOT, {})).toBeDefined();
    expect(resolveModuleId(`${ROOT}/app/App.MTS`, ROOT, {})).toBeDefined();
  });

  it("rejects data queries in every spelling", () => {
    for (const query of ["raw", "raw=1", "url=", "inline&foo=1", "worker&type=module", "direct"]) {
      expect(
        resolveModuleId(`${ROOT}/app/icon.tsx?${query}`, ROOT, {}),
        query,
      ).toBeUndefined();
    }
  });

  it("ignores .vite and .git internals", () => {
    for (const rel of [".vite/deps/x.js", ".git/x.tsx", "app/.vite/x.tsx"]) {
      expect(resolveModuleId(`${ROOT}/${rel}`, ROOT, {}), rel).toBeUndefined();
    }
  });

  it("rejects virtual ids and /@id/ ids", () => {
    expect(resolveModuleId("/@id/__x00__virtual:x", ROOT, {})).toBeUndefined();
    expect(resolveModuleId("\0virtual:x", ROOT, {})).toBeUndefined();
  });
});

describe("isClientEntryModule variants", () => {
  it("matches every supported client entry extension", () => {
    for (const file of [
      "entry.client.js",
      "entry.client.jsx",
      "entry.client.mjs",
      "entry.client.cjs",
      "entry.client.ts",
      "entry.client.tsx",
      "entry.client.mts",
      "entry.client.cts",
      "app/routes/entry.client.tsx",
    ]) {
      expect(isClientEntryModule(file), file).toBe(true);
    }
  });

  it("does not match server entries or prefixed names", () => {
    for (const file of [
      "entry.server.tsx",
      "my-entry.client.tsx",
      "entry.client.tsx.bak",
      "app/entry.client.tsx/gen.ts",
    ]) {
      expect(isClientEntryModule(file), file).toBe(false);
    }
  });
});
