// A small, synthetic module matching what Vite 7/8 actually serves in dev on
// Windows (captured with the probe described in the package README):
//
//   - the inline source map has NO `file` field and its `sources` are relative
//     to the module URL (`App.tsx`), so no absolute path is available from it;
//   - the transformed code embeds the absolute original path twice, in
//     `_jsxFileName` (Babel / @vitejs/plugin-react) and in the react-refresh
//     `RefreshRuntime.register(...)` call.
//
// The extension must recover the absolute path from the code so "Open in IDE"
// can build a `vscode://file/C:/...` URL without a manually configured root.

export interface ViteModuleNoMapFileFixture {
  moduleUrl: string;
  code: string;
  generated: { line: number; column: number };
  expected: {
    relativeFile: string;
    absoluteFile: string;
    projectRoot: string;
    line: number;
    column: number;
  };
}

const SOURCE_MAP = {
  version: 3,
  sources: ["App.tsx"],
  sourcesContent: [
    'export function App() {\n  return <div className="ttc">Vite + React 19</div>;\n}\n',
  ],
  names: [],
  // Two empty generated lines, then one segment at line 3:
  //   generated (3, 15) → App.tsx (1-based) line 20, column 9
  mappings: ";;cAmBQ",
};

const INLINE_MAP = `data:application/json;charset=utf-8;base64,${Buffer.from(
  JSON.stringify(SOURCE_MAP),
  "utf8",
).toString("base64")}`;

const CODE = [
  'import { jsxDEV } from "/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=8f1c0d2a";',
  'var _jsxFileName = "C:/Users/reemo/proj/src/App.tsx";',
  'const el = /* @__PURE__ */ jsxDEV("div", {}, void 0, false, { fileName: _jsxFileName, lineNumber: 20, columnNumber: 9 }, this);',
  'function $RefreshReg$(type, id) { return RefreshRuntime.register(type, "C:/Users/reemo/proj/src/App.tsx" + " " + id); }',
  `//# sourceMappingURL=${INLINE_MAP}`,
].join("\n");

export const viteModuleNoMapFile: ViteModuleNoMapFileFixture = {
  moduleUrl: "http://localhost:5173/src/App.tsx?t=fixture-no-file",
  code: CODE,
  generated: { line: 3, column: 15 },
  expected: {
    relativeFile: "src/App.tsx",
    absoluteFile: "C:/Users/reemo/proj/src/App.tsx",
    projectRoot: "C:/Users/reemo/proj",
    line: 20,
    column: 9,
  },
};

/**
 * The same module served under a non-root Vite `base` (`base: "/cats/"`, as in
 * React Router apps mounted at `/cats/`). The dev-server URL carries the base
 * prefix; the file on disk does not, so the extension must recover both the
 * project-relative path and the base prefix from the module's embedded
 * absolute path.
 */
export const viteModuleUnderBase: ViteModuleNoMapFileFixture = {
  moduleUrl: "http://localhost:5173/cats/src/App.tsx?t=fixture-no-file",
  code: CODE,
  generated: { line: 3, column: 15 },
  expected: {
    relativeFile: "src/App.tsx",
    absoluteFile: "C:/Users/reemo/proj/src/App.tsx",
    projectRoot: "C:/Users/reemo/proj",
    line: 20,
    column: 9,
  },
};
