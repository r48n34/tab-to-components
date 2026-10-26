// Generated from playground/vite-react/src/App.tsx through Vite 8 + @vitejs/plugin-react 6.
// Regenerate with the command documented in the package README (Development section).
// The absolute path in the map was canonicalized to D:/proj so the fixture is portable.

export interface ViteModuleFixture {
  moduleUrl: string;
  code: string;
  generated: { line: number; column: number };
  expected: {
    relativeFile: string;
    absoluteFile: string;
    line: number;
    column: number;
    source: string | null;
  };
  translations: Array<{
    needle: string;
    generated: { line: number; column: number };
    original: { line: number; column: number };
  }>;
}

export const viteReact19Module: ViteModuleFixture =
{
  "moduleUrl": "http://localhost:5173/src/App.tsx?t=fixture",
  "code": "import { createHotContext as __vite__createHotContext } from \"/@vite/client\";import.meta.hot = __vite__createHotContext(\"/src/App.tsx\");const useState = __vite__cjsImport0_react[\"useState\"];const _jsxDEV = __vite__cjsImport3_react_jsxDevRuntime[\"jsxDEV\"];import __vite__cjsImport0_react from \"/node_modules/.vite/deps/react.js?v=12f03bf4\";\nimport { Button } from \"/src/components/Button.tsx\";\nimport { FeatureCard } from \"/src/components/FeatureCard.tsx\";\nvar _jsxFileName = \"D:/proj/src/App.tsx\";\nimport __vite__cjsImport3_react_jsxDevRuntime from \"/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=12f03bf4\";\nvar _s = $RefreshSig$();\nexport default function App() {\n\t_s();\n\tconst [count, setCount] = useState(0);\n\treturn /* @__PURE__ */ _jsxDEV(\"main\", {\n\t\tclassName: \"ttc-main\",\n\t\tchildren: [\n\t\t\t/* @__PURE__ */ _jsxDEV(\"h1\", { children: \"Vite + React 19\" }, void 0, false, {\n\t\t\t\tfileName: _jsxFileName,\n\t\t\t\tlineNumber: 10,\n\t\t\t\tcolumnNumber: 7\n\t\t\t}, this),\n\t\t\t/* @__PURE__ */ _jsxDEV(\"p\", { children: [\n\t\t\t\t\"Hold \",\n\t\t\t\t/* @__PURE__ */ _jsxDEV(\"kbd\", { children: \"Alt\" }, void 0, false, {\n\t\t\t\t\tfileName: _jsxFileName,\n\t\t\t\t\tlineNumber: 12,\n\t\t\t\t\tcolumnNumber: 14\n\t\t\t\t}, this),\n\t\t\t\t\" and click the button. The JSX source of the component you clicked opens in your editor.\"\n\t\t\t] }, void 0, true, {\n\t\t\t\tfileName: _jsxFileName,\n\t\t\t\tlineNumber: 11,\n\t\t\t\tcolumnNumber: 7\n\t\t\t}, this),\n\t\t\t/* @__PURE__ */ _jsxDEV(FeatureCard, {\n\t\t\t\ttitle: \"Nested component chain\",\n\t\t\t\tchildren: [/* @__PURE__ */ _jsxDEV(\"p\", { children: [\n\t\t\t\t\t\"App → FeatureCard → Button. Alt+clicking the button opens\",\n\t\t\t\t\t\" \",\n\t\t\t\t\t/* @__PURE__ */ _jsxDEV(\"code\", { children: \"src/App.tsx\" }, void 0, false, {\n\t\t\t\t\t\tfileName: _jsxFileName,\n\t\t\t\t\t\tlineNumber: 18,\n\t\t\t\t\t\tcolumnNumber: 11\n\t\t\t\t\t}, this),\n\t\t\t\t\t\".\"\n\t\t\t\t] }, void 0, true, {\n\t\t\t\t\tfileName: _jsxFileName,\n\t\t\t\t\tlineNumber: 16,\n\t\t\t\t\tcolumnNumber: 9\n\t\t\t\t}, this), /* @__PURE__ */ _jsxDEV(Button, {\n\t\t\t\t\tonClick: () => setCount((value) => value + 1),\n\t\t\t\t\tchildren: [\"count is \", count]\n\t\t\t\t}, void 0, true, {\n\t\t\t\t\tfileName: _jsxFileName,\n\t\t\t\t\tlineNumber: 20,\n\t\t\t\t\tcolumnNumber: 9\n\t\t\t\t}, this)]\n\t\t\t}, void 0, true, {\n\t\t\t\tfileName: _jsxFileName,\n\t\t\t\tlineNumber: 15,\n\t\t\t\tcolumnNumber: 7\n\t\t\t}, this)\n\t\t]\n\t}, void 0, true, {\n\t\tfileName: _jsxFileName,\n\t\tlineNumber: 9,\n\t\tcolumnNumber: 5\n\t}, this);\n}\n_s(App, \"oDgYfYHkD9Wkv4hrAPCkI/ev3YU=\");\n_c = App;\nvar _c;\n$RefreshReg$(_c, \"App\");\nimport * as RefreshRuntime from \"/@react-refresh\";\nconst inWebWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;\nimport * as __vite_react_currentExports from \"/src/App.tsx\";\nif (import.meta.hot && !inWebWorker) {\n  if (!window.$RefreshReg$) {\n    throw new Error(\n      \"@vitejs/plugin-react can't detect preamble. Something is wrong.\"\n    );\n  }\n\n  const currentExports = __vite_react_currentExports;\n  queueMicrotask(() => {\n    RefreshRuntime.registerExportsForReactRefresh(\"D:/Github/tab-to-components/playground/vite-react/src/App.tsx\", currentExports);\n    import.meta.hot.accept((nextExports) => {\n      if (!nextExports) return;\n      const invalidateMessage = RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate(\"D:/Github/tab-to-components/playground/vite-react/src/App.tsx\", currentExports, nextExports);\n      if (invalidateMessage) import.meta.hot.invalidate(invalidateMessage);\n    });\n  });\n}\nfunction $RefreshReg$(type, id) { return RefreshRuntime.register(type, \"D:/Github/tab-to-components/playground/vite-react/src/App.tsx\" + ' ' + id); }\nfunction $RefreshSig$() { return RefreshRuntime.createSignatureFunctionForTransform(); }\n\n//# sourceMappingURL=data:application/json;base64,eyJtYXBwaW5ncyI6IkFBQUEsU0FBUyxnQkFBZ0I7QUFDekIsU0FBUyxjQUFjO0FBQ3ZCLFNBQVMsbUJBQW1COzs7O0FBRTVCLGVBQWUsU0FBUyxNQUFNOztDQUM1QixNQUFNLENBQUMsT0FBTyxZQUFZLFNBQVMsQ0FBQztDQUVwQyxPQUNFLHdCQUFDLFFBQUQ7RUFBTSxXQUFVO1lBQWhCO0dBQ0Usd0JBQUMsTUFBRCxZQUFJLGtCQUFtQjs7Ozs7R0FDdkIsd0JBQUMsS0FBRDtJQUFHO0lBQ0ksd0JBQUMsT0FBRCxZQUFLLE1BQVE7Ozs7O0lBQUM7R0FFbEI7Ozs7O0dBQ0gsd0JBQUMsYUFBRDtJQUFhLE9BQU07Y0FBbkIsQ0FDRSx3QkFBQyxLQUFEO0tBQUc7S0FDbUU7S0FDcEUsd0JBQUMsUUFBRCxZQUFNLGNBQWlCOzs7OztLQUFDO0lBQ3ZCOzs7O2NBQ0gsd0JBQUMsUUFBRDtLQUFRLGVBQWUsVUFBVSxVQUFVLFFBQVEsQ0FBQztlQUFwRCxDQUF1RCxhQUMzQyxLQUNKOzs7OztZQUNHOzs7Ozs7RUFDVDs7Ozs7O0FBRVYiLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiQXBwLnRzeCJdLCJ2ZXJzaW9uIjozLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB1c2VTdGF0ZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHsgQnV0dG9uIH0gZnJvbSBcIi4vY29tcG9uZW50cy9CdXR0b25cIjtcbmltcG9ydCB7IEZlYXR1cmVDYXJkIH0gZnJvbSBcIi4vY29tcG9uZW50cy9GZWF0dXJlQ2FyZFwiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBBcHAoKSB7XG4gIGNvbnN0IFtjb3VudCwgc2V0Q291bnRdID0gdXNlU3RhdGUoMCk7XG5cbiAgcmV0dXJuIChcbiAgICA8bWFpbiBjbGFzc05hbWU9XCJ0dGMtbWFpblwiPlxuICAgICAgPGgxPlZpdGUgKyBSZWFjdCAxOTwvaDE+XG4gICAgICA8cD5cbiAgICAgICAgSG9sZCA8a2JkPkFsdDwva2JkPiBhbmQgY2xpY2sgdGhlIGJ1dHRvbi4gVGhlIEpTWCBzb3VyY2Ugb2YgdGhlXG4gICAgICAgIGNvbXBvbmVudCB5b3UgY2xpY2tlZCBvcGVucyBpbiB5b3VyIGVkaXRvci5cbiAgICAgIDwvcD5cbiAgICAgIDxGZWF0dXJlQ2FyZCB0aXRsZT1cIk5lc3RlZCBjb21wb25lbnQgY2hhaW5cIj5cbiAgICAgICAgPHA+XG4gICAgICAgICAgQXBwICZyYXJyOyBGZWF0dXJlQ2FyZCAmcmFycjsgQnV0dG9uLiBBbHQrY2xpY2tpbmcgdGhlIGJ1dHRvbiBvcGVuc3tcIiBcIn1cbiAgICAgICAgICA8Y29kZT5zcmMvQXBwLnRzeDwvY29kZT4uXG4gICAgICAgIDwvcD5cbiAgICAgICAgPEJ1dHRvbiBvbkNsaWNrPXsoKSA9PiBzZXRDb3VudCgodmFsdWUpID0+IHZhbHVlICsgMSl9PlxuICAgICAgICAgIGNvdW50IGlzIHtjb3VudH1cbiAgICAgICAgPC9CdXR0b24+XG4gICAgICA8L0ZlYXR1cmVDYXJkPlxuICAgIDwvbWFpbj5cbiAgKTtcbn1cbiJdLCJmaWxlIjoiRDovcHJvai9zcmMvQXBwLnRzeCJ9\n",
  "generated": {
    "line": 46,
    "column": 31
  },
  "expected": {
    "relativeFile": "src/App.tsx",
    "absoluteFile": "D:/proj/src/App.tsx",
    "line": 20,
    "column": 9,
    "source": "App.tsx"
  },
  "translations": [
    {
      "needle": "_jsxDEV(Button",
      "generated": {
        "line": 46,
        "column": 31
      },
      "original": {
        "line": 20,
        "column": 9
      }
    },
    {
      "needle": "_jsxDEV(\"main\"",
      "generated": {
        "line": 10,
        "column": 25
      },
      "original": {
        "line": 9,
        "column": 5
      }
    },
    {
      "needle": "_jsxDEV(\"h1\"",
      "generated": {
        "line": 13,
        "column": 20
      },
      "original": {
        "line": 10,
        "column": 7
      }
    }
  ]
};
