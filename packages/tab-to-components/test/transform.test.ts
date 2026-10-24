import { describe, expect, it } from "vitest";
import { transformSource } from "../src/transform.js";

const FILE = "D:/Github/app/app/routes/home.tsx";
const REL = "app/routes/home.tsx";

function markers(code: string, relPath = REL): ReturnType<typeof transformSource> {
  return transformSource(code, FILE, { relPath, marker: true });
}

describe("transformSource: markers", () => {
  it("annotates host elements with line and column", () => {
    const result = markers("const a = <div />;\n");
    expect(result?.code).toBe(
      'const a = <div data-ttc={"app/routes/home.tsx:1:11"} />;\n',
    );
  });

  it("places the marker after existing attributes", () => {
    const result = markers('const a = <div className="x" id="y" />;\n');
    expect(result?.code).toContain(
      'id="y" data-ttc={"app/routes/home.tsx:1:11"} />',
    );
  });

  it("places the marker after a spread so a spread cannot override it", () => {
    const result = markers("const a = <div {...props} />;\n");
    expect(result?.code).toContain(
      'data-ttc={"app/routes/home.tsx:1:11"} />',
    );
    const markerIndex = result!.code.indexOf("data-ttc");
    const spreadIndex = result!.code.indexOf("{...props}");
    expect(spreadIndex).toBeLessThan(markerIndex);
  });

  it("adds the JSX tag name for component elements", () => {
    const result = markers("const a = <Button onClick={fn} />;\n");
    expect(result?.code).toContain(
      'data-ttc={"app/routes/home.tsx:1:11"} data-ttc-name={"Button"} />',
    );
  });

  it("supports member expression components", () => {
    const result = markers("const a = <Foo.Bar />;\n");
    expect(result?.code).toContain('data-ttc-name={"Foo.Bar"}');
  });

  it("does not add a name for host elements with dashes", () => {
    const result = markers("const a = <my-element />;\n");
    expect(result?.code).toContain("data-ttc={");
    expect(result?.code).not.toContain("data-ttc-name");
  });

  it("annotates every element in a tree, including fragments", () => {
    const code = [
      "export function App() {",
      "  return (",
      "    <>",
      "      <main>",
      "        <Button>hi</Button>",
      "      </main>",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    const result = markers(code);
    expect(result?.code).toContain('data-ttc={"app/routes/home.tsx:4:7"}');
    expect(result?.code).toContain('data-ttc={"app/routes/home.tsx:5:9"}');
    expect(result?.code).toContain('data-ttc-name={"Button"}');
  });

  it("counts lines correctly with leading comments", () => {
    const code = "// comment\n// two\nconst a = <div />;\n";
    const result = markers(code);
    expect(result?.code).toContain('data-ttc={"app/routes/home.tsx:3:11"}');
  });

  it("handles TypeScript generics and arrow components", () => {
    const code = [
      'type Props = { value?: string };',
      "export const Cell = <T,>({ value }: Props & { item: T }) => (",
      '  <span className="cell">{String(value)}</span>',
      ");",
      "",
    ].join("\n");
    const result = markers(code);
    expect(result?.code).toContain('data-ttc={"app/routes/home.tsx:3:3"}');
    expect(result?.code).toContain('className="cell" data-ttc=');
  });

  it("returns undefined when the file has no JSX", () => {
    expect(markers("export const x = 1;\n")).toBeUndefined();
  });

  it("is idempotent", () => {
    const first = markers("const a = <div />;\n");
    expect(first).toBeDefined();
    expect(markers(first!.code)).toBeUndefined();
  });

  it("returns undefined on invalid syntax instead of throwing", () => {
    expect(markers("const a = <div ;\n")).toBeUndefined();
  });

  it("produces a source map that points at the original file", () => {
    const result = markers("const a = <div />;\n");
    expect(result?.map.sources.join(",")).toContain("home.tsx");
    expect(result?.map.mappings.length).toBeGreaterThan(0);
  });
});

describe("transformSource: already-compiled JSX", () => {
  // What @vitejs/plugin-react (Babel dev runtime) emits when it compiles TSX
  // before this plugin gets the module.
  const COMPILED = [
    'import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime";',
    'const _jsxFileName = "D:/Github/app/app/App.tsx";',
    "function App() {",
    "  return /*#__PURE__*/_jsxDEV(",
    '    "main",',
    "    {",
    '      className: "x",',
    "      children: /*#__PURE__*/_jsxDEV(Button, {}, void 0, false, {",
    "        fileName: _jsxFileName,",
    "        lineNumber: 20,",
    "        columnNumber: 7",
    "      }, this)",
    "    },",
    "    void 0,",
    "    false,",
    "    { fileName: _jsxFileName, lineNumber: 9, columnNumber: 5 },",
    "    this",
    "  );",
    "}",
    "",
  ].join("\n");

  it("injects markers into the compiled props objects", () => {
    const result = transformSource(COMPILED, FILE, { relPath: REL, marker: true });
    expect(result).toBeDefined();
    const code = result!.code;
    expect(code).toContain('"data-ttc": "app/routes/home.tsx:9:5"');
    expect(code).toContain('"data-ttc": "app/routes/home.tsx:20:7"');
    expect(code).toContain('"data-ttc-name": "Button"');
    // host elements do not get a name
    expect(code).not.toContain('"data-ttc-name": "main"');
  });

  it("handles empty and null props objects", () => {
    const source = [
      'const a = _jsxDEV("div", {}, void 0, false, { fileName: "x", lineNumber: 1, columnNumber: 2 }, this);',
      'const b = _jsxDEV("span", null, void 0, false, { fileName: "x", lineNumber: 3, columnNumber: 4 }, this);',
      "",
    ].join("\n");
    const result = transformSource(source, FILE, { relPath: REL, marker: true });
    expect(result?.code).toContain('{ "data-ttc": "app/routes/home.tsx:1:2" }');
    expect(result?.code).toContain('{ "data-ttc": "app/routes/home.tsx:3:4" }');
  });

  it("is idempotent", () => {
    const once = transformSource(COMPILED, FILE, { relPath: REL, marker: true });
    expect(transformSource(once!.code, FILE, { relPath: REL, marker: true })).toBeUndefined();
  });

  it("does nothing when the compiler did not keep the source object", () => {
    const source = [
      'import { jsx } from "react/jsx-runtime";',
      'const a = jsx("div", { className: "x" });',
      "",
    ].join("\n");
    expect(
      transformSource(source, FILE, { relPath: REL, marker: true }),
    ).toBeUndefined();
  });

  it("still injects the overlay import into compiled modules", () => {
    const result = transformSource(COMPILED, FILE, {
      relPath: REL,
      marker: true,
      overlayImport: "virtual:tab-to-components/client",
    });
    expect(result?.code.startsWith('import "virtual:tab-to-components/client";')).toBe(
      true,
    );
  });
});

describe("transformSource: overlay import", () => {
  const overlayImport = "virtual:tab-to-components/client";

  function withOverlay(code: string) {
    return transformSource(code, FILE, {
      relPath: REL,
      marker: false,
      overlayImport,
    });
  }

  it("prepends the import to a plain module", () => {
    const result = withOverlay('import { x } from "./x";\n');
    expect(result?.code.startsWith(`import "${overlayImport}";\n`)).toBe(true);
  });

  it("inserts the import after a directive prologue", () => {
    const result = withOverlay('"use client";\n\nimport { x } from "./x";\n');
    const code = result!.code;
    expect(code.indexOf('"use client";')).toBeLessThan(
      code.indexOf(`import "${overlayImport}";`),
    );
  });

  it("inserts the import after a shebang", () => {
    const result = withOverlay('#!/usr/bin/env node\nimport "./x";\n');
    expect(result!.code.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("does not inject twice", () => {
    const once = withOverlay('import { x } from "./x";\n');
    expect(withOverlay(once!.code)).toBeUndefined();
  });

  it("can inject markers and the overlay import at once", () => {
    const result = transformSource('"use client";\nexport const A = () => <div />;\n', FILE, {
      relPath: REL,
      marker: true,
      overlayImport,
    });
    expect(result!.code).toContain(`import "${overlayImport}";`);
    expect(result!.code).toContain("data-ttc=");
    expect(result!.code.indexOf('"use client";')).toBeLessThan(
      result!.code.indexOf(`import "${overlayImport}";`),
    );
  });
});
